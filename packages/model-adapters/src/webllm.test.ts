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
});
