import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { summarizeBenchmarkResults } from './batch.js';
import { evaluateLocalSelectionReadiness } from './local-ollama.js';
import { SMOKE_TASKS } from './smoke-tasks.js';
import { TRAVEL_TASKS } from './travel-tasks.js';
import type { LocalOllamaBenchmarkReport } from './local-ollama.js';

interface RecordedRetrievalReport extends LocalOllamaBenchmarkReport {
  environment: { architecture: string; operatingSystem: string };
}

const CORPUS = [...SMOKE_TASKS, ...TRAVEL_TASKS];
const RESULT = new URL(
  './results/qwen3-0.6b-retrieval-30x3-2026-09-02.json',
  import.meta.url,
);
const RESULT_SHA256 = '899a6d5f3d097c46c63d574135a9c8d732827437e4341e572730c14a8cdd76da';

function readEvidence(): { raw: string; report: RecordedRetrievalReport } {
  const raw = readFileSync(RESULT, 'utf8');
  return { raw, report: JSON.parse(raw) as RecordedRetrievalReport };
}

describe('recorded qwen3:0.6b retrieval-assisted evidence', () => {
  it('retains an unmodified, source-bound 30-by-3 report', () => {
    const { raw, report } = readEvidence();
    const counts = new Map<string, number>();
    for (const result of report.batch.results) {
      counts.set(result.taskId, (counts.get(result.taskId) ?? 0) + 1);
    }

    expect(createHash('sha256').update(raw).digest('hex')).toBe(RESULT_SHA256);
    expect(report.version).toBe(2);
    expect(report.batch.version).toBe(2);
    expect(report.batch.results).toHaveLength(90);
    expect([...counts].sort()).toEqual(CORPUS.map(({ id }) => [id, 3] as const).sort());
    expect(report.batch.summary).toEqual(summarizeBenchmarkResults(report.batch.results));
  });

  it('binds every attempt to the same exact profile, source and model artifact', () => {
    const { report } = readEvidence();
    const profile = {
      id: 'travel-deterministic-v1',
      maxTools: 4,
      sourceRevision: '05f05007e10d12a800d8a1a9cd386dbfdbc1808a',
      version: 1,
    };

    expect(report.retrievalProfile).toEqual(profile);
    expect(report.batch.retrievalProfile).toEqual(profile);
    for (const result of report.batch.results) {
      expect(result.retrievalProfile).toEqual(profile);
    }
    expect(report.provenance).toMatchObject({
      digest: '7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435',
      model: 'qwen3:0.6b',
      quantization: 'Q4_K_M',
      serverVersion: '0.31.1',
    });
  });

  it('retains the ineligible verdict without inventing hardware or memory evidence', () => {
    const { report } = readEvidence();
    const failures = new Map<string, number>();
    for (const result of report.batch.results) {
      const code = result.failure?.code ?? 'none';
      failures.set(code, (failures.get(code) ?? 0) + 1);
    }

    expect(report.hardware).toBeUndefined();
    expect(report.memory).toBeUndefined();
    expect(report.batch.summary).toMatchObject({
      attemptCount: 90,
      completeTaskPassRate: 0,
      decisionCount: 90,
      identifierReuseRate: 0,
      schemaValidRate: 1,
      successfulAttemptCount: 0,
    });
    expect(Object.fromEntries(failures)).toEqual({
      approval_missing: 51,
      denial_mishandled: 3,
      missing_read: 36,
    });
    expect(report.selection).toEqual(evaluateLocalSelectionReadiness(report.batch, {
      attemptsPerTask: 3,
      tasks: CORPUS,
    }));
    expect(report.selection).toMatchObject({
      completeTaskPassRate: 0,
      eligible: false,
      identifierReuseRate: 0,
      p95EndToEndLatencyMs: 1_171,
      schemaValidRate: 1,
    });
  });
});
