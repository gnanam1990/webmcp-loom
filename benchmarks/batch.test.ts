import { describe, expect, it } from 'vitest';

import { createScriptedModel } from '../apps/travel-showcase/src/app/scripted-model.js';
import { runBenchmarkBatch, summarizeBenchmarkResults } from './batch.js';
import { SMOKE_TASKS } from './smoke-tasks.js';

const MODEL = { backend: 'scripted', identifier: 'batch-test-script' } as const;

describe('benchmark batch runner', () => {
  it('retains every attempt and uses decision-weighted schema validity', async () => {
    const tasks = SMOKE_TASKS.filter(({ id }) => id === 'smoke-read-constraints');
    const report = await runBenchmarkBatch({
      attemptsPerTask: 2,
      createModel: () => createScriptedModel([
        { tool: 'get_trip_constraints', input: {} },
        { tool: null, message: 'Booking is unavailable.' },
      ]),
      model: MODEL,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      tasks,
    });

    expect(report).toMatchObject({
      version: 1,
      summary: {
        attemptCount: 2,
        completeTaskPassRate: 1,
        decisionCount: 4,
        identifierReuseRate: 1,
        schemaValidRate: 1,
        successfulAttemptCount: 2,
      },
    });
    expect(report.results).toHaveLength(2);
  });

  it('rejects an empty corpus and invalid attempt count', async () => {
    const options = {
      attemptsPerTask: 1,
      createModel: () => createScriptedModel([]),
      model: MODEL,
      tasks: [],
    } as const;
    await expect(runBenchmarkBatch({ ...options, attemptsPerTask: 0 })).rejects.toThrow('positive integer');
    await expect(runBenchmarkBatch(options)).rejects.toThrow('At least one');
  });

  it('does not convert an empty report into a perfect task pass rate', () => {
    expect(summarizeBenchmarkResults([])).toMatchObject({
      attemptCount: 0,
      completeTaskPassRate: 0,
      decisionCount: 0,
      identifierReuseRate: 1,
      schemaValidRate: 1,
    });
  });

  it('reports identifier-reuse evidence from applicable attempts', async () => {
    const tasks = SMOKE_TASKS.filter(({ id }) => id === 'smoke-select-kyoto-stay');
    const report = await runBenchmarkBatch({
      approve: () => true,
      attemptsPerTask: 1,
      createModel: () => createScriptedModel([
        { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
        {
          tool: 'add_itinerary_item',
          input: {
            expectedRevision: '$revision', kind: 'stay', refId: 'st-kyo-mid', date: '2026-11-10', nights: 3,
          },
        },
        { tool: null, message: 'Staged the stay.' },
      ]),
      model: MODEL,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      tasks,
    });

    expect(report.summary.identifierReuseRate).toBe(1);
  });
});
