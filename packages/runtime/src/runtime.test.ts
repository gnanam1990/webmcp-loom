import { describe, expect, it, vi } from 'vitest';
import { RUNTIME_LIMITS } from './bounds.js';
import { AgentRuntimeError } from './errors.js';
import { parseAgentDecision } from './prompt.js';
import { createStaticToolProvider } from './registry.js';
import { runAgentRuntime } from './runtime.js';
import type {
  JsonObject,
  RuntimeModel,
  RuntimeTool,
  RuntimeToolProvider,
} from './types.js';

const objectSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
};

function tool(overrides: Partial<RuntimeTool> = {}): RuntimeTool {
  return {
    name: 'inspect',
    title: 'Inspect',
    description: 'Inspect one fixture.',
    inputSchema: objectSchema,
    annotations: { readOnlyHint: true },
    execute: ({ id }) => ({ id, found: true }),
    ...overrides,
  };
}

function model(...decisions: JsonObject[]): RuntimeModel {
  const queue = decisions.map((decision) => JSON.stringify(decision));
  return {
    generate: vi.fn(async () => queue.shift() ?? JSON.stringify({ type: 'final', message: 'done' })),
  };
}

function call(name = 'inspect', input: JsonObject = { id: 'item-1' }): JsonObject {
  return { type: 'tool_call', tool: name, input };
}

