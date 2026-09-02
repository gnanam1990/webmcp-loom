import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { summarizeBenchmarkResults } from './batch.js';
import { evaluateLocalSelectionReadiness } from './local-ollama.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { TRAVEL_TASKS } from './travel-tasks.js';
import type { LocalOllamaBenchmarkReport } from './local-ollama.js';

interface RecordedLocalReport extends LocalOllamaBenchmarkReport {
  environment: { architecture: string; operatingSystem: string };
}

const CORPUS = [...SMOKE_TASKS, ...TRAVEL_TASKS];
const RAW_RESULT = new URL(
  './results/qwen3-0.6b-ollama-30x3-2026-09-02.raw.json',
  import.meta.url,
);
const MEASURED_RESULT = new URL(
  './results/qwen3-0.6b-ollama-30x3-2026-09-02.json',
  import.meta.url,
);

function readReport(url: URL): RecordedLocalReport {
  return JSON.parse(readFileSync(url, 'utf8')) as RecordedLocalReport;
}

describe('recorded qwen3:0.6b local Ollama evidence', () => {
  it('retains every corpus task exactly three times and recomputes its aggregates', () => {
    const report = readReport(MEASURED_RESULT);
    const counts = new Map<string, number>();
    for (const result of report.batch.results) {
      counts.set(result.taskId, (counts.get(result.taskId) ?? 0) + 1);
    }

    expect(report.batch.results).toHaveLength(90);
    expect([...counts].sort()).toEqual(CORPUS.map(({ id }) => [id, 3] as const).sort());
    expect(report.batch.summary).toEqual(summarizeBenchmarkResults(report.batch.results));
    expect(report.batch.summary).toMatchObject({
      attemptCount: 90,
      completeTaskPassRate: 0,
      decisionCount: 90,
      identifierReuseRate: 0,
      successfulAttemptCount: 0,
    });
  });

  it('binds the measured report to exact model, hardware, memory and ineligible gates', () => {
    const report = readReport(MEASURED_RESULT);
    if (report.hardware === undefined || report.memory === undefined) {
      throw new Error('Measured evidence must retain hardware and memory metadata.');
    }

    expect(report.provenance).toMatchObject({
      digest: '7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435',
      model: 'qwen3:0.6b',
      quantization: 'Q4_K_M',
      serverVersion: '0.31.1',
    });
    expect(report.memory).toEqual({
      method: 'Combined RSS of Ollama serve and direct child runner processes sampled with ps during all attempts',
      peakMemoryBytes: 1_611_481_088,
      samplingIntervalMs: 100,
    });
    expect(report.selection).toEqual(evaluateLocalSelectionReadiness(report.batch, {
      attemptsPerTask: 3,
      hardware: report.hardware,
      memory: report.memory,
      tasks: CORPUS,
    }));
    expect(report.selection).toMatchObject({
      eligible: false,
      p95EndToEndLatencyMs: 1_451,
      schemaValidRate: 0.9666666666666667,
    });
  });

  it('proves memory attachment changed no retained run evidence', () => {
    const raw = readReport(RAW_RESULT);
    const measured = readReport(MEASURED_RESULT);
    if (measured.hardware === undefined || measured.memory === undefined) {
      throw new Error('Measured evidence must retain hardware and memory metadata.');
    }

    const measuredWithoutMemory: RecordedLocalReport = { ...measured };
    delete measuredWithoutMemory.memory;
    expect(raw).toEqual({
      ...measuredWithoutMemory,
      selection: evaluateLocalSelectionReadiness(measured.batch, {
        attemptsPerTask: 3,
        hardware: measured.hardware,
        tasks: CORPUS,
      }),
    });
    expect(raw.memory).toBeUndefined();
    expect(measured.memory.peakMemoryBytes).toBe(1_611_481_088);
  });
});
