import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLlamaCppRuntimeModel } from './llama-cpp.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createLlamaCppRuntimeModel', () => {
  it.each([
    ['host-only', 'http://localhost:8080', 'http://localhost:8080/v1/chat/completions'],
    ['trailing slash', 'http://localhost:8080/', 'http://localhost:8080/v1/chat/completions'],
    ['versioned base', 'http://localhost:8080/v1', 'http://localhost:8080/v1/chat/completions'],
    ['versioned base with slash', 'http://localhost:8080/v1/', 'http://localhost:8080/v1/chat/completions'],
  ])('normalizes a %s URL', async (_label, baseUrl, expectedEndpoint) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"type":"final","message":"done"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const runtimeModel = createLlamaCppRuntimeModel({ baseUrl, model: 'fixture.gguf' });

    await expect(runtimeModel.generate({
      prompt: 'Return JSON.',
      responseSchema: { type: 'object' },
      signal: undefined,
    })).resolves.toBe('{"type":"final","message":"done"}');

    expect(fetchMock).toHaveBeenCalledWith(expectedEndpoint, expect.objectContaining({
      method: 'POST',
    }));
  });

  it('forwards cancellation to fetch', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const runtimeModel = createLlamaCppRuntimeModel({
      baseUrl: 'http://localhost:8080/v1', model: 'fixture.gguf',
    });
    const controller = new AbortController();
    const pending = runtimeModel.generate({
      prompt: 'Return JSON.', responseSchema: { type: 'object' }, signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
