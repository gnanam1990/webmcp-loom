import { describe, expect, it } from 'vitest';

import { assertValidBenchmarkTask } from './schema.js';
import { SMOKE_TASKS } from './smoke-tasks.js';

describe('benchmark foundation', () => {
  it('ships exactly ten internally valid Day 1 smoke tasks', () => {
    expect(SMOKE_TASKS).toHaveLength(10);
    expect(new Set(SMOKE_TASKS.map(({ id }) => id)).size).toBe(SMOKE_TASKS.length);
    for (const task of SMOKE_TASKS) assertValidBenchmarkTask(task);
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
});
