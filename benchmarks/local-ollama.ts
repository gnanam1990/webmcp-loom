/**
 * Reproducible local-Ollama benchmark assembly.
 *
 * This module deliberately does not download models, inspect cloud providers,
 * or make a showcase-selection claim. It binds a local artifact's provenance
 * to every retained batch attempt and makes missing hardware or memory evidence
 * an explicit selection blocker rather than an implicit waiver.
 */

import {
  createOllamaRuntimeModel,
  inspectOllamaModel,
} from '../packages/model-adapters/src/ollama.js';
import { runBenchmarkBatch } from './batch.js';
import { assertValidBenchmarkRetrievalProfile } from './schema.js';
import type {
  OllamaModelProvenance,
  OllamaRuntimeModelOptions,
} from '../packages/model-adapters/src/ollama.js';
import type { RuntimeModel } from '@webmcp-loom/runtime';
import type { BenchmarkBatchReport } from './batch.js';
import type { BenchmarkRetrievalConfiguration } from './runner.js';
import type { BenchmarkRetrievalProfile } from './schema.js';
import type { BenchmarkResult, BenchmarkTask } from './schema.js';

export const LOCAL_OLLAMA_BENCHMARK_VERSION = 3 as const;

export interface LocalBenchmarkDecodingSettings {
  maxTokens: number;
  seed: number;
  temperature: number;
}

export interface LocalBenchmarkHardwareProfile {
  architecture: string;
  latencyBudgetMs: number;
  memoryBudgetBytes: number;
  name: string;
  operatingSystem: string;
}

export interface LocalBenchmarkMemoryMeasurement {
  /** For example, `ollama-runner RSS sampled with ps`. */
  method: string;
  peakMemoryBytes: number;
  samplingIntervalMs: number;
}

export interface LocalBenchmarkMemorySampler {
  measure<T>(operation: () => Promise<T>): Promise<{
    memory: LocalBenchmarkMemoryMeasurement;
    value: T;
  }>;
}

export interface LocalOllamaBenchmarkOptions {
  attemptsPerTask: number;
  baseUrl: string;
  /** Required for selection-grade evidence; absent runs remain exploratory. */
  hardware?: LocalBenchmarkHardwareProfile;
  /** Required for selection-grade evidence; absent runs remain exploratory. */
  memory?: LocalBenchmarkMemoryMeasurement;
  /** Samples the serving runtime around the batch; mutually exclusive with `memory`. */
  memorySampler?: LocalBenchmarkMemorySampler;
  model: string;
  modelOptions?: Omit<OllamaRuntimeModelOptions, 'baseUrl' | 'model'>;
  now?: () => Date;
  retrieval?: BenchmarkRetrievalConfiguration;
  tasks: readonly BenchmarkTask[];
}

export interface LocalSelectionReadiness {
  blockers: readonly string[];
  completeTaskPassRate: number;
  eligible: boolean;
  identifierReuseRate: number;
  p95EndToEndLatencyMs: number;
  schemaValidRate: number;
}

export interface LocalOllamaBenchmarkReport {
  batch: BenchmarkBatchReport;
  decoding?: LocalBenchmarkDecodingSettings;
  generatedAt: string;
  hardware?: LocalBenchmarkHardwareProfile;
  memory?: LocalBenchmarkMemoryMeasurement;
  provenance: OllamaModelProvenance;
  retrievalProfile?: BenchmarkRetrievalProfile;
  selection: LocalSelectionReadiness;
  version: 1 | 2 | typeof LOCAL_OLLAMA_BENCHMARK_VERSION;
}

export interface LocalOllamaBenchmarkDependencies {
  createModel: (options: OllamaRuntimeModelOptions) => RuntimeModel;
  inspectModel: (baseUrl: string, model: string) => Promise<OllamaModelProvenance>;
}

const DEFAULT_DEPENDENCIES: LocalOllamaBenchmarkDependencies = {
  createModel: createOllamaRuntimeModel,
  inspectModel: inspectOllamaModel,
};

/**
 * Runs all supplied tasks against one explicitly named local Ollama artifact.
 * Every attempt is kept even when a decision is malformed or the runtime fails.
 */
export async function runLocalOllamaBenchmark(
  options: LocalOllamaBenchmarkOptions,
  dependencies: LocalOllamaBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): Promise<LocalOllamaBenchmarkReport> {
  validateOptions(options);
  const provenance = await dependencies.inspectModel(options.baseUrl, options.model);
  const decoding: LocalBenchmarkDecodingSettings = {
    maxTokens: options.modelOptions?.maxTokens ?? 128,
    seed: options.modelOptions?.seed ?? 42,
    temperature: options.modelOptions?.temperature ?? 0,
  };
  const runBatch = async (): Promise<BenchmarkBatchReport> => runBenchmarkBatch({
    attemptsPerTask: options.attemptsPerTask,
    createModel: () => dependencies.createModel({
      ...decoding,
      baseUrl: options.baseUrl,
      model: options.model,
    }),
    model: {
      backend: 'local',
      identifier: options.model,
      ...(provenance.quantization === undefined ? {} : { quantization: provenance.quantization }),
    },
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.retrieval === undefined ? {} : { retrieval: options.retrieval }),
    tasks: options.tasks,
  });
  const measured = options.memorySampler === undefined
    ? { memory: options.memory, value: await runBatch() }
    : await options.memorySampler.measure(runBatch);
  const report = measured.value;
  const memory = measured.memory;
  validateMemory(memory);
  return {
    batch: report,
    decoding,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    ...(options.hardware === undefined ? {} : { hardware: options.hardware }),
    ...(memory === undefined ? {} : { memory }),
    provenance,
    ...(options.retrieval === undefined ? {} : { retrievalProfile: options.retrieval.profile }),
    selection: evaluateLocalSelectionReadiness(report, {
      ...options,
      ...(memory === undefined ? {} : { memory }),
    }),
    version: LOCAL_OLLAMA_BENCHMARK_VERSION,
  };
}

