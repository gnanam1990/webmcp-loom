import { AgentRuntimeError } from './errors.js';
import { isJsonCompatible, isPlainRecord } from './json.js';
import {
  describeTool,
  snapshotToolRegistry,
  toolFingerprint,
} from './registry.js';
import type {
  JsonObject,
  JsonSchema,
  JsonValue,
  RuntimeTool,
  RuntimeToolAnnotations,
  RuntimeToolProvider,
} from './types.js';

const MAX_WEBMCP_SCHEMA_CHARACTERS = 16_000;
const MAX_WEBMCP_RESULT_CHARACTERS = 100_000;
const MAX_TRUSTED_READ_ONLY_ORIGINS = 64;

export interface WebMcpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: Partial<RuntimeToolAnnotations>;
  execute(
    input: JsonObject,
    options: { signal: AbortSignal | undefined },
  ): unknown | Promise<unknown>;
}

export interface RegisteredWebMcpTool {
  name: string;
  title?: string;
  description: string;
  /** The current WebMCP shape is an object; strings remain accepted for draft compatibility. */
  inputSchema?: JsonSchema | string;
  origin?: string;
  annotations?: Partial<RuntimeToolAnnotations>;
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { exposedTo?: readonly string[]; signal?: AbortSignal },
  ): Promise<void>;
  getTools(options?: { fromOrigins?: readonly string[] }): Promise<readonly RegisteredWebMcpTool[]>;
  executeTool(
    tool: RegisteredWebMcpTool,
    input?: JsonObject,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
}

export interface WebMcpRegistration {
  readonly signal: AbortSignal;
  dispose(): void;
}

export interface RegisterRuntimeToolsOptions {
  exposedTo?: readonly string[];
  signal?: AbortSignal;
}

export interface WebMcpToolProviderOptions {
  fromOrigins?: readonly string[];
  trustedReadOnlyOrigins?: readonly string[];
}

export async function registerRuntimeTools(
  modelContext: WebMcpModelContext,
  tools: readonly RuntimeTool[],
  options: RegisterRuntimeToolsOptions = {},
): Promise<WebMcpRegistration> {
  if (options.signal?.aborted) {
    throw new AgentRuntimeError('cancelled', 'WebMCP registration was cancelled.');
  }
  const stableTools = snapshotToolRegistry(tools);
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    await raceWithAbort(
      Promise.all(stableTools.map(async (tool) => {
        await modelContext.registerTool(toWebMcpDefinition(tool), {
          signal: controller.signal,
          ...(options.exposedTo === undefined ? {} : { exposedTo: [...options.exposedTo] }),
        });
      })),
      options.signal,
    );
  } catch (error) {
    const cancelled = options.signal?.aborted === true;
    controller.abort();
    options.signal?.removeEventListener('abort', forwardAbort);
    if (cancelled) {
      throw new AgentRuntimeError('cancelled', 'WebMCP registration was cancelled.');
    }
    const message = error instanceof Error && error.message
      ? error.message
      : 'Unknown WebMCP registration failure.';
    throw new AgentRuntimeError('invalid_tool', `WebMCP tool registration failed: ${message}`);
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      options.signal?.removeEventListener('abort', forwardAbort);
    },
  };
}

export function createWebMcpToolProvider(
  modelContext: WebMcpModelContext,
  options: WebMcpToolProviderOptions = {},
): RuntimeToolProvider {
  const trustedReadOnlyOrigins = normalizeTrustedReadOnlyOrigins(
    options.trustedReadOnlyOrigins,
  );
  const getOptions = options.fromOrigins === undefined
    ? undefined
    : { fromOrigins: [...options.fromOrigins] };
  return {
    getTools: async ({ signal }) => {
      throwIfAborted(signal);
      const registered = await raceWithAbort(modelContext.getTools(getOptions), signal);
      throwIfAborted(signal);
      if (!Array.isArray(registered)) {
        throw new AgentRuntimeError('invalid_tool', 'WebMCP getTools() must return an array.');
      }
      return registered.map((tool) => toRuntimeTool(
        modelContext,
        tool,
        getOptions,
        trustedReadOnlyOrigins,
      ));
    },
  };
}

export async function installDocumentRuntimeTools(
  tools: readonly RuntimeTool[],
  options: RegisterRuntimeToolsOptions = {},
): Promise<WebMcpRegistration | null> {
  if (typeof document === 'undefined') return null;
  const candidate = (document as Document & { modelContext?: unknown }).modelContext;
  if (!isWebMcpModelContext(candidate)) return null;
  return registerRuntimeTools(candidate, tools, options);
}

/**
 * Installs document tools for the lifetime of the current page.
 *
 * A terminal `pagehide` cancels an in-flight registration and disposes a
 * completed one. BFCache page hides are intentionally preserved, so restored
 * pages keep their existing registration.
 */