describe('runAgentRuntime', () => {
  it('runs multiple steps and makes prior results available to the model', async () => {
    const runtimeModel = model(call(), { type: 'final', message: 'complete' });
    const result = await runAgentRuntime({
      goal: 'Inspect the item.',
      model: runtimeModel,
      toolProvider: createStaticToolProvider([tool()]),
    });

    expect(result.status).toBe('completed');
    expect(result.history).toEqual([{
      step: 1,
      tool: 'inspect',
      input: { id: 'item-1' },
      ok: true,
      output: { id: 'item-1', found: true },
    }]);
    const generate = vi.mocked(runtimeModel.generate);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].prompt).toContain('item-1');
  });

  it('refreshes tools for the prompt and again immediately before execution', async () => {
    const getTools = vi.fn(() => [tool()]);
    const result = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call(), { type: 'final', message: 'done' }),
      toolProvider: { getTools },
    });

    expect(result.status).toBe('completed');
    expect(getTools).toHaveBeenCalledTimes(3);
    expect(result.events.filter(({ type }) => type === 'tools_refreshed')).toHaveLength(3);
  });

  it('fails closed when a tool disappears before execution', async () => {
    const provider: RuntimeToolProvider = {
      getTools: vi.fn()
        .mockReturnValueOnce([tool()])
        .mockReturnValueOnce([]),
    };
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: provider,
    })).rejects.toMatchObject({ code: 'tool_unavailable' });
  });

  it('fails closed when a tool definition changes before execution', async () => {
    const provider: RuntimeToolProvider = {
      getTools: vi.fn()
        .mockReturnValueOnce([tool()])
        .mockReturnValueOnce([tool({ description: 'Changed after prompting.' })]),
    };
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: provider,
    })).rejects.toMatchObject({ code: 'tool_changed' });
  });

  it('validates input before the executor can run', async () => {
    const execute = vi.fn();
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model(call('inspect', {})),
      toolProvider: createStaticToolProvider([tool({ execute })]),
    })).rejects.toMatchObject({ code: 'invalid_tool_input' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns a pending approval without executing write-capable tools', async () => {
    const execute = vi.fn();
    const result = await runAgentRuntime({
      goal: 'Stage the item.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute,
      })]),
    });

    expect(result.status).toBe('approval_required');
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes an approved write once and does not retry ambiguous failures', async () => {
    const execute = vi.fn(() => {
      throw new Error('connection ended after submit');
    });
    const result = await runAgentRuntime({
      goal: 'Stage the item.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute,
      })]),
      approve: async () => true,
    });

    expect(result.status).toBe('write_failed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.history).toHaveLength(1);
  });

  it('does not execute a denied write', async () => {
    const execute = vi.fn();
    const result = await runAgentRuntime({
      goal: 'Stage the item.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute,
      })]),
      approve: async () => false,
    });
    expect(result.status).toBe('denied');
    expect(execute).not.toHaveBeenCalled();
  });

  it('isolates observer and approval mutations from execution state', async () => {
    let receivedInput: JsonObject | undefined;
    const result = await runAgentRuntime({
      goal: 'Stage the item.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute: (input) => {
          receivedInput = input;
          return { staged: true };
        },
      })]),
      onEvent: (event) => {
        if (event.type === 'tool_call_validated') event.input.id = 'observer-mutated';
      },
      approve: (request) => {
        request.input.id = 'approval-mutated';
        request.tool.inputSchema.type = 'string';
        return true;
      },
    });

    expect(receivedInput).toEqual({ id: 'item-1' });
    expect(result.history[0]?.input).toEqual({ id: 'item-1' });
  });

  it('isolates rejected asynchronous observers from runtime success', async () => {
    const result = await runAgentRuntime({
      goal: 'Finish.',
      model: model({ type: 'final', message: 'done' }),
      toolProvider: createStaticToolProvider([tool()]),
      onEvent: async () => Promise.reject(new Error('observer failed')),
    });
    expect(result.status).toBe('completed');
    await Promise.resolve();
  });

  it('feeds read-only failures back to the model and can recover', async () => {
    const result = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call(), { type: 'final', message: 'could not inspect' }),
      toolProvider: createStaticToolProvider([tool({
        execute: () => {
          throw new Error('fixture unavailable');
        },
      })]),
    });
    expect(result.status).toBe('completed');
    expect(result.history[0]).toMatchObject({ ok: false, error: 'fixture unavailable' });
  });

  it('stops at the configured step limit', async () => {
    const result = await runAgentRuntime({
      goal: 'Inspect forever.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool()]),
      maxSteps: 1,
    });
    expect(result.status).toBe('step_limit');
    expect(result.history).toHaveLength(1);
  });

  it('does not execute a tool after reaching an explicit tool-call cap', async () => {
    const execute = vi.fn(() => ({ found: true }));
    const result = await runAgentRuntime({
      goal: 'Inspect twice.',
      maxSteps: 3,
      maxToolCalls: 1,
      model: model(call(), call()),
      toolProvider: createStaticToolProvider([tool({ execute })]),
    });

    expect(result.status).toBe('step_limit');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.history).toHaveLength(1);
    expect(result.events).toContainEqual({ type: 'step_limit_reached', step: 2 });
  });

  it('rejects oversized goals, decisions, inputs and invalid maxSteps', async () => {
    const provider = createStaticToolProvider([tool()]);
    await expect(runAgentRuntime({
      goal: 'x'.repeat(RUNTIME_LIMITS.goalCharacters + 1),
      model: model({ type: 'final', message: 'done' }),
      toolProvider: provider,
    })).rejects.toMatchObject({ code: 'resource_limit' });
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: { generate: async () => 'x'.repeat(RUNTIME_LIMITS.modelDecisionCharacters + 1) },
      toolProvider: provider,
    })).rejects.toMatchObject({ code: 'resource_limit' });
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model(call('inspect', { id: 'x'.repeat(RUNTIME_LIMITS.toolInputCharacters) })),
      toolProvider: provider,
    })).rejects.toMatchObject({ code: 'resource_limit' });
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model({ type: 'final', message: 'done' }),
      toolProvider: provider,
      maxSteps: 0,
    })).rejects.toMatchObject({ code: 'invalid_configuration' });
  });

  it('bounds stored outputs and errors and normalizes non-JSON output', async () => {
    const exactOutput = {
      text: 'quote " slash \\ controls \b\f\n\r\t emoji 😀 lone \ud800',
      values: [null, true, -0, 1.5],
    };
    const exactResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({ execute: () => exactOutput })]),
      maxSteps: 1,
    });
    expect(exactResult.history[0]?.output).toEqual({
      ...exactOutput,
      values: [null, true, 0, 1.5],
    });

    const large = 'x'.repeat(RUNTIME_LIMITS.storedToolResultCharacters + 500);
    const bigResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({ execute: () => ({ large }) })]),
      maxSteps: 1,
    });
    expect(JSON.stringify(bigResult.history[0]?.output).length)
      .toBeLessThanOrEqual(RUNTIME_LIMITS.storedToolResultCharacters);

    let lateGetterRead = false;
    const boundedBeforeLateGetter: Record<string, unknown> = {
      large: 'x'.repeat(RUNTIME_LIMITS.storedToolResultCharacters + 500),
    };
    Object.defineProperty(boundedBeforeLateGetter, 'late', {
      enumerable: true,
      get: () => {
        lateGetterRead = true;
        return 'should not be read';
      },
    });
    const boundedResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({
        execute: () => boundedBeforeLateGetter,
      })]),
      maxSteps: 1,
    });
    expect(boundedResult.history[0]?.output).toMatchObject({ truncated: true });
    expect(lateGetterRead).toBe(false);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const circularResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({ execute: () => circular })]),
      maxSteps: 1,
    });
    expect(circularResult.history[0]?.output).toMatchObject({ unavailable: true });

    const arrayWithExtraProperty = [1] as unknown[] & { extra?: string };
    arrayWithExtraProperty.extra = 'not JSON array data';
    const extraPropertyResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({
        execute: () => arrayWithExtraProperty,
      })]),
      maxSteps: 1,
    });
    expect(extraPropertyResult.history[0]?.output).toMatchObject({ unavailable: true });

    const nonEnumerableElement: unknown[] = [];
    Object.defineProperty(nonEnumerableElement, '0', {
      configurable: true,
      enumerable: false,
      value: 'included by JSON arrays',
      writable: true,
    });
    const nonEnumerableResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({
        execute: () => nonEnumerableElement,
      })]),
      maxSteps: 1,
    });
    expect(nonEnumerableResult.history[0]?.output).toEqual(['included by JSON arrays']);

    Object.defineProperty(Object.prototype, 'runtimeEnumerablePollution', {
      configurable: true,
      enumerable: true,
      value: 'polluted',
      writable: true,
    });
    try {
      const pollutedResult = await runAgentRuntime({
        goal: 'Inspect.',
        model: model(call()),
        toolProvider: createStaticToolProvider([tool({ execute: () => ({}) })]),
        maxSteps: 1,
      });
      expect(pollutedResult.history[0]?.output).toMatchObject({ unavailable: true });
    } finally {
      Reflect.deleteProperty(Object.prototype, 'runtimeEnumerablePollution');
    }

    const errorResult = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({
        execute: () => { throw new Error('e'.repeat(RUNTIME_LIMITS.storedErrorCharacters + 50)); },
      })]),
      maxSteps: 1,
    });
    expect(errorResult.history[0]?.error).toHaveLength(RUNTIME_LIMITS.storedErrorCharacters);
  });

  it('returns cancelled before model work and during read-only execution', async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const runtimeModel = model({ type: 'final', message: 'done' });
    const early = await runAgentRuntime({
      goal: 'Inspect.',
      model: runtimeModel,
      toolProvider: createStaticToolProvider([tool()]),
      signal: alreadyAborted.signal,
    });
    expect(early.status).toBe('cancelled');
    expect(runtimeModel.generate).not.toHaveBeenCalled();

    const during = new AbortController();
    let executionStarted = false;
    const running = runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({
        execute: async () => new Promise(() => undefined),
      })]),
      onEvent: (event) => {
        if (event.type === 'tool_started') executionStarted = true;
      },
      signal: during.signal,
    });
    await vi.waitFor(() => {
      expect(executionStarted).toBe(true);
    });
    during.abort();
    await expect(running).resolves.toMatchObject({ status: 'cancelled', history: [] });
  });

  it('records a completed write before honoring a late abort', async () => {
    const controller = new AbortController();
    const result = await runAgentRuntime({
      goal: 'Stage.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute: () => {
          controller.abort();
          return { staged: true };
        },
      })]),
      approve: () => true,
      signal: controller.signal,
    });
    expect(result).toMatchObject({ status: 'cancelled' });
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toMatchObject({ ok: true, output: { staged: true } });
  });

  it('rejects stale state after model generation and before execution', async () => {
    const revisions = [1, 2];
    const execute = vi.fn();
    const result = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool({ execute })]),
      getStateRevision: () => revisions.shift() ?? 2,
    });
    expect(result).toMatchObject({
      status: 'stale_state',
      expectedRevision: 1,
      currentRevision: 2,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the captured state revision to the state-owning executor', async () => {
    let expectedStateRevision: number | string | undefined;
    const result = await runAgentRuntime({
      goal: 'Stage.',
      model: model(call('stage')),
      toolProvider: createStaticToolProvider([tool({
        name: 'stage',
        title: 'Stage',
        annotations: { readOnlyHint: false },
        execute: (_input, context) => {
          expectedStateRevision = context.expectedStateRevision;
          return { staged: true };
        },
      })]),
      approve: () => true,
      getStateRevision: () => 7,
      maxSteps: 1,
    });
    expect(result.status).toBe('step_limit');
    expect(expectedStateRevision).toBe(7);
  });

  it('includes the captured state revision in the model prompt', async () => {
    const generate = vi.fn(async ({ prompt }: { prompt: string }) => {
      expect(prompt).toContain('Current state revision: "revision-7"');
      return JSON.stringify({ type: 'final', message: 'done' });
    });
    const result = await runAgentRuntime({
      goal: 'Finish.',
      model: { generate },
      toolProvider: createStaticToolProvider([tool()]),
      getStateRevision: () => 'revision-7',
    });
    expect(result.status).toBe('completed');
  });

  it('discards a read result when state changes during execution', async () => {
    const revisions = [1, 1, 1, 2];
    const result = await runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool()]),
      getStateRevision: () => revisions.shift() ?? 2,
    });
    expect(result.status).toBe('stale_state');
    expect(result.history).toEqual([]);
  });

  it('rejects invalid state revisions', async () => {
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model({ type: 'final', message: 'done' }),
      toolProvider: createStaticToolProvider([tool()]),
      getStateRevision: () => Number.NaN,
    })).rejects.toMatchObject({ code: 'invalid_configuration' });
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model({ type: 'final', message: 'done' }),
      toolProvider: createStaticToolProvider([tool()]),
      getStateRevision: () => 'r'.repeat(RUNTIME_LIMITS.stateRevisionCharacters + 1),
    })).rejects.toMatchObject({ code: 'resource_limit' });

    const revisions = [1, 1, 1, Number.NaN];
    await expect(runAgentRuntime({
      goal: 'Inspect.',
      model: model(call()),
      toolProvider: createStaticToolProvider([tool()]),
      getStateRevision: () => revisions.shift() ?? 1,
      maxSteps: 1,
    })).rejects.toMatchObject({ code: 'invalid_configuration' });
  });
});

describe('parseAgentDecision', () => {
  it('requires exact fields and trims final messages and tool names', () => {
    expect(parseAgentDecision('{"type":"final","message":" done "}'))
      .toEqual({ type: 'final', message: 'done' });
    expect(parseAgentDecision('{"type":"tool_call","tool":" inspect ","input":{}}'))
      .toEqual({ type: 'tool_call', tool: 'inspect', input: {} });
    expect(() => parseAgentDecision('{"type":"final","message":"done","extra":true}'))
      .toThrowError(AgentRuntimeError);
  });

  it('rejects deeply nested decisions without overflowing the stack', () => {
    let nested = '{}';
    for (let depth = 0; depth < 5_000; depth += 1) nested = `{"x":${nested}}`;
    const raw = `{"type":"tool_call","tool":"inspect","input":${nested}}`;
    expect(() => parseAgentDecision(raw)).toThrowError(AgentRuntimeError);
    try {
      parseAgentDecision(raw);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_decision' });
    }
  });
});
