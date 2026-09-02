import { runBenchmarkTask } from './runner.js';
import { assertValidBenchmarkRetrievalProfile } from './schema.js';
import type { BenchmarkRetrievalConfiguration } from './runner.js';
import type {
  BenchmarkModelDescriptor,
  BenchmarkResult,
  BenchmarkRetrievalProfile,
  BenchmarkTask,
} from './schema.js';
import type { AgentApprovalRequest, RuntimeModel } from '@webmcp-loom/runtime';

export const BENCHMARK_BATCH_VERSION = 2 as const;

export interface BenchmarkBatchOptions {
  approve?: (request: AgentApprovalRequest) => boolean | Promise<boolean>;
  attemptsPerTask: number;
  createModel: (task: BenchmarkTask, attempt: number) => RuntimeModel;
  model: BenchmarkModelDescriptor;
  now?: () => Date;
  retrieval?: BenchmarkRetrievalConfiguration;
  tasks: readonly BenchmarkTask[];
}

export interface BenchmarkBatchSummary {
  attemptCount: number;
  completeTaskPassRate: number;
  decisionCount: number;
  identifierReuseRate: number;
  meanEndToEndLatencyMs: number;
  schemaValidRate: number;
  successfulAttemptCount: number;
}

export interface BenchmarkBatchReport {
  model: BenchmarkModelDescriptor;
  retrievalProfile?: BenchmarkRetrievalProfile;
  results: readonly BenchmarkResult[];
  summary: BenchmarkBatchSummary;
  version: 1 | typeof BENCHMARK_BATCH_VERSION;
}

/** Runs every supplied task the same number of times without hiding failures. */
export async function runBenchmarkBatch(options: BenchmarkBatchOptions): Promise<BenchmarkBatchReport> {
  if (!Number.isInteger(options.attemptsPerTask) || options.attemptsPerTask < 1) {
    throw new Error('attemptsPerTask must be a positive integer.');
  }
  if (options.tasks.length === 0) throw new Error('At least one benchmark task is required.');
  if (options.retrieval !== undefined) {
    assertValidBenchmarkRetrievalProfile(options.retrieval.profile);
  }

  const results: BenchmarkResult[] = [];
  for (const task of options.tasks) {
    for (let attempt = 1; attempt <= options.attemptsPerTask; attempt += 1) {
      results.push(await runBenchmarkTask({
        ...(options.approve === undefined ? {} : { approve: options.approve }),
        model: options.createModel(task, attempt),
        modelDescriptor: options.model,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.retrieval === undefined ? {} : { retrieval: options.retrieval }),
        task,
      }));
    }
  }
  return {
    model: options.model,
    ...(options.retrieval === undefined ? {} : { retrievalProfile: options.retrieval.profile }),
    results,
    summary: summarizeBenchmarkResults(results),
    version: BENCHMARK_BATCH_VERSION,
  };
}

/** Aggregates all attempts, including invalid or failed model responses. */
export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): BenchmarkBatchSummary {
  if (results.length === 0) {
    return {
      attemptCount: 0,
      completeTaskPassRate: 0,
      decisionCount: 0,
      identifierReuseRate: 1,
      meanEndToEndLatencyMs: 0,
      schemaValidRate: 1,
      successfulAttemptCount: 0,
    };
  }
  const decisionCount = results.reduce((total, result) => total + result.metrics.decisionCount, 0);
  const successfulAttemptCount = results.filter((result) => result.assertions.every(({ passed }) => passed)).length;
  const identifierReuseAssertions = results.flatMap((result) => (
    result.assertions.filter(({ name }) => name.startsWith('identifier-reuse:'))
  ));
  return {
    attemptCount: results.length,
    completeTaskPassRate: successfulAttemptCount / results.length,
    decisionCount,
    identifierReuseRate: identifierReuseAssertions.length === 0
      ? 1
      : identifierReuseAssertions.filter(({ passed }) => passed).length / identifierReuseAssertions.length,
    meanEndToEndLatencyMs: results.reduce((total, result) => (
      total + result.metrics.endToEndLatencyMs
    ), 0) / results.length,
    schemaValidRate: decisionCount === 0
      ? 1
      : results.reduce((total, result) => (
        total + (result.metrics.schemaValidRate * result.metrics.decisionCount)
      ), 0) / decisionCount,
    successfulAttemptCount,
  };
}
