import type { RuntimeModel } from '@webmcp-loom/runtime';

export interface LlamaCppRuntimeModelOptions {
  baseUrl: string;
  model: string;
  seed?: number;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Adapts llama.cpp's OpenAI-compatible chat endpoint to the model-neutral
 * runtime contract. The runtime supplies a phase-specific JSON Schema; this
 * adapter forwards it unchanged rather than reparsing or weakening it.
 */
export function createLlamaCppRuntimeModel(
  options: LlamaCppRuntimeModelOptions,
): RuntimeModel {
  const normalizedBaseUrl = options.baseUrl.replace(/\/+$/, '');
  const versionedBaseUrl = normalizedBaseUrl.endsWith('/v1')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/v1`;
  const endpoint = `${versionedBaseUrl}/chat/completions`;
  return {
    async generate(request) {
      const response = await fetch(endpoint, {
        method: 'POST',
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          messages: [{ role: 'user', content: request.prompt }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'agent_decision', schema: request.responseSchema },
          },
          chat_template_kwargs: { enable_thinking: false },
          temperature: options.temperature ?? 0,
          seed: options.seed ?? 42,
          max_tokens: options.maxTokens ?? 128,
        }),
      });
      if (!response.ok) {
        throw new Error(`llama.cpp returned HTTP ${response.status}.`);
      }
      const payload = await response.json() as {
        choices?: readonly { message?: { content?: unknown } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('llama.cpp returned no assistant message content.');
      }
      return content;
    },
  };
}
