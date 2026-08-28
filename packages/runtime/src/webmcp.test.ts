import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgentRuntime } from './runtime.js';
import type { RuntimeTool } from './types.js';
import {
  createWebMcpToolProvider,
  installDocumentRuntimeTools,
  registerRuntimeTools,
} from './webmcp.js';
import type {
  RegisteredWebMcpTool,
  WebMcpModelContext,
  WebMcpToolDefinition,
} from './webmcp.js';

function runtimeTool(overrides: Partial<RuntimeTool> = {}): RuntimeTool {
  return {
    name: 'inspect',
    title: 'Inspect',
    description: 'Inspect a fixture.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: ({ id }) => ({ id, ready: true }),
    ...overrides,
  };
}

function registered(overrides: Partial<RegisteredWebMcpTool> = {}): RegisteredWebMcpTool {
  return {
    name: 'inspect',
    title: 'Inspect',
    description: 'Inspect a fixture.',
    inputSchema: runtimeTool().inputSchema,
    origin: 'https://example.test',
    annotations: { readOnlyHint: true },
    ...overrides,
  };
}

function context(overrides: Partial<WebMcpModelContext> = {}): WebMcpModelContext {
  return {
    registerTool: vi.fn(async () => undefined),
    getTools: vi.fn(async () => [registered()]),
    executeTool: vi.fn(async () => JSON.stringify({ ready: true })),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registerRuntimeTools', () => {
  it('registers canonical definitions and disposes all tools with one signal', async () => {
    const definitions: WebMcpToolDefinition[] = [];
    const signals: AbortSignal[] = [];
    const modelContext = context({
      registerTool: vi.fn(async (definition, options) => {
        definitions.push(definition);
        if (options?.signal !== undefined) signals.push(options.signal);
      }),
    });
    const execute = vi.fn(() => ({ ready: true }));
    const registration = await registerRuntimeTools(modelContext, [
      runtimeTool({ execute }),
      runtimeTool({ name: 'inspect_second', title: 'Inspect second' }),
    ], { exposedTo: ['https://agent.test'] });

    expect(definitions.map(({ name }) => name).sort()).toEqual(['inspect', 'inspect_second']);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(false);
    expect(await definitions[0]?.execute({ id: 'fixture-1' }, { signal: undefined }))
      .toEqual({ ready: true });
    expect(execute).toHaveBeenCalledWith({ id: 'fixture-1' }, { signal: undefined });

    registration.dispose();
    registration.dispose();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('aborts registrations if any registration fails', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const modelContext = context({
      registerTool: vi.fn(async (_definition, options) => {
        if (options?.signal !== undefined) signals.push(options.signal);
        calls += 1;
        if (calls === 2) throw new Error('registration rejected');
      }),
    });
    await expect(registerRuntimeTools(modelContext, [
      runtimeTool(),
      runtimeTool({ name: 'inspect_second', title: 'Inspect second' }),
    ])).rejects.toMatchObject({ code: 'invalid_tool' });
    expect(signals.every(({ aborted }) => aborted)).toBe(true);
  });

  it('forwards external cancellation to registered tools', async () => {
    const external = new AbortController();
    let registeredSignal: AbortSignal | undefined;
    const modelContext = context({
      registerTool: vi.fn(async (_definition, options) => {
        registeredSignal = options?.signal;
      }),
    });
    await registerRuntimeTools(modelContext, [runtimeTool()], { signal: external.signal });
    external.abort();
    expect(registeredSignal?.aborted).toBe(true);
  });

  it('returns promptly when cancellation interrupts a pending registration', async () => {
    const external = new AbortController();
    const modelContext = context({
      registerTool: vi.fn(() => new Promise<void>(() => undefined)),
    });
    const pending = registerRuntimeTools(modelContext, [runtimeTool()], {
      signal: external.signal,
    });
    external.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('createWebMcpToolProvider', () => {
  it('normalizes registered tools and defaults missing readOnlyHint to write-capable', async () => {
    const withoutAnnotations = registered();
    delete withoutAnnotations.annotations;
    const modelContext = context({
      getTools: vi.fn(async () => [withoutAnnotations]),
    });
    const provider = createWebMcpToolProvider(modelContext, {
      fromOrigins: ['https://example.test'],
    });
    const tools = await provider.getTools({ signal: undefined });
    expect(tools[0]).toMatchObject({
      name: 'inspect',
      origin: 'https://example.test',
      annotations: { readOnlyHint: false },
      inputSchema: { type: 'object' },
    });
    expect(modelContext.getTools).toHaveBeenCalledWith({
      fromOrigins: ['https://example.test'],
    });
  });

  it('accepts legacy serialized schemas while using the current object contract', async () => {
    const legacyContext = context({
      getTools: vi.fn(async () => [registered({
        inputSchema: JSON.stringify(runtimeTool().inputSchema),
      })]),
    });
    const tools = await createWebMcpToolProvider(legacyContext)
      .getTools({ signal: undefined });

    expect(tools[0]?.inputSchema).toEqual(runtimeTool().inputSchema);
  });

  it('does not trust a WebMCP read-only hint without an explicit origin allowlist', async () => {
    const modelContext = context();
    const untrustedTools = await createWebMcpToolProvider(modelContext)
      .getTools({ signal: undefined });
    const trustedTools = await createWebMcpToolProvider(modelContext, {
      trustedReadOnlyOrigins: ['https://example.test/app'],
    }).getTools({ signal: undefined });

    expect(untrustedTools[0]?.annotations.readOnlyHint).toBe(false);
    expect(trustedTools[0]?.annotations.readOnlyHint).toBe(true);
  });

  it('requires approval when an untrusted WebMCP tool claims to be read-only', async () => {
    const modelContext = context();
    const result = await runAgentRuntime({
      goal: 'Inspect the fixture.',
      model: {
        generate: async () => JSON.stringify({
          type: 'tool_call',
          tool: 'inspect',
          input: { id: 'fixture-1' },
        }),
      },
      toolProvider: createWebMcpToolProvider(modelContext),
    });

    expect(result.status).toBe('approval_required');
    expect(modelContext.executeTool).not.toHaveBeenCalled();
  });

  it('rejects invalid or excessive trusted read-only origin configuration', () => {
    expect(() => createWebMcpToolProvider(context(), {
      trustedReadOnlyOrigins: ['data:text/plain,unsafe'],
    })).toThrow(/tuple origin/);
    expect(() => createWebMcpToolProvider(context(), {
      trustedReadOnlyOrigins: Array.from(
        { length: 65 },
        (_, index) => `https://trusted-${index}.example`,
      ),
    })).toThrow(/64-origin limit/);
  });

  it('forwards the exact active descriptor, input and abort signal to executeTool', async () => {
    const active = registered();
    const modelContext = context({
      getTools: vi.fn(async () => [active]),
      executeTool: vi.fn(async () => JSON.stringify({ id: 'fixture-1', ready: true })),
    });
    const provider = createWebMcpToolProvider(modelContext);
    const tools = await provider.getTools({ signal: undefined });
    const controller = new AbortController();
    const result = await tools[0]?.execute(
      { id: 'fixture-1' },
      { signal: controller.signal, expectedStateRevision: undefined },
    );
    expect(result).toEqual({ id: 'fixture-1', ready: true });
    expect(modelContext.executeTool).toHaveBeenCalledWith(
      active,
      { id: 'fixture-1' },
      { signal: controller.signal },
    );
  });

  it('preserves plain-text WebMCP results', async () => {
    const modelContext = context({ executeTool: vi.fn(async () => 'plain result') });
    const tools = await createWebMcpToolProvider(modelContext)
      .getTools({ signal: undefined });
    await expect(tools[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    })).resolves.toBe('plain result');
  });

  it('rejects changed, missing or ambiguous active descriptors', async () => {
    const changedContext = context({
      getTools: vi.fn()
        .mockResolvedValueOnce([registered()])
        .mockResolvedValueOnce([registered({ description: 'Changed.' })]),
    });
    const changed = await createWebMcpToolProvider(changedContext)
      .getTools({ signal: undefined });
    await expect(changed[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    }))
      .rejects.toMatchObject({ code: 'tool_changed' });

    const missingContext = context({
      getTools: vi.fn()
        .mockResolvedValueOnce([registered()])
        .mockResolvedValueOnce([]),
    });
    const missing = await createWebMcpToolProvider(missingContext)
      .getTools({ signal: undefined });
    await expect(missing[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    }))
      .rejects.toMatchObject({ code: 'tool_unavailable' });

    const ambiguousContext = context({
      getTools: vi.fn(async () => [registered(), registered()]),
    });
    const ambiguous = await createWebMcpToolProvider(ambiguousContext)
      .getTools({ signal: undefined });
    await expect(ambiguous[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    }))
      .rejects.toMatchObject({ code: 'tool_unavailable' });
  });

  it('rejects malformed schemas, non-array registries and non-string results', async () => {
    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => [registered({ inputSchema: '{' })]),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'invalid_tool' });

    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => ({ invalid: true }) as never),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'invalid_tool' });

    const invalidResultContext = context({
      executeTool: vi.fn(async () => ({ invalid: true }) as never),
    });
    const tools = await createWebMcpToolProvider(invalidResultContext)
      .getTools({ signal: undefined });
    await expect(tools[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    }))
      .rejects.toMatchObject({ code: 'invalid_tool' });
  });

  it('rejects malformed descriptor fields and active registries deterministically', async () => {
    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => [registered({ title: 7 as never })]),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'invalid_tool' });
    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => [registered({ annotations: 'read-only' as never })]),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'invalid_tool' });
    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => [registered({ inputSchema: 7 as never })]),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'invalid_tool' });

    const activeRegistryContext = context({
      getTools: vi.fn()
        .mockResolvedValueOnce([registered()])
        .mockResolvedValueOnce({ invalid: true }),
    });
    const tools = await createWebMcpToolProvider(activeRegistryContext)
      .getTools({ signal: undefined });
    await expect(tools[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    })).rejects.toMatchObject({ code: 'invalid_tool' });
  });

  it('ignores malformed unrelated entries when revalidating the requested tool', async () => {
    const active = registered();
    const modelContext = context({
      getTools: vi.fn()
        .mockResolvedValueOnce([active])
        .mockResolvedValueOnce([
          registered({
            name: 'unrelated',
            inputSchema: JSON.stringify({ description: 'x'.repeat(16_001) }),
          }),
          active,
        ]),
    });
    const tools = await createWebMcpToolProvider(modelContext)
      .getTools({ signal: undefined });

    await expect(tools[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    })).resolves.toEqual({ ready: true });
    expect(modelContext.executeTool).toHaveBeenCalledWith(active, {}, {});
  });

  it('bounds schemas and serialized results before parsing them', async () => {
    await expect(createWebMcpToolProvider(context({
      getTools: vi.fn(async () => [registered({
        inputSchema: { description: 'x'.repeat(16_001) },
      })]),
    })).getTools({ signal: undefined })).rejects.toMatchObject({ code: 'resource_limit' });

    const oversizedResultContext = context({
      executeTool: vi.fn(async () => 'x'.repeat(100_001)),
    });
    const tools = await createWebMcpToolProvider(oversizedResultContext)
      .getTools({ signal: undefined });
    await expect(tools[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    })).rejects.toMatchObject({ code: 'resource_limit' });
  });

  it('returns promptly when cancellation interrupts WebMCP discovery', async () => {
    const controller = new AbortController();
    const provider = createWebMcpToolProvider(context({
      getTools: vi.fn(() => new Promise<readonly RegisteredWebMcpTool[]>(() => undefined)),
    }));
    const pending = provider.getTools({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('installDocumentRuntimeTools', () => {
  it('returns null when the document WebMCP entry point is unavailable', async () => {
    await expect(installDocumentRuntimeTools([runtimeTool()])).resolves.toBeNull();
  });

  it('accepts browser platform objects with methods on a custom prototype', async () => {
    const platformPrototype = context();
    const platformContext = Object.create(platformPrototype) as WebMcpModelContext;
    vi.stubGlobal('document', { modelContext: platformContext });

    const registration = await installDocumentRuntimeTools([runtimeTool()]);
    expect(registration).not.toBeNull();
    expect(platformPrototype.registerTool).toHaveBeenCalledTimes(1);
    registration?.dispose();
  });
});
