import { AgentRuntimeError } from './errors.js';
import { isPlainRecord } from './json.js';
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
  inputSchema?: string;
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
      return registered.map((tool) => toRuntimeTool(modelContext, tool, getOptions));
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
): RuntimeTool {
  const initial = normalizeRegisteredTool(registered);
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
      const candidates = currentTools.map((candidate) => ({
        registered: candidate,
        runtime: normalizeRegisteredTool(candidate),
      }));
      const matches = candidates.filter(({ runtime }) => (
        runtime.name === initial.name
        && (runtime.origin ?? '') === (initial.origin ?? '')
      ));
      if (matches.length !== 1 || matches[0] === undefined) {
        throw new AgentRuntimeError(
          'tool_unavailable',
          `WebMCP tool became unavailable or ambiguous: ${registered.name}`,
        );
      }
      const match = matches[0];
      if (toolFingerprint(match.runtime) !== fingerprint) {
        throw new AgentRuntimeError(
          'tool_changed',
          `WebMCP tool definition changed before execution: ${registered.name}`,
        );
      }
      const rawResult = await modelContext.executeTool(
        match.registered,
        input,
        context.signal === undefined ? {} : { signal: context.signal },
      );
      return parseWebMcpResult(rawResult);
    },
  };
}

function normalizeRegisteredTool(registered: RegisteredWebMcpTool): RuntimeTool {
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
      readOnlyHint: registered.annotations?.readOnlyHint === true,
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

function parseRegisteredSchema(serialized: string | undefined): JsonSchema {
  if (serialized !== undefined && typeof serialized !== 'string') {
    throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP inputSchema must be a string.');
  }
  if (serialized === undefined || serialized === '') {
    return { type: 'object', properties: {}, additionalProperties: false };
  }
  if (serialized.length > MAX_WEBMCP_SCHEMA_CHARACTERS) {
    throw new AgentRuntimeError('resource_limit', 'Registered WebMCP inputSchema is too large.');
  }
  let schema: unknown;
  try {
    schema = JSON.parse(serialized) as unknown;
  } catch {
    throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP inputSchema is malformed JSON.');
  }
  if (!isPlainRecord(schema)) {
    throw new AgentRuntimeError('invalid_tool', 'Registered WebMCP inputSchema must be an object.');
  }
  return schema;
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
