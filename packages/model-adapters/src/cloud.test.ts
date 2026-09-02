import {
  createStaticToolProvider,
  runAgentRuntime,
  type RuntimeModelRequest,
} from '@webmcp-loom/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleCloudRuntimeModel } from './cloud.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createOpenAiCompatibleCloudRuntimeModel', () => {
  it('forwards the exact runtime schema with deterministic defaults', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () => completionResponse('{"type":"final","message":"done"}'),
    );
    const resolveCredentialHeaders = vi.fn(() => ({ Authorization: 'Bearer fixture-token' }));
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'provider/model-1',
      resolveCredentialHeaders,
    });
    const request = runtimeRequest();

    await expect(model.generate(request)).resolves.toBe('{"type":"final","message":"done"}');

    expect(resolveCredentialHeaders).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe('https://models.example.test/v1/chat/completions');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: 'Bearer fixture-token',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'provider/model-1',
      messages: [{ role: 'user', content: request.prompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'agent_decision',
          strict: true,
          schema: request.responseSchema,
        },
      },
      temperature: 0,
      seed: 42,
      max_tokens: 128,
    });
  });

  it('resolves fresh credential headers for every generation', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(
      async () => completionResponse('{"type":"final","message":"done"}'),
    );
    const resolveCredentialHeaders = vi.fn()
      .mockReturnValueOnce({ 'X-API-Key': 'first-fixture' })
      .mockReturnValueOnce({ 'X-API-Key': 'second-fixture' });
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'fixture',
      resolveCredentialHeaders,
    });

    await model.generate(runtimeRequest());
    await model.generate(runtimeRequest());

    expect(resolveCredentialHeaders).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-api-key': 'first-fixture' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'x-api-key': 'second-fixture' });
  });

  it.each([
    ['relative', '/v1/chat/completions', 'absolute HTTPS URL'],
    ['plain HTTP', 'http://models.example.test/v1/chat/completions', 'must use HTTPS'],
    ['embedded credentials', 'https://user:pass@models.example.test/v1/chat/completions', 'must not contain credentials'],
    ['fragment', 'https://models.example.test/v1/chat/completions#secret', 'must not contain a fragment'],
    ['credential query', 'https://models.example.test/v1/chat/completions?api_key=fixture', 'credential query parameters'],
    ['camel-case token query', 'https://models.example.test/v1/chat/completions?authToken=fixture', 'credential query parameters'],
    ['generic key query', 'https://models.example.test/v1/chat/completions?key=fixture', 'credential query parameters'],
  ])('rejects a %s endpoint before a request is possible', (_label, endpoint, message) => {
    expect(() => createOpenAiCompatibleCloudRuntimeModel({
      endpoint,
      fetch: vi.fn(),
      model: 'fixture',
      resolveCredentialHeaders: () => ({}),
    })).toThrow(message);
  });

  it('rejects invalid timeout and model configuration before resolving credentials', () => {
    expect(() => createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: vi.fn(),
      model: 'fixture',
      resolveCredentialHeaders: () => ({}),
      timeoutMs: 0,
    })).toThrow('timeoutMs must be a positive safe integer');
    expect(() => createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: vi.fn(),
      model: '   ',
      resolveCredentialHeaders: () => ({}),
    })).toThrow('model must not be empty');
  });

  it.each([
    ['fractional timeout', { timeoutMs: 1.5 }, 'timeoutMs must be a positive safe integer'],
    ['oversized timeout', { timeoutMs: 2_147_483_648 }, 'timeoutMs must be a positive safe integer'],
    ['zero max tokens', { maxTokens: 0 }, 'maxTokens must be a positive safe integer'],
    ['fractional max tokens', { maxTokens: 1.5 }, 'maxTokens must be a positive safe integer'],
    ['oversized max tokens', { maxTokens: 4_097 }, 'no greater than 4096'],
    ['fractional seed', { seed: 1.5 }, 'seed must be a safe integer'],
    ['negative temperature', { temperature: -0.1 }, 'temperature must be a finite number between 0 and 2'],
    ['oversized temperature', { temperature: 2.1 }, 'temperature must be a finite number between 0 and 2'],
  ])('rejects %s configuration', (_label, extra, message) => {
    expect(() => createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: vi.fn(),
      model: 'fixture',
      resolveCredentialHeaders: () => ({}),
      ...extra,
    })).toThrow(message);
  });

  it.each([
    ['protected content type', { 'Content-Type': 'text/plain' }, 'must not override content-type'],
    ['invalid value', { Authorization: 'Bearer fixture\r\nX-Injected: yes' }, 'invalid header value'],
    ['invalid name', { 'bad header': 'fixture' }, 'invalid header name'],
    ['hop-by-hop host', { Host: 'attacker.example.test' }, 'must not override host'],
    ['case-folded duplicate', { Authorization: 'first', authorization: 'second' }, 'duplicate header names'],
    ['oversized value', { Authorization: `Bearer ${'x'.repeat(8_193)}` }, 'invalid header value'],
  ])('fails closed for %s credential headers', async (_label, headers, message) => {
    const fetchMock = vi.fn();
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'fixture',
      resolveCredentialHeaders: () => headers,
    });

    await expect(model.generate(runtimeRequest())).rejects.toThrow(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels while credentials are resolving without starting a request', async () => {
    const fetchMock = vi.fn();
    const resolveCredentialHeaders = vi.fn(() => new Promise<Record<string, string>>(() => undefined));
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'fixture',
      resolveCredentialHeaders,
    });
    const controller = new AbortController();
    const pending = model.generate(runtimeRequest(controller.signal));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not resolve credentials for an already-cancelled request', async () => {
    const resolveCredentialHeaders = vi.fn(() => ({}));
    const fetchMock = vi.fn();
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'fixture',
      resolveCredentialHeaders,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(model.generate(runtimeRequest(controller.signal)))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(resolveCredentialHeaders).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards cancellation to an in-flight request', async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: fetchMock,
      model: 'fixture',
      resolveCredentialHeaders: () => ({}),
    });
    const controller = new AbortController();
    const pending = model.generate(runtimeRequest(controller.signal));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds credential and network time with one fail-closed timeout', async () => {
    vi.useFakeTimers();
    const model = createOpenAiCompatibleCloudRuntimeModel({
      endpoint: 'https://models.example.test/v1/chat/completions',
      fetch: vi.fn(() => new Promise<Response>(() => undefined)),
      model: 'fixture',
      resolveCredentialHeaders: () => ({}),
      timeoutMs: 25,
    });
    const pending = model.generate(runtimeRequest());
    const result = pending.then(() => null, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({ message: 'Cloud model request timed out.' });
  });

  it.each([
    [401, 'authentication failed (HTTP 401)'],
    [403, 'authentication failed (HTTP 403)'],
    [429, 'rate limit reached (HTTP 429)'],
    [500, 'returned HTTP 500'],
  ])('normalizes HTTP %i without reading a provider error body', async (status, message) => {
    const response = new Response('provider-secret-detail', { status });
    const bodyReader = vi.spyOn(response, 'json');
    const model = cloudModel(async () => response);

    await expect(model.generate(runtimeRequest())).rejects.toThrow(message);
    expect(bodyReader).not.toHaveBeenCalled();
  });

  it('normalizes transport, malformed payload and empty-content failures', async () => {
    await expect(cloudModel(async () => {
      throw new TypeError('socket included a sensitive provider URL');
    }).generate(runtimeRequest())).rejects.toThrow('Cloud model request failed.');

    await expect(cloudModel(async () => new Response('not-json', { status: 200 }))
      .generate(runtimeRequest())).rejects.toThrow('Cloud model returned invalid JSON.');

    await expect(cloudModel(async () => completionResponse('   '))
      .generate(runtimeRequest())).rejects.toThrow('Cloud model returned no assistant message content.');
  });

  it('bounds the remote response and extracted decision sizes', async () => {
    const oversizedBody = new Response('x', {
      status: 200,
      headers: { 'content-length': '512001' },
    });
    await expect(cloudModel(async () => oversizedBody).generate(runtimeRequest()))
      .rejects.toThrow('Cloud model response exceeded the size limit.');

    const oversizedDecision = 'x'.repeat(50_001);
    await expect(cloudModel(async () => completionResponse(oversizedDecision)).generate(runtimeRequest()))
      .rejects.toThrow('Cloud model decision exceeded the runtime size limit.');
  });

  it('cannot bypass runtime approval for a write-capable tool', async () => {
    const execute = vi.fn();
    const model = cloudModel(async () => completionResponse(JSON.stringify({
      type: 'tool_call', tool: 'stage_item', input: { id: 'item-1' },
    })));

    const result = await runAgentRuntime({
      goal: 'Stage item one.',
      model,
      toolProvider: createStaticToolProvider([{
        name: 'stage_item',
        title: 'Stage item',
        description: 'Stages a reversible item.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute,
      }]),
    });

    expect(result).toMatchObject({
      status: 'approval_required',
      pendingApproval: { tool: { name: 'stage_item' }, input: { id: 'item-1' } },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

function cloudModel(fetchImplementation: typeof globalThis.fetch) {
  return createOpenAiCompatibleCloudRuntimeModel({
    endpoint: 'https://models.example.test/v1/chat/completions',
    fetch: fetchImplementation,
    model: 'fixture',
    resolveCredentialHeaders: () => ({}),
  });
}

function completionResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function runtimeRequest(signal?: AbortSignal): RuntimeModelRequest {
  return {
    prompt: 'Return one JSON decision.',
    responseSchema: {
      type: 'object',
      properties: { type: { enum: ['final'] }, message: { type: 'string' } },
      required: ['type', 'message'],
      additionalProperties: false,
    },
    signal,
  };
}
