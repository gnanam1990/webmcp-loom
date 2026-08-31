import { afterEach, describe, expect, it, vi } from 'vitest';

const { createEngine } = vi.hoisted(() => ({ createEngine: vi.fn() }));

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: createEngine,
}));

import { createWebLlmRuntimeModel } from './webllm.js';

afterEach(() => {
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

  it('fails clearly when the browser lacks WebGPU', async () => {
    vi.stubGlobal('navigator', {});
    await expect(createWebLlmRuntimeModel({ model: 'fixture' }))
      .rejects.toThrow('WebGPU is unavailable');
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
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
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
});
