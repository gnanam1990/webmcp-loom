import { describe, expect, it } from 'vitest';

import { createScriptedModel, type ScriptedStep } from '../apps/travel-showcase/src/app/scripted-model.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { runBenchmarkTask } from './runner.js';
import type { BenchmarkTask } from './schema.js';

const MODEL = { backend: 'scripted', identifier: 'runner-test-script' } as const;

function task(id: string): BenchmarkTask {
  const found = SMOKE_TASKS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`Missing fixture task ${id}.`);
  return found;
}

function clock(): () => Date {
  const times = [new Date('2026-08-31T00:00:00.000Z'), new Date('2026-08-31T00:00:00.125Z')];
  return () => times.shift() ?? new Date('2026-08-31T00:00:00.125Z');
}

function resultFor(id: string, script: readonly ScriptedStep[]) {
  return runBenchmarkTask({
    model: createScriptedModel(script),
    modelDescriptor: MODEL,
    now: clock(),
    task: task(id),
  });
}

describe('deterministic benchmark runner', () => {
  it('records a completed read-only task and its runtime evidence', async () => {
    const result = await resultFor('smoke-read-constraints', [
      { tool: 'get_trip_constraints', input: {} },
      { tool: null, message: 'Booking is not available.' },
    ]);

    expect(result).toMatchObject({
      outcome: 'completed',
      taskId: 'smoke-read-constraints',
      version: 1,
      metrics: { decisionCount: 2, endToEndLatencyMs: 125, schemaValidRate: 1, identifierReuseRate: 1 },
    });
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'get_trip_constraints', step: 1 })]);
    expect(result.assertions.every((entry) => entry.passed)).toBe(true);
  });

  it('counts the pending approved write and verifies search identifier reuse', async () => {
    const result = await resultFor('smoke-select-kyoto-stay', [
      { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
      {
        tool: 'add_itinerary_item',
        input: { expectedRevision: '$revision', kind: 'stay', refId: 'st-kyo-mid', date: '2026-11-10', nights: 3 },
      },
    ]);

    expect(result.outcome).toBe('approval_required');
    expect(result.toolCalls.map(({ toolName }) => toolName)).toEqual(['search_stays', 'add_itinerary_item']);
    expect(result.assertions.find(({ name }) => name.startsWith('identifier-reuse:'))).toMatchObject({ passed: true });
    expect(result.assertions.every((entry) => entry.passed)).toBe(true);
  });

  it("applies a denial task's default approval decision without mutating the fixture", async () => {
    const result = await resultFor('smoke-approval-denial', [
      { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
      {
        tool: 'add_itinerary_item',
        input: { expectedRevision: '$revision', kind: 'stay', refId: 'st-kyo-mid', date: '2026-11-10', nights: 3 },
      },
    ]);

    expect(result.outcome).toBe('denied');
    expect(result.assertions.find(({ name }) => name === 'state-effect')).toMatchObject({ passed: true, actual: 'unchanged' });
    expect(result.assertions.every((entry) => entry.passed)).toBe(true);
  });

  it('records invalid model JSON as a model-decision failure instead of throwing', async () => {
    const result = await runBenchmarkTask({
      model: { generate: async () => '{' },
      modelDescriptor: MODEL,
      now: clock(),
      task: task('smoke-read-constraints'),
    });

    expect(result).toMatchObject({
      outcome: 'runtime_error',
      failure: { code: 'malformed_json', category: 'model_decision', retryable: false },
      metrics: { decisionCount: 1, schemaValidRate: 0 },
    });
    expect(result.assertions.find(({ name }) => name === 'outcome')).toMatchObject({ passed: false });
  });

  it('keeps unsupported decisions distinct from generic invalid decisions', async () => {
    const result = await runBenchmarkTask({
      model: { generate: async () => JSON.stringify({ type: 'invented' }) },
      modelDescriptor: MODEL,
      now: clock(),
      task: task('smoke-read-constraints'),
    });

    expect(result.failure).toMatchObject({
      code: 'unknown_decision_type', category: 'model_decision', retryable: false,
    });
  });

  it('attributes an oversized model response to the model decision rather than a tool', async () => {
    const result = await runBenchmarkTask({
      model: { generate: async () => 'x'.repeat(100_000) },
      modelDescriptor: MODEL,
      now: clock(),
      task: task('smoke-read-constraints'),
    });

    expect(result.failure).toMatchObject({
      code: 'invalid_decision', category: 'model_decision', retryable: false,
    });
  });

  it('attributes model transport errors to the adapter rather than a tool', async () => {
    const result = await runBenchmarkTask({
      model: { generate: async () => { throw new Error('local endpoint reset'); } },
      modelDescriptor: MODEL,
      now: clock(),
      task: task('smoke-read-constraints'),
    });

    expect(result.failure).toMatchObject({
      code: 'transport_failed', category: 'adapter', retryable: true,
    });
    expect(result.metrics).toMatchObject({ decisionCount: 0, schemaValidRate: 1 });
  });

  it('interrupts stale fixtures after the first validated model decision', async () => {
    const result = await resultFor('smoke-stale-human-edit', [
      { tool: 'get_itinerary', input: {} },
    ]);

    expect(result.outcome).toBe('stale_state');
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'get_itinerary', step: 1 })]);
    expect(result.assertions.every((entry) => entry.passed)).toBe(true);
  });

  it('stops a write-first stale fixture before approval can execute the write', async () => {
    const base = task('smoke-stale-human-edit');
    const writeFirstTask: BenchmarkTask = {
      ...base,
      expected: {
        ...base.expected,
        toolCalls: {
          min: 1,
          max: 1,
          requiredToolNames: ['add_itinerary_item'],
          forbiddenToolNames: [],
        },
      },
    };
    const result = await runBenchmarkTask({
      model: createScriptedModel([{
        tool: 'add_itinerary_item',
        input: {
          expectedRevision: '$revision',
          kind: 'activity',
          refId: 'ac-kyo-fushimi',
          date: '2026-11-11',
        },
      }]),
      modelDescriptor: MODEL,
      now: clock(),
      task: writeFirstTask,
    });

    expect(result.outcome).toBe('stale_state');
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'add_itinerary_item', step: 1 })]);
    expect(result.assertions.every((entry) => entry.passed)).toBe(true);
  });

  it('records valid tool execution failures without blaming the model', async () => {
    const base = task('smoke-select-kyoto-stay');
    const writeFailureTask: BenchmarkTask = {
      ...base,
      expected: {
        ...base.expected,
        allowedStatuses: ['write_failed'],
        approval: 'none',
        identifierReuses: [],
        toolCalls: {
          min: 1,
          max: 1,
          requiredToolNames: ['add_itinerary_item'],
          forbiddenToolNames: [],
        },
      },
    };
    const result = await runBenchmarkTask({
      approve: () => true,
      model: createScriptedModel([{
        tool: 'add_itinerary_item',
        input: {
          expectedRevision: '$revision',
          kind: 'stay',
          refId: 'not-in-the-fixture',
          date: '2026-11-10',
          nights: 3,
        },
      }]),
      modelDescriptor: MODEL,
      now: clock(),
      task: writeFailureTask,
    });

    expect(result).toMatchObject({
      outcome: 'write_failed',
      failure: { code: 'execution_failed', category: 'tool', retryable: false },
    });
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'add_itinerary_item', step: 1 })]);
  });

  it('retains validated calls when an approval boundary itself throws', async () => {
    const result = await runBenchmarkTask({
      approve: () => { throw new Error('approval service unavailable'); },
      model: createScriptedModel([{
        tool: 'add_itinerary_item',
        input: {
          expectedRevision: '$revision',
          kind: 'stay',
          refId: 'st-kyo-mid',
          date: '2026-11-10',
          nights: 3,
        },
      }]),
      modelDescriptor: MODEL,
      now: clock(),
      task: task('smoke-select-kyoto-stay'),
    });

    expect(result).toMatchObject({
      outcome: 'runtime_error',
      failure: { code: 'approval_failed', category: 'approval', retryable: true },
    });
    expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'add_itinerary_item', step: 1 })]);
  });
});
