import { CreateMLCEngine } from '@mlc-ai/web-llm';
import type { RuntimeModel } from '@webmcp-loom/runtime';

interface WebLlmCompletion {
  choices: readonly { message?: { content?: unknown } }[];
}

const EMPTY_THINKING_PREFIX = /^\s*<think>\s*<\/think>\s*/;

export interface WebLlmRuntimeModelOptions {
  /** Maximum time to wait for an interrupted engine to become safe to reuse. */
  cancellationTimeoutMs?: number;
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
  const cancellationTimeoutMs = options.cancellationTimeoutMs ?? 10_000;
  if (!Number.isFinite(cancellationTimeoutMs) || cancellationTimeoutMs <= 0) {
    throw new Error('cancellationTimeoutMs must be a positive finite number.');
  }
  if (typeof navigator === 'undefined' || navigator.gpu === undefined) {
    throw new Error('WebGPU is unavailable in this browser.');
  }
  const engine = await CreateMLCEngine(options.model, {
    initProgressCallback: (report: { progress: number; text: string }) => {
      options.onLoadProgress?.({ progress: report.progress, text: report.text });
    },
  });
  let generationTail: Promise<void> = Promise.resolve();
  let terminalFailure: Error | null = null;
  return {
    generate(request) {
      const scheduled = generationTail.then(() => {
        if (terminalFailure !== null) throw terminalFailure;
        throwIfAborted(request.signal);
        return runWithEngineCancellation<WebLlmCompletion>(
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
          cancellationTimeoutMs,
        );
      });
      const generation = scheduled.then(async ({ result }) => {
        const completion = await result;
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('WebLLM returned no assistant message content.');
        }
        // Some Qwen WebLLM templates emit an empty thinking transport block
        // even when `enable_thinking` is false. Remove only that empty prefix;
        // non-empty reasoning, fences, prose and malformed JSON still reach the
        // runtime unchanged and therefore fail its strict decision parser.
        return content.replace(EMPTY_THINKING_PREFIX, '');
      });
      generationTail = scheduled.then(({ drain }) => drain).catch((error: unknown) => {
        if (error instanceof WebLlmCancellationTimeoutError) terminalFailure = error;
      });
      // The caller-facing abort race can settle before a queued generation is
      // reached. Keep the later internal rejection observed as well.
      void generation.catch(() => undefined);
      return rejectWhenAborted(generation, request.signal);
    },
  };
}

function abortError(): DOMException {
  return new DOMException('Agent run cancelled.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

class WebLlmCancellationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`WebLLM did not stop within ${timeoutMs}ms after cancellation; reload the model before retrying.`);
    this.name = 'WebLlmCancellationTimeoutError';
  }
}

interface EngineGeneration<T> {
  /** Caller-facing result; cancellation rejects this immediately. */
  result: Promise<T>;
  /** Queue-facing safety gate; later generations wait for this. */
  drain: Promise<void>;
}

/**
 * WebLLM owns one mutable generation pipeline per loaded model. Keep calls
 * serialized and do not release the next caller until an in-flight interrupt
 * has completed, otherwise cancelling one run can corrupt or cancel another.
 */
function runWithEngineCancellation<T>(
  start: () => Promise<T>,
  signal: AbortSignal | undefined,
  interrupt: () => void | Promise<void>,
  timeoutMs: number,
): EngineGeneration<T> {
  if (signal?.aborted) {
    return { result: Promise.reject(abortError()), drain: Promise.resolve() };
  }

  let work: Promise<T>;
  try {
    work = start();
  } catch (error) {
    return { result: Promise.reject(error), drain: Promise.resolve() };
  }
  if (signal === undefined) {
    return { result: work, drain: work.then(() => undefined, () => undefined) };
  }

  let resolveDrain!: () => void;
  let rejectDrain!: (error: Error) => void;
  const drain = new Promise<void>((resolve, reject) => {
    resolveDrain = resolve;
    rejectDrain = reject;
  });
  const result = new Promise<T>((resolve, reject) => {
    let aborting = false;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const onAbort = (): void => {
      if (aborting) return;
      aborting = true;
      cleanup();
      reject(abortError());
      const interruption = Promise.resolve().then(interrupt);
      const timeout = setTimeout(() => {
        rejectDrain(new WebLlmCancellationTimeoutError(timeoutMs));
      }, timeoutMs);
      void Promise.allSettled([interruption, work]).then(() => {
        clearTimeout(timeout);
        resolveDrain();
      });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    void work.then(
      (value) => {
        if (aborting) return;
        cleanup();
        resolve(value);
        resolveDrain();
      },
      (error: unknown) => {
        if (aborting) return;
        cleanup();
        reject(error);
        resolveDrain();
      },
    );
  });
  return { result, drain };
}

/** Rejects a queued caller promptly without allowing it to overtake the engine queue. */
function rejectWhenAborted<T>(source: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return source;
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
