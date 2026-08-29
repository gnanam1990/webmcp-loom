import { CreateMLCEngine } from '@mlc-ai/web-llm';
import type { RuntimeModel } from '@webmcp-loom/runtime';

export interface WebLlmRuntimeModelOptions {
  model: string;
  maxTokens?: number;
  onLoadProgress?: (progress: { progress: number; text: string }) => void;
  seed?: number;
  temperature?: number;
}

/** Runs an MLC-formatted open model directly in the browser via WebGPU. */
export async function createWebLlmRuntimeModel(
  options: WebLlmRuntimeModelOptions,
): Promise<RuntimeModel> {
  if (typeof navigator === 'undefined' || navigator.gpu === undefined) {
    throw new Error('WebGPU is unavailable in this browser.');
  }
  const engine = await CreateMLCEngine(options.model, {
    initProgressCallback: (report: { progress: number; text: string }) => {
      options.onLoadProgress?.({ progress: report.progress, text: report.text });
    },
  });
  return {
    async generate(request) {
      if (request.signal?.aborted) throw new DOMException('Agent run cancelled.', 'AbortError');
      const completion = await engine.chat.completions.create({
        messages: [{ role: 'user', content: request.prompt }],
        temperature: options.temperature ?? 0,
        seed: options.seed ?? 42,
        max_tokens: options.maxTokens ?? 128,
        response_format: {
          type: 'json_object',
          schema: JSON.stringify(request.responseSchema),
        },
        extra_body: { enable_thinking: false },
      });
      const content = completion.choices[0]?.message.content;
      if (typeof content !== 'string') {
        throw new Error('WebLLM returned no assistant message content.');
      }
      return content;
    },
  };
}
