import type { RuntimeModel } from '@webmcp-loom/runtime';

export interface OllamaRuntimeModelOptions {
  baseUrl: string;
  maxTokens?: number;
  model: string;
  seed?: number;
  temperature?: number;
}

export interface OllamaModelProvenance {
  contextLength?: number;
  digest: string;
  family?: string;
  model: string;
  parameterSize?: string;
  quantization?: string;
  serverVersion: string;
}

interface OllamaChatResponse {
  message?: { content?: unknown };
}

/**
 * Uses Ollama's native local endpoint so the benchmark can explicitly disable
 * model thinking and pass the runtime's exact JSON Schema without relying on
 * an OpenAI-compatibility shim.
 */
export function createOllamaRuntimeModel(options: OllamaRuntimeModelOptions): RuntimeModel {
  const endpoint = `${normalizeBaseUrl(options.baseUrl)}/api/chat`;
  return {
    async generate(request) {
      const response = await fetch(endpoint, {
        method: 'POST',
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: false,
          think: false,
          format: request.responseSchema,
          messages: [{ role: 'user', content: request.prompt }],
          options: {
            temperature: options.temperature ?? 0,
            seed: options.seed ?? 42,
            num_predict: options.maxTokens ?? 128,
          },
        }),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
      const payload = await response.json() as OllamaChatResponse;
      const content = payload.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Ollama returned no assistant message content.');
      }
      return content;
    },
  };
}

/** Captures local engine and artifact identity required by the benchmark protocol. */
export async function inspectOllamaModel(
  baseUrl: string,
  model: string,
  signal?: AbortSignal,
): Promise<OllamaModelProvenance> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const [versionResponse, tagsResponse, showResponse] = await Promise.all([
    fetch(`${normalizedBaseUrl}/api/version`, ...(signal === undefined ? [] : [{ signal }])),
    fetch(`${normalizedBaseUrl}/api/tags`, ...(signal === undefined ? [] : [{ signal }])),
    fetch(`${normalizedBaseUrl}/api/show`, {
      method: 'POST',
      ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    }),
  ]);
  if (!versionResponse.ok) throw new Error(`Ollama version endpoint returned HTTP ${versionResponse.status}.`);
  if (!tagsResponse.ok) throw new Error(`Ollama model inventory returned HTTP ${tagsResponse.status}.`);
  if (!showResponse.ok) throw new Error(`Ollama model inspection returned HTTP ${showResponse.status}.`);
  const version = await versionResponse.json() as { version?: unknown };
  const tags = await tagsResponse.json() as { models?: readonly { digest?: unknown; model?: unknown; name?: unknown }[] };
  const show = await showResponse.json() as {
    details?: {
      family?: unknown;
      parameter_size?: unknown;
      quantization_level?: unknown;
    } & Record<string, unknown>;
    model_info?: Record<string, unknown>;
  };
  if (typeof version.version !== 'string' || !version.version) {
    throw new Error('Ollama version response did not include a version.');
  }
  const artifact = tags.models?.find((candidate) => candidate.name === model || candidate.model === model);
  if (typeof artifact?.digest !== 'string' || !artifact.digest) {
    throw new Error('Ollama model inspection did not include an artifact digest.');
  }
  const details = show.details ?? {};
  const contextLength = findContextLength(show.model_info);
  return {
    ...(contextLength === undefined ? {} : { contextLength }),
    digest: artifact.digest,
    ...(typeof details.family === 'string' ? { family: details.family } : {}),
    model,
    ...(typeof details.parameter_size === 'string' ? { parameterSize: details.parameter_size } : {}),
    ...(typeof details.quantization_level === 'string' ? { quantization: details.quantization_level } : {}),
    serverVersion: version.version,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
}

function findContextLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (modelInfo === undefined) return undefined;
  const value = Object.entries(modelInfo).find(([key]) => key.endsWith('.context_length'))?.[1];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
