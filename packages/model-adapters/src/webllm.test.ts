import { afterEach, describe, expect, it, vi } from 'vitest';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: createEngine,
}));

import { createWebLlmRuntimeModel } from './webllm.js';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('createWebLlmRuntimeModel', () => {
  it('reports load progress and forwards the runtime response schema', async () => {
    const complete = vi.fn(async () => ({
      choices: [{ message: { content: '{"type":"final","message":"done"}' } }],
    }));
    createEngine.mockImplementationOnce(async (_model, options) => {
      options.initProgressCallback({ progress: 0.5, text: 'Loading weights' });
      return { chat: { completions: { create: complete } } };
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const progress = vi.fn();
    const model = await createWebLlmRuntimeModel({
      model: 'Qwen3-1.7B-q4f16_1-MLC',
      onLoadProgress: progress,
    });

    const output = await model.generate({
      prompt: 'Return a decision.',
      responseSchema: { type: 'object' },
      signal: undefined,
    });

    expect(output).toBe('{"type":"final","message":"done"}');
    expect(progress).toHaveBeenCalledWith({ progress: 0.5, text: 'Loading weights' });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      response_format: { type: 'json_object', schema: '{"type":"object"}' },
      temperature: 0,
      seed: 42,
    }));
  });

  it('removes only an empty Qwen thinking transport prefix', async () => {
    const complete = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '<think>\n\n</think>\n\n{"type":"final","message":"done"}' } }],
    });
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({ model: 'fixture' });

    await expect(model.generate(request('empty thinking wrapper')))
      .resolves.toBe('{"type":"final","message":"done"}');
  });

  it('does not hide non-empty reasoning or other malformed framing', async () => {
    const framed = '<think>hidden reasoning</think>\n{"type":"final","message":"done"}';
    const complete = vi.fn().mockResolvedValue({
      choices: [{ message: { content: framed } }],
    });
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({ model: 'fixture' });

    await expect(model.generate(request('non-empty thinking wrapper'))).resolves.toBe(framed);
  });

  it('fails clearly when the browser lacks WebGPU', async () => {
    vi.stubGlobal('navigator', {});
    await expect(createWebLlmRuntimeModel({ model: 'fixture' }))
      .rejects.toThrow('WebGPU is unavailable');
  });

  it('fails clearly when WebLLM returns a choice without a message', async () => {
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{}] }) } },
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({ model: 'fixture' });

    await expect(model.generate(request('missing message')))
      .rejects.toThrow('WebLLM returned no assistant message content.');
  });

  it('supports a synchronous engine interrupt', async () => {
    let finishCompletion: ((value: WebLlmTestCompletion) => void) | undefined;
    const complete = vi.fn(() => new Promise<WebLlmTestCompletion>((resolve) => {
      finishCompletion = resolve;
    }));
    const interruptGenerate = vi.fn();
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
      interruptGenerate,
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({ model: 'fixture' });
    const controller = new AbortController();
    const cancelledResult = model.generate(request('cancel', controller.signal)).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());

    controller.abort();
    finishCompletion?.(completion('cancelled'));

    await expect(cancelledResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(interruptGenerate).toHaveBeenCalledOnce();
  });

  it('interrupts an in-flight generation before releasing the next caller', async () => {
    let finishInterrupt: (() => void) | undefined;
    let finishFirstCompletion: ((value: {
      choices: { message: { content: string } }[];
    }) => void) | undefined;
    const interruptGenerate = vi.fn(() => new Promise<void>((resolve) => {
      finishInterrupt = resolve;
    }));
    const firstCompletion = new Promise<{
      choices: { message: { content: string } }[];
    }>((resolve) => {
      finishFirstCompletion = resolve;
    });
    const complete = vi.fn()
      .mockReturnValueOnce(firstCompletion)
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"type":"final","message":"next"}' } }],
      });
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
      interruptGenerate,
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const runtimeModel = await createWebLlmRuntimeModel({ model: 'fixture' });
    const controller = new AbortController();

    const cancelled = runtimeModel.generate({
      prompt: 'First run.', responseSchema: { type: 'object' }, signal: controller.signal,
    });
    const cancelledResult = cancelled.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    controller.abort();
    await vi.waitFor(() => expect(interruptGenerate).toHaveBeenCalledOnce());

    const next = runtimeModel.generate({
      prompt: 'Second run.', responseSchema: { type: 'object' }, signal: undefined,
    });
    await Promise.resolve();
    expect(complete).toHaveBeenCalledTimes(1);

    finishInterrupt?.();
    await Promise.resolve();
    expect(complete).toHaveBeenCalledTimes(1);
    finishFirstCompletion?.({
      choices: [{ message: { content: '{"type":"final","message":"aborted"}' } }],
    });
    await expect(cancelledResult).resolves.toMatchObject({ name: 'AbortError' });
    await expect(next).resolves.toBe('{"type":"final","message":"next"}');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not start generation for an already-cancelled run', async () => {
    const complete = vi.fn();
    const interruptGenerate = vi.fn();
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
      interruptGenerate,
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const runtimeModel = await createWebLlmRuntimeModel({ model: 'fixture' });
    const controller = new AbortController();
    controller.abort();

    await expect(runtimeModel.generate({
      prompt: 'Cancelled.', responseSchema: { type: 'object' }, signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(complete).not.toHaveBeenCalled();
    expect(interruptGenerate).not.toHaveBeenCalled();
  });

  it('settles a cancelled queued caller before the active generation finishes', async () => {
    let finishFirst: ((value: WebLlmTestCompletion) => void) | undefined;
    const first = new Promise<WebLlmTestCompletion>((resolve) => {
      finishFirst = resolve;
    });
    const complete = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(completion('third'));
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
      interruptGenerate: vi.fn(),
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({ model: 'fixture' });
    const firstRun = model.generate(request('first'));
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());

    const controller = new AbortController();
    const queued = model.generate(request('second', controller.signal));
    const queuedResult = queued.then(
      () => null,
      (error: unknown) => error,
    );
    controller.abort();
    await expect(queuedResult).resolves.toMatchObject({ name: 'AbortError' });
    expect(complete).toHaveBeenCalledOnce();

    const third = model.generate(request('third'));
    finishFirst?.(completion('first'));
    await expect(firstRun).resolves.toContain('first');
    await expect(third).resolves.toContain('third');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an interrupted engine never drains', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(() => new Promise<WebLlmTestCompletion>(() => undefined));
    const interruptGenerate = vi.fn(() => new Promise<void>(() => undefined));
    createEngine.mockResolvedValueOnce({
      chat: { completions: { create: complete } },
      interruptGenerate,
    });
    vi.stubGlobal('navigator', { gpu: {} });
    const model = await createWebLlmRuntimeModel({
      model: 'fixture',
      cancellationTimeoutMs: 25,
    });
    const controller = new AbortController();
    const cancelled = model.generate(request('first', controller.signal));
    const cancelledResult = cancelled.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(cancelledResult).resolves.toMatchObject({ name: 'AbortError' });

    const next = model.generate(request('next'));
    const nextResult = next.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(25);
    await expect(nextResult).resolves.toMatchObject({
      message: expect.stringContaining('reload the model before retrying'),
    });
    expect(complete).toHaveBeenCalledOnce();
  });
});

interface WebLlmTestCompletion {
  choices: { message: { content: string } }[];
}

function completion(message: string): WebLlmTestCompletion {
  return { choices: [{ message: { content: `{"type":"final","message":"${message}"}` } }] };
}

function request(prompt: string, signal?: AbortSignal): {
  prompt: string;
  responseSchema: Record<string, unknown>;
  signal: AbortSignal | undefined;
} {
  return { prompt, responseSchema: { type: 'object' }, signal };
}
