import { CreateMLCEngine } from '@mlc-ai/web-llm';
import type { RuntimeModel } from '@webmcp-loom/runtime';

interface WebLlmCompletion {
  choices: readonly { message: { content: unknown } }[];
}

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
  let generationTail: Promise<void> = Promise.resolve();
  return {
    generate(request) {
      const generation = generationTail.then(async () => {
        throwIfAborted(request.signal);
        const completion = await runWithEngineCancellation<WebLlmCompletion>(
          () => engine.chat.completions.create({
            stream: false,
            messages: [{ role: 'user', content: request.prompt }],
            temperature: options.temperature ?? 0,
            seed: options.seed ?? 42,
            max_tokens: options.maxTokens ?? 128,
            response_format: {
              type: 'json_object',
              schema: JSON.stringify(request.responseSchema),
            },
            extra_body: { enable_thinking: false },
          }) as Promise<WebLlmCompletion>,
          request.signal,
          () => engine.interruptGenerate(),
        );
        const content = completion.choices[0]?.message.content;
        if (typeof content !== 'string') {
          throw new Error('WebLLM returned no assistant message content.');
        }
        return content;
      });
      generationTail = generation.then(() => undefined, () => undefined);
      return generation;
    },
  };
}

function abortError(): DOMException {
  return new DOMException('Agent run cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

/**
 * WebLLM owns one mutable generation pipeline per loaded model. Keep calls
 * serialized and do not release the next caller until an in-flight interrupt
 * has completed, otherwise cancelling one run can corrupt or cancel another.
 */
function runWithEngineCancellation<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
  interrupt: () => Promise<void>,
): Promise<T> {
  if (signal === undefined) return start();
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    let aborting = false;
    let work: Promise<T>;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      if (aborting) return;
      aborting = true;
      const interruption = Promise.resolve().then(interrupt);
      void Promise.allSettled([interruption, work]).then(() => {
        cleanup();
        reject(abortError());
      });
    };

    try {
      work = start();
    } catch (error) {
      reject(error);
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void work.then(
      (value) => {
        if (aborting) return;
        if (signal.aborted) {
          onAbort();
          return;
        }
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (aborting) return;
        cleanup();
        reject(error);
      },
    );
  });
}
