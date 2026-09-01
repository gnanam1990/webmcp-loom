import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_FAILURE_DEFAULTS,
  BENCHMARK_MAX_TOOL_CALLS,
  assertValidBenchmarkTask,
} from './schema.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { TRAVEL_TASKS } from './travel-tasks.js';

describe('benchmark foundation', () => {
  it('ships exactly ten internally valid Day 1 smoke tasks', () => {
    expect(SMOKE_TASKS).toHaveLength(10);
    expect(new Set(SMOKE_TASKS.map(({ id }) => id)).size).toBe(SMOKE_TASKS.length);
    for (const task of SMOKE_TASKS) assertValidBenchmarkTask(task);
  });

  it('validates every task in the combined benchmark corpus with unique ids', () => {
    const corpus = [...SMOKE_TASKS, ...TRAVEL_TASKS];
    expect(TRAVEL_TASKS).toHaveLength(9);
    expect(corpus).toHaveLength(19);
    expect(new Set(corpus.map(({ id }) => id)).size).toBe(corpus.length);
    for (const task of corpus) assertValidBenchmarkTask(task);
  });

  it('covers the mandatory deterministic Day 1 behaviours', () => {
    const categories = new Set(SMOKE_TASKS.flatMap(({ categories: taskCategories }) => taskCategories));
    expect(categories).toEqual(new Set([
      'approval',
      'identifier_reuse',
      'recovery',
      'retrieval',
      'selection',
      'state_change',
    ]));
  });

  it('accepts cancellation as a first-class terminal runtime outcome', () => {
    const cancelled = SMOKE_TASKS[0];
    if (cancelled === undefined) throw new Error('Expected a smoke-task fixture.');
    expect(() => assertValidBenchmarkTask({
      ...cancelled,
      expected: { ...cancelled.expected, allowedStatuses: ['cancelled'] },
    })).not.toThrow();
  });

  it('keeps normalized failure codes tied to their taxonomy defaults', () => {
    expect(BENCHMARK_FAILURE_DEFAULTS.generation_cancelled)
      .toEqual({ category: 'adapter', retryable: false });
    expect(BENCHMARK_FAILURE_DEFAULTS.load_failed)
      .toEqual({ category: 'adapter', retryable: true });
    expect(BENCHMARK_FAILURE_DEFAULTS.approval_failed)
      .toEqual({ category: 'approval', retryable: true });
    expect(Object.keys(BENCHMARK_FAILURE_DEFAULTS)).toHaveLength(30);
  });

  it('rejects whitespace-only tool names and identifier-reuse fields', () => {
    const task = SMOKE_TASKS[0];
    if (task === undefined) throw new Error('Expected a smoke-task fixture.');

    expect(() => assertValidBenchmarkTask({
      ...task,
      expected: {
        ...task.expected,
        toolCalls: { ...task.expected.toolCalls, requiredToolNames: [' '] },
      },
    })).toThrow('empty required tool');
    expect(() => assertValidBenchmarkTask({
      ...task,
      expected: {
        ...task.expected,
        toolCalls: { ...task.expected.toolCalls, forbiddenToolNames: ['\t'] },
      },
    })).toThrow('empty forbidden tool');
    expect(() => assertValidBenchmarkTask({
      ...task,
      expected: {
        ...task.expected,
        identifierReuses: [{
          sourceTool: 'get_itinerary',
          sourceOutputPath: ' ',
          consumerTool: 'move_itinerary_item',
          consumerInputPath: '$.input.itemId',
        }],
      },
    })).toThrow('incomplete identifier-reuse assertion');
  });

  it('reserves one runtime decision for a final response', () => {
    const task = SMOKE_TASKS[0];
    if (task === undefined) throw new Error('Expected a smoke-task fixture.');

    expect(BENCHMARK_MAX_TOOL_CALLS).toBe(19);
    expect(() => assertValidBenchmarkTask({
      ...task,
      expected: {
        ...task.expected,
        toolCalls: { ...task.expected.toolCalls, max: BENCHMARK_MAX_TOOL_CALLS + 1 },
      },
    })).toThrow('invalid tool-call bounds');
  });
});
