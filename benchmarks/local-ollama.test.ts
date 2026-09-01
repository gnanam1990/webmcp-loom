import { describe, expect, it } from 'vitest';

import { createScriptedModel } from '../apps/travel-showcase/src/app/scripted-model.js';
import {
  evaluateLocalSelectionReadiness,
  runLocalOllamaBenchmark,
} from './local-ollama.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import type { BenchmarkBatchReport } from './batch.js';
import type { BenchmarkResult } from './schema.js';

const PROVENANCE = {
  contextLength: 4_096,
  digest: 'sha256:test-artifact',
  family: 'test',
  model: 'test-local-model',
  parameterSize: '1B',
  quantization: 'Q4_K_M',
  serverVersion: 'test-engine-1',
} as const;

const HARDWARE = {
  architecture: 'arm64',
  latencyBudgetMs: 50,
  memoryBudgetBytes: 1_000_000,
  name: 'test hardware',
  operatingSystem: 'testOS 1',
} as const;

const MEMORY = {
  method: 'test sampler',
  peakMemoryBytes: 100_000,
  samplingIntervalMs: 100,
} as const;

describe('local Ollama benchmark assembly', () => {
  it('records local artifact provenance and labels a small run exploratory', async () => {
    const tasks = SMOKE_TASKS.filter(({ id }) => id === 'smoke-read-constraints');
    const report = await runLocalOllamaBenchmark({
      attemptsPerTask: 1,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'test-local-model',
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      tasks,
    }, {
      createModel: () => createScriptedModel([
        { tool: 'get_trip_constraints', input: {} },
        { tool: null, message: 'Booking is unavailable.' },
      ]),
      inspectModel: async () => PROVENANCE,
    });

    expect(report).toMatchObject({
      batch: { model: { backend: 'local', identifier: 'test-local-model', quantization: 'Q4_K_M' } },
      generatedAt: '2026-09-01T00:00:00.000Z',
      provenance: PROVENANCE,
      selection: { eligible: false },
      version: 1,
    });
    expect(report.selection.blockers).toEqual(expect.arrayContaining([
      'at least 30 deterministic tasks are required',
      'at least three attempts per task are required',
      'target hardware and latency/memory budgets were not declared',
    ]));
  });

  it('accepts only a fully measured 30-task report that passes every gate', () => {
    const result = successfulResult(40);
    const report: BenchmarkBatchReport = {
      model: { backend: 'local', identifier: 'test' },
      results: Array.from({ length: 90 }, () => result),
      summary: {
        attemptCount: 90,
        completeTaskPassRate: 1,
        decisionCount: 90,
        identifierReuseRate: 1,
        meanEndToEndLatencyMs: 40,
        schemaValidRate: 1,
        successfulAttemptCount: 90,
      },
      version: 1,
    };
    const selection = evaluateLocalSelectionReadiness(report, {
      attemptsPerTask: 3,
      hardware: HARDWARE,
      memory: MEMORY,
      tasks: Array.from({ length: 30 }, () => SMOKE_TASKS[0]!),
    });
    expect(selection).toEqual({
      blockers: [],
      completeTaskPassRate: 1,
      eligible: true,
      identifierReuseRate: 1,
      p95EndToEndLatencyMs: 40,
      schemaValidRate: 1,
    });
  });

  it('blocks selection when p95 latency or sampled memory exceeds declared limits', () => {
    const report: BenchmarkBatchReport = {
      model: { backend: 'local', identifier: 'test' },
      results: [successfulResult(10), successfulResult(100)],
      summary: {
        attemptCount: 2,
        completeTaskPassRate: 1,
        decisionCount: 2,
        identifierReuseRate: 1,
        meanEndToEndLatencyMs: 55,
        schemaValidRate: 1,
        successfulAttemptCount: 2,
      },
      version: 1,
    };
    const selection = evaluateLocalSelectionReadiness(report, {
      attemptsPerTask: 3,
      hardware: HARDWARE,
      memory: { ...MEMORY, peakMemoryBytes: HARDWARE.memoryBudgetBytes + 1 },
      tasks: Array.from({ length: 30 }, () => SMOKE_TASKS[0]!),
    });
    expect(selection.blockers).toEqual(expect.arrayContaining([
      'report does not retain every declared task attempt',
      'p95 end-to-end latency exceeds the declared hardware budget',
      'peak memory exceeds the declared hardware budget',
    ]));
  });
});

function successfulResult(endToEndLatencyMs: number): BenchmarkResult {
  return {
    assertions: [{ actual: 'pass', expected: 'pass', name: 'outcome', passed: true }],
    completedAt: '2026-09-01T00:00:00.000Z',
    fixture: 'empty_trip',
    metrics: {
      decisionCount: 1,
      endToEndLatencyMs,
      identifierReuseRate: 1,
      schemaValidRate: 1,
    },
    model: { backend: 'local', identifier: 'test' },
    outcome: 'completed',
    startedAt: '2026-09-01T00:00:00.000Z',
    taskId: 'smoke-read-constraints',
    toolCalls: [],
    version: 1,
  };
}
