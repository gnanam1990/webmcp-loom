import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOllamaRuntimeModel, inspectOllamaModel } from './ollama.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ollama local adapter', () => {
  it.each([
    ['host-only', 'http://localhost:11434', 'http://localhost:11434/api/chat'],
    ['trailing slash', 'http://localhost:11434/', 'http://localhost:11434/api/chat'],
    ['api suffix', 'http://localhost:11434/api', 'http://localhost:11434/api/chat'],
  ])('normalizes a %s URL and disables thinking', async (_label, baseUrl, endpoint) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: { content: '{"type":"final","message":"done"}' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const runtimeModel = createOllamaRuntimeModel({ baseUrl, model: 'qwen3:0.6b' });

    await expect(runtimeModel.generate({
      prompt: 'Return JSON.', responseSchema: { type: 'object' }, signal: undefined,
    })).resolves.toBe('{"type":"final","message":"done"}');

    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      body: expect.stringContaining('"think":false'), method: 'POST',
    }));
  });

  it('captures exact engine and artifact provenance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: '0.13.2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ name: 'qwen3:0.6b', digest: 'sha256:fixture' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        details: { family: 'qwen3', parameter_size: '0.6B', quantization_level: 'Q4_K_M' },
        model_info: { 'qwen3.context_length': 40_960 },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(inspectOllamaModel('http://localhost:11434/', 'qwen3:0.6b')).resolves.toEqual({
      contextLength: 40_960,
      digest: 'sha256:fixture',
      family: 'qwen3',
      model: 'qwen3:0.6b',
      parameterSize: '0.6B',
      quantization: 'Q4_K_M',
      serverVersion: '0.13.2',
    });
  });

  it('forwards cancellation to the local request', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const runtimeModel = createOllamaRuntimeModel({ baseUrl: 'http://localhost:11434', model: 'qwen3:0.6b' });
    const controller = new AbortController();
    const pending = runtimeModel.generate({ prompt: 'Return JSON.', responseSchema: {}, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