/**
 * Implements the documented gate math, but never upgrades a report that lacks
 * declared target hardware or a measured memory peak into selection evidence.
 */
export function evaluateLocalSelectionReadiness(
  report: BenchmarkBatchReport,
  options: Pick<LocalOllamaBenchmarkOptions, 'attemptsPerTask' | 'hardware' | 'memory' | 'tasks'>,
): LocalSelectionReadiness {
  const p95EndToEndLatencyMs = percentile95(report.results.map((result) => result.metrics.endToEndLatencyMs));
  const blockers: string[] = [];
  if (options.tasks.length < 30) blockers.push('at least 30 deterministic tasks are required');
  if (options.attemptsPerTask < 3) blockers.push('at least three attempts per task are required');
  if (report.results.length !== options.tasks.length * options.attemptsPerTask) {
    blockers.push('report does not retain every declared task attempt');
  }
  if (options.hardware === undefined) {
    blockers.push('target hardware and latency/memory budgets were not declared');
  } else {
    if (p95EndToEndLatencyMs > options.hardware.latencyBudgetMs) {
      blockers.push('p95 end-to-end latency exceeds the declared hardware budget');
    }
    if (options.memory === undefined) {
      blockers.push('peak memory measurement was not recorded');
    } else if (options.memory.peakMemoryBytes > options.hardware.memoryBudgetBytes) {
      blockers.push('peak memory exceeds the declared hardware budget');
    }
  }
  if (report.summary.schemaValidRate < 0.98) blockers.push('schema-valid decision rate is below 98%');
  if (report.summary.completeTaskPassRate < 0.9) blockers.push('complete task pass rate is below 90%');
  if (report.summary.identifierReuseRate < 1) blockers.push('identifier reuse is below 100%');
  if (!allRequiredOutcomesPass(report.results)) {
    blockers.push('at least one safety, approval, or state-recovery assertion failed');
  }
  return {
    blockers,
    completeTaskPassRate: report.summary.completeTaskPassRate,
    eligible: blockers.length === 0,
    identifierReuseRate: report.summary.identifierReuseRate,
    p95EndToEndLatencyMs,
    schemaValidRate: report.summary.schemaValidRate,
  };
}

function allRequiredOutcomesPass(results: readonly BenchmarkResult[]): boolean {
  return results.every((result) => result.assertions.every((assertion) => assertion.passed));
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function validateOptions(options: LocalOllamaBenchmarkOptions): void {
  if (!options.baseUrl.trim()) throw new Error('Ollama baseUrl is required.');
  if (!options.model.trim()) throw new Error('Ollama model is required.');
  if (!Number.isInteger(options.attemptsPerTask) || options.attemptsPerTask < 1) {
    throw new Error('attemptsPerTask must be a positive integer.');
  }
  if (options.tasks.length === 0) throw new Error('At least one benchmark task is required.');
  if (options.memory !== undefined && options.memorySampler !== undefined) {
    throw new Error('Provide either a memory measurement or a memory sampler, not both.');
  }
  validateDecoding(options.modelOptions);
  if (options.retrieval !== undefined) {
    assertValidBenchmarkRetrievalProfile(options.retrieval.profile);
  }
  validateHardware(options.hardware);
  validateMemory(options.memory);
}

function validateDecoding(
  decoding: Omit<OllamaRuntimeModelOptions, 'baseUrl' | 'model'> | undefined,
): void {
  if (decoding?.maxTokens !== undefined
    && (!Number.isInteger(decoding.maxTokens) || decoding.maxTokens <= 0)) {
    throw new Error('modelOptions maxTokens must be a positive integer.');
  }
  if (decoding?.seed !== undefined && !Number.isInteger(decoding.seed)) {
    throw new Error('modelOptions seed must be an integer.');
  }
  if (decoding?.temperature !== undefined
    && (!Number.isFinite(decoding.temperature) || decoding.temperature < 0)) {
    throw new Error('modelOptions temperature must be a non-negative finite number.');
  }
}

function validateHardware(hardware: LocalBenchmarkHardwareProfile | undefined): void {
  if (hardware === undefined) return;
  if (!hardware.name.trim() || !hardware.architecture.trim() || !hardware.operatingSystem.trim()) {
    throw new Error('hardware profile needs a name, architecture and operating system.');
  }
  if (!Number.isFinite(hardware.latencyBudgetMs) || hardware.latencyBudgetMs <= 0) {
    throw new Error('hardware latencyBudgetMs must be positive.');
  }
  if (!Number.isInteger(hardware.memoryBudgetBytes) || hardware.memoryBudgetBytes <= 0) {
    throw new Error('hardware memoryBudgetBytes must be a positive integer.');
  }
}

function validateMemory(memory: LocalBenchmarkMemoryMeasurement | undefined): void {
  if (memory === undefined) return;
  if (!memory.method.trim()) throw new Error('memory measurement needs a method.');
  if (!Number.isInteger(memory.peakMemoryBytes) || memory.peakMemoryBytes <= 0) {
    throw new Error('memory peakMemoryBytes must be a positive integer.');
  }
  if (!Number.isInteger(memory.samplingIntervalMs) || memory.samplingIntervalMs <= 0) {
    throw new Error('memory samplingIntervalMs must be a positive integer.');
  }
}