export async function installDocumentRuntimeToolsWithPageLifecycle(
  tools: readonly RuntimeTool[],
  options: RegisterRuntimeToolsOptions = {},
): Promise<WebMcpRegistration | null> {
  if (typeof document === 'undefined' || document.defaultView === null) {
    return installDocumentRuntimeTools(tools, options);
  }

  const page = document.defaultView;
  const lifecycle = new AbortController();
  let registration: WebMcpRegistration | null = null;
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    page.removeEventListener('pagehide', onPageHide);
    options.signal?.removeEventListener('abort', abortLifecycle);
  };
  const dispose = (): void => {
    lifecycle.abort();
    registration?.dispose();
    cleanup();
  };
  const abortLifecycle = (): void => dispose();
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) dispose();
  };

  page.addEventListener('pagehide', onPageHide);
  if (options.signal?.aborted) {
    dispose();
  } else {
    options.signal?.addEventListener('abort', abortLifecycle, { once: true });
  }

  try {
    registration = await installDocumentRuntimeTools(tools, {
      ...options,
      signal: lifecycle.signal,
    });
  } catch (error) {
    cleanup();
    throw error;
  }

  if (registration === null) {
    cleanup();
    return null;
  }
  if (lifecycle.signal.aborted) {
    registration.dispose();
    cleanup();
    throw new AgentRuntimeError('cancelled', 'WebMCP page lifecycle ended during registration.');
  }
  return {
    signal: registration.signal,
    dispose,
  };
}

function toWebMcpDefinition(tool: RuntimeTool): WebMcpToolDefinition {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { ...tool.annotations },
    execute: (input, options) => tool.execute(input, {
      signal: options.signal,
      expectedStateRevision: undefined,
    }),
  };
}

function toRuntimeTool(
  modelContext: WebMcpModelContext,
  registered: RegisteredWebMcpTool,
  getOptions: { fromOrigins: string[] } | undefined,
  trustedReadOnlyOrigins: ReadonlySet<string>,
): RuntimeTool {
  const initial = normalizeRegisteredTool(registered, trustedReadOnlyOrigins);
  const fingerprint = toolFingerprint(initial);
  return {
    ...describeTool(initial),
    execute: async (input, context) => {
      throwIfAborted(context.signal);
      const currentTools = await raceWithAbort(
        modelContext.getTools(getOptions),
        context.signal,
      );
      throwIfAborted(context.signal);
      if (!Array.isArray(currentTools)) {
        throw new AgentRuntimeError('invalid_tool', 'WebMCP getTools() must return an array.');
      }
      const matches = currentTools.filter((candidate) => registeredIdentityMatches(
        candidate,
        initial.name,
        initial.origin,
      ));
      if (matches.length !== 1 || matches[0] === undefined) {
        throw new AgentRuntimeError(
          'tool_unavailable',
          `WebMCP tool became unavailable or ambiguous: ${registered.name}`,
        );
      }
      const match = matches[0];
      const current = normalizeRegisteredTool(match, trustedReadOnlyOrigins);
      if (toolFingerprint(current) !== fingerprint) {
        throw new AgentRuntimeError(
          'tool_changed',
          `WebMCP tool definition changed before execution: ${registered.name}`,
        );
      }
      const rawResult = await modelContext.executeTool(
        match,
        input,
        context.signal === undefined ? {} : { signal: context.signal },
      );
      return parseWebMcpResult(rawResult);
    },
  };
}

function registeredIdentityMatches(
  value: unknown,
  expectedName: string,
  expectedOrigin: string | undefined,
): value is RegisteredWebMcpTool {
  if (typeof value !== 'object' || value === null) return false;
  try {
    const candidate = value as Record<string, unknown>;
    return candidate.name === expectedName
      && (candidate.origin ?? '') === (expectedOrigin ?? '');
  } catch {
    return false;
  }
}

