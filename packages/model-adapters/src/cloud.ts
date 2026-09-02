import { RUNTIME_LIMITS, type RuntimeModel } from '@webmcp-loom/runtime';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_GENERATION_TOKENS = 4_096;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_CREDENTIAL_HEADERS = 32;
const MAX_CREDENTIAL_HEADER_NAME_CHARACTERS = 128;
const MAX_CREDENTIAL_HEADER_VALUE_CHARACTERS = 8_192;
const MAX_CREDENTIAL_HEADERS_CHARACTERS = 32_768;
const SENSITIVE_QUERY_NAME = /(?:^|[-_])(api[-_]?key|auth|credential|password|secret|signature|token)(?:$|[-_])/i;
const FORBIDDEN_CREDENTIAL_HEADERS = new Set([
  'accept',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export interface CloudCredentialContext {
  signal: AbortSignal;
}

export type CloudCredentialResolver = (
  context: CloudCredentialContext,
) => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;

export interface OpenAiCompatibleCloudRuntimeModelOptions {
  /** Exact HTTPS chat-completions endpoint; the adapter never guesses a provider URL. */
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  maxTokens?: number;
  model: string;
  resolveCredentialHeaders: CloudCredentialResolver;
  seed?: number;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: readonly { message?: { content?: unknown } }[];
}

/**
 * Adapts an explicitly configured OpenAI-compatible HTTPS endpoint to the
 * model-neutral runtime contract. Provider credentials are resolved for each
 * request and are never retained, logged, or included in adapter errors.
 */
export function createOpenAiCompatibleCloudRuntimeModel(
  options: OpenAiCompatibleCloudRuntimeModelOptions,
): RuntimeModel {
  const endpoint = validateEndpoint(options.endpoint);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be a positive safe integer no greater than ${MAX_TIMEOUT_MS}.`);
  }
  const model = options.model.trim();
  if (!model) throw new Error('model must not be empty.');
  if (typeof options.resolveCredentialHeaders !== 'function') {
    throw new Error('resolveCredentialHeaders must be a function.');
  }
  const maxTokens = options.maxTokens ?? 128;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > MAX_GENERATION_TOKENS) {
    throw new Error(`maxTokens must be a positive safe integer no greater than ${MAX_GENERATION_TOKENS}.`);
  }
  const seed = options.seed ?? 42;
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer.');
  const temperature = options.temperature ?? 0;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error('temperature must be a finite number between 0 and 2.');
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== 'function') {
    throw new Error('A fetch implementation is required.');
  }

  return {
    async generate(request) {
      const operation = createOperationSignal(request.signal, timeoutMs);
      try {
        let credentialHeaders: Readonly<Record<string, string>>;
        try {
          throwIfAborted(operation.signal);
          credentialHeaders = await raceWithAbort(
            Promise.resolve().then(() => options.resolveCredentialHeaders({
              signal: operation.signal,
            })),
            operation.signal,
          );
        } catch (error) {
          throw classifyOperationFailure(
            error,
            request.signal,
            operation,
            'Cloud model credential resolution failed.',
          );
        }

        let headers: Record<string, string>;
        try {
          headers = buildHeaders(credentialHeaders);
        } catch (error) {
          throw classifyOperationFailure(
            error,
            request.signal,
            operation,
            'Cloud model credential resolution failed.',
          );
        }
        let response: Response;
        try {
          throwIfAborted(operation.signal);
          response = await raceWithAbort(fetchImplementation(endpoint, {
            method: 'POST',
            signal: operation.signal,
            redirect: 'error',
            headers,
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: request.prompt }],
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'agent_decision',
                  strict: true,
                  schema: request.responseSchema,
                },
              },
              temperature,
              seed,
              max_tokens: maxTokens,
            }),
          }), operation.signal);
        } catch (error) {
          throw classifyOperationFailure(
            error,
            request.signal,
            operation,
            'Cloud model request failed.',
          );
        }

        if (!response.ok) throw httpError(response.status);

        let payload: ChatCompletionResponse;
        try {
          payload = await readJsonPayload(response, operation.signal);
        } catch (error) {
          throw classifyOperationFailure(
            error,
            request.signal,
            operation,
            'Cloud model returned invalid JSON.',
          );
        }
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('Cloud model returned no assistant message content.');
        }
        if (content.length > RUNTIME_LIMITS.modelDecisionCharacters) {
          throw new Error('Cloud model decision exceeded the runtime size limit.');
        }
        return content;
      } finally {
        operation.dispose();
      }
    },
  };
}

interface OperationSignal {
  dispose(): void;
  readonly signal: AbortSignal;
  timedOut(): boolean;
}

function createOperationSignal(parent: AbortSignal | undefined, timeoutMs: number): OperationSignal {
  const controller = new AbortController();
  let didTimeOut = false;
  const onAbort = (): void => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function classifyOperationFailure(
  error: unknown,
  parent: AbortSignal | undefined,
  operation: OperationSignal,
  fallbackMessage: string,
): Error {
  if (parent?.aborted) return abortError();
  if (operation.timedOut()) {
    return new Error('Cloud model request timed out.');
  }
  if (error instanceof CloudAdapterConfigurationError
    || error instanceof CloudAdapterResponseError) return error;
  return new Error(fallbackMessage);
}

function abortError(): DOMException {
  return new DOMException('Agent run cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function raceWithAbort<T>(source: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void source.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

class CloudAdapterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudAdapterConfigurationError';
  }
}

class CloudAdapterResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudAdapterResponseError';
  }
}

function validateEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('endpoint must be an absolute HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:') {
    throw new Error('endpoint must use HTTPS.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('endpoint must not contain credentials.');
  }
  if (endpoint.hash) throw new Error('endpoint must not contain a fragment.');
  for (const name of endpoint.searchParams.keys()) {
    if (SENSITIVE_QUERY_NAME.test(name)) {
      throw new Error('endpoint must not contain credential query parameters.');
    }
  }
  return endpoint.href;
}

function buildHeaders(values: Readonly<Record<string, string>>): Record<string, string> {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new CloudAdapterConfigurationError('Credential resolver must return a header object.');
  }
  const entries = Object.entries(values);
  if (entries.length > MAX_CREDENTIAL_HEADERS) {
    throw new CloudAdapterConfigurationError('Credential resolver returned too many headers.');
  }
  const headers: Record<string, string> = {};
  let totalCharacters = 0;
  for (const [name, value] of entries) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName
      || normalizedName.length > MAX_CREDENTIAL_HEADER_NAME_CHARACTERS
      || !isHeaderName(normalizedName)) {
      throw new CloudAdapterConfigurationError('Credential resolver returned an invalid header name.');
    }
    if (FORBIDDEN_CREDENTIAL_HEADERS.has(normalizedName)) {
      throw new CloudAdapterConfigurationError(`Credential resolver must not override ${normalizedName}.`);
    }
    if (Object.hasOwn(headers, normalizedName)) {
      throw new CloudAdapterConfigurationError('Credential resolver returned duplicate header names.');
    }
    if (typeof value !== 'string'
      || !value.trim()
      || value.length > MAX_CREDENTIAL_HEADER_VALUE_CHARACTERS
      || /[\r\n]/.test(value)) {
      throw new CloudAdapterConfigurationError('Credential resolver returned an invalid header value.');
    }
    totalCharacters += normalizedName.length + value.length;
    if (totalCharacters > MAX_CREDENTIAL_HEADERS_CHARACTERS) {
      throw new CloudAdapterConfigurationError('Credential resolver headers exceeded the size limit.');
    }
    headers[normalizedName] = value;
  }
  return { ...headers, accept: 'application/json', 'content-type': 'application/json' };
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(value);
}

async function readJsonPayload(response: Response, signal: AbortSignal): Promise<ChatCompletionResponse> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_BYTES) {
      throw new CloudAdapterResponseError('Cloud model response exceeded the size limit.');
    }
  }
  if (response.body === null) {
    const text = await raceWithAbort(response.text(), signal);
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new CloudAdapterResponseError('Cloud model response exceeded the size limit.');
    }
    return parsePayload(text);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await raceWithAbort(reader.read(), signal);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new CloudAdapterResponseError('Cloud model response exceeded the size limit.');
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // An aborted read can remain pending until the fetch implementation
      // observes cancellation. The best-effort cancel above owns cleanup.
    }
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CloudAdapterResponseError('Cloud model returned invalid UTF-8.');
  }
  return parsePayload(text);
}

function parsePayload(text: string): ChatCompletionResponse {
  try {
    return JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new CloudAdapterResponseError('Cloud model returned invalid JSON.');
  }
}

function httpError(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(`Cloud model authentication failed (HTTP ${status}).`);
  }
  if (status === 429) return new Error('Cloud model rate limit reached (HTTP 429).');
  return new Error(`Cloud model returned HTTP ${status}.`);
}
