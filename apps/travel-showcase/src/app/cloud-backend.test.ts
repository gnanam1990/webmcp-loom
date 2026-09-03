import { describe, expect, it, vi } from 'vitest';
import { createTravelApplication } from './application.js';
import { createTravelCloudBackend } from './cloud-backend.js';
import type { RuntimeModelRequest } from '@webmcp-loom/runtime';

const responseSchema = {
  type: 'object' as const,
  properties: { type: { type: 'string' as const } },
  required: ['type'],
  additionalProperties: false,
};

describe('travel cloud backend integration', () => {
  it('creates an explicit cloud descriptor without exposing transport details', () => {
    const cloud = createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'private-model-id',
      label: 'Cloud · Team gateway',
      resolveCredentialHeaders: () => ({ authorization: 'Bearer do-not-render' }),
      fetch: vi.fn(),
    });

    expect(cloud.backend).toEqual({
      status: 'ready',
      backend: {
        id: 'openai-compatible-cloud',
        kind: 'cloud',
        label: 'Cloud · Team gateway',
        detail: expect.stringMatching(/prompts are sent/i),
      },
    });
    expect(JSON.stringify(cloud.backend)).not.toContain('models.example.test');
    expect(JSON.stringify(cloud.backend)).not.toContain('private-model-id');
    expect(JSON.stringify(cloud.backend)).not.toContain('do-not-render');
  });

  it('uses the cloud adapter through the normal application session', async () => {
    const resolveCredentialHeaders = vi.fn(() => ({ authorization: 'Bearer short-lived' }));
    const fetchImplementation = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        type: 'final',
        message: 'Cloud model completed.',
      }) } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const cloud = createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'team-model',
      resolveCredentialHeaders,
      fetch: fetchImplementation,
    });
    const application = createTravelApplication(undefined, cloud);

    await application.session.run('Inspect the plan without changing it.');

    expect(application.session.getSnapshot()).toMatchObject({
      backend: { status: 'ready', backend: { kind: 'cloud' } },
      note: 'Cloud model completed.',
      status: 'completed',
    });
    expect(resolveCredentialHeaders).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('resolves fresh credentials for every request', async () => {
    const resolvedHeaders = [
      { authorization: 'Bearer first' },
      { authorization: 'Bearer second' },
    ];
    const resolveCredentialHeaders = vi.fn(() => resolvedHeaders.shift() ?? {});
    const fetchImplementation = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"type":"final","message":"Done."}' } }],
    }), { status: 200 }));
    const cloud = createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'team-model',
      resolveCredentialHeaders,
      fetch: fetchImplementation,
    });
    const request: RuntimeModelRequest = {
      prompt: 'Return the final response.',
      responseSchema,
      signal: undefined,
    };
    const trip = createTravelApplication().session.getSnapshot().trip;

    await cloud.createModel(trip).generate(request);
    await cloud.createModel(trip).generate(request);

    expect(resolveCredentialHeaders).toHaveBeenCalledTimes(2);
    expect(fetchImplementation.mock.calls.map(([, init]) => (
      init?.headers as Record<string, string>
    ).authorization)).toEqual(['Bearer first', 'Bearer second']);
  });

  it('reports cloud transport failure without falling back to the scripted model', async () => {
    const application = createTravelApplication(undefined, createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'team-model',
      resolveCredentialHeaders: () => ({}),
      fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 503 })),
    }));

    await application.session.run('Inspect the plan.');

    expect(application.session.getSnapshot()).toMatchObject({
      backend: { status: 'ready', backend: { kind: 'cloud' } },
      note: 'Cloud model returned HTTP 503.',
      status: 'failed',
      trip: { items: [], revision: 1 },
    });
  });

  it('rejects labels that could damage the visible backend indicator', () => {
    const create = (label: string) => createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'team-model',
      label,
      resolveCredentialHeaders: () => ({}),
      fetch: vi.fn(),
    });

    expect(() => create('   ')).toThrow('must not be empty');
    expect(() => create('Cloud\nspoofed status')).toThrow('must be plain text');
    expect(() => create('x'.repeat(81))).toThrow('no longer than 80');
    expect(() => create(`Cloud${String.fromCodePoint(0x202e)}spoofed status`))
      .toThrow('must be plain text');
    expect(() => create(`Cloud${String.fromCodePoint(0x2066)}spoofed status`))
      .toThrow('must be plain text');
  });

  it('counts visible astral Unicode as code points for the label limit', () => {
    const create = (label: string) => createTravelCloudBackend({
      endpoint: 'https://models.example.test/v1/chat/completions',
      model: 'team-model',
      label,
      resolveCredentialHeaders: () => ({}),
      fetch: vi.fn(),
    });

    expect(create('🚀'.repeat(80)).backend.backend.label).toBe('🚀'.repeat(80));
    expect(() => create('🚀'.repeat(81))).toThrow('no longer than 80');
  });
});