function normalizeRegisteredTool(
  registered: RegisteredWebMcpTool,
  trustedReadOnlyOrigins: ReadonlySet<string>,
): RuntimeTool {
  if (typeof registered !== 'object' || registered === null) {
    throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP tools must be objects.');
  }
  if (typeof registered.name !== 'string' || !registered.name.trim()) {
    throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP tools require a name.');
  }
  if (registered.title !== undefined && typeof registered.title !== 'string') {
    throw new AgentRuntimeError('invalid_tool', `WebMCP tool title is invalid: ${registered.name}`);
  }
  if (typeof registered.description !== 'string' || !registered.description.trim()) {
    throw new AgentRuntimeError(
      'invalid_tool',
      `WebMCP tool description is invalid: ${registered.name}`,
    );
  }
  if (registered.origin !== undefined && typeof registered.origin !== 'string') {
    throw new AgentRuntimeError('invalid_tool', `WebMCP tool origin is invalid: ${registered.name}`);
  }
  if (registered.annotations !== undefined && !isPlainRecord(registered.annotations)) {
    throw new AgentRuntimeError(
      'invalid_tool',
      `WebMCP tool annotations are invalid: ${registered.name}`,
    );
  }
  if (registered.annotations?.readOnlyHint !== undefined
    && typeof registered.annotations.readOnlyHint !== 'boolean') {
    throw new AgentRuntimeError(
      'invalid_tool',
      `WebMCP tool readOnlyHint is invalid: ${registered.name}`,
    );
  }
  if (registered.annotations?.untrustedContentHint !== undefined
    && typeof registered.annotations.untrustedContentHint !== 'boolean') {
    throw new AgentRuntimeError(
      'invalid_tool',
      `WebMCP tool untrustedContentHint is invalid: ${registered.name}`,
    );
  }
  const schema = parseRegisteredSchema(registered.inputSchema);
  return {
    name: registered.name,
    title: registered.title?.trim() || registered.name,
    description: registered.description,
    inputSchema: schema,
    annotations: {
      readOnlyHint: registered.annotations?.readOnlyHint === true
        && isTrustedReadOnlyOrigin(registered.origin, trustedReadOnlyOrigins),
      ...(registered.annotations?.untrustedContentHint === undefined
        ? {}
        : { untrustedContentHint: registered.annotations.untrustedContentHint }),
    },
    ...(registered.origin === undefined ? {} : { origin: registered.origin }),
    execute: () => {
      throw new AgentRuntimeError('invalid_tool', 'Unbound WebMCP tool cannot execute.');
    },
  };
}

function normalizeTrustedReadOnlyOrigins(
  origins: readonly string[] | undefined,
): ReadonlySet<string> {
  if (origins === undefined) return new Set();
  if (origins.length > MAX_TRUSTED_READ_ONLY_ORIGINS) {
    throw new AgentRuntimeError(
      'resource_limit',
      `Trusted read-only origins exceed the ${MAX_TRUSTED_READ_ONLY_ORIGINS}-origin limit.`,
    );
  }
  const normalized = new Set<string>();
  for (const value of origins) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new AgentRuntimeError(
        'invalid_configuration',
        'Trusted read-only origins must be non-empty URLs.',
      );
    }
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      throw new AgentRuntimeError(
        'invalid_configuration',
        `Trusted read-only origin is invalid: ${value}`,
      );
    }
    if (origin === 'null') {
      throw new AgentRuntimeError(
        'invalid_configuration',
        `Trusted read-only origin must be a tuple origin: ${value}`,
      );
    }
    normalized.add(origin);
  }
  return normalized;
}

function isTrustedReadOnlyOrigin(
  value: string | undefined,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  if (value === undefined) return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && trustedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

function parseRegisteredSchema(value: JsonSchema | string | undefined): JsonSchema {
  if (value === undefined || value === '') {
    return { type: 'object', properties: {}, additionalProperties: false };
  }

  if (typeof value === 'string') {
    if (value.length > MAX_WEBMCP_SCHEMA_CHARACTERS) {
      throw new AgentRuntimeError('resource_limit', 'Registered WebMCP inputSchema is too large.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP inputSchema is malformed JSON.');
    }
    if (!isPlainRecord(parsed)) {
      throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP inputSchema must be an object.');
    }
    return parsed;
  }

  let serialized: string;
  try {
    if (!isPlainRecord(value) || !isJsonCompatible(value)) {
      throw new AgentRuntimeError(
        'invalid_tool',
        'Registered WebMCP inputSchema must be a JSON-compatible object.',
      );
    }
    serialized = JSON.stringify(value);
  } catch (error) {
    if (error instanceof AgentRuntimeError) throw error;
    throw new AgentRuntimeError(
      'invalid_tool',
      'Registered WebMCP inputSchema must be a JSON-compatible object.',
    );
  }
  if (serialized.length > MAX_WEBMCP_SCHEMA_CHARACTERS) {
    throw new AgentRuntimeError('resource_limit', 'Registered WebMCP inputSchema is too large.');
  }
  return JSON.parse(serialized) as JsonSchema;
}

function parseWebMcpResult(result: string): JsonValue {
  if (typeof result !== 'string') {
    throw new AgentRuntimeError('invalid_tool', 'WebMCP executeTool() must return a string.');
  }
  if (result.length > MAX_WEBMCP_RESULT_CHARACTERS) {
    throw new AgentRuntimeError('resource_limit', 'WebMCP tool result is too large.');
  }
  try {
    return JSON.parse(result) as JsonValue;
  } catch {
    return result;
  }
}

function isWebMcpModelContext(value: unknown): value is WebMcpModelContext {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.registerTool === 'function'
    && typeof candidate.getTools === 'function'
    && typeof candidate.executeTool === 'function';
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) {
    return Promise.reject(new AgentRuntimeError('cancelled', 'WebMCP operation was cancelled.'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      reject(new AgentRuntimeError('cancelled', 'WebMCP operation was cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AgentRuntimeError('cancelled', 'WebMCP operation was cancelled.');
  }
}
