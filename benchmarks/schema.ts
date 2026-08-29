/**
 * Contracts owned by the model and benchmark track.
 *
 * These contracts deliberately describe observable runtime behaviour rather
 * than a model provider's private API. A runner can therefore compare local,
 * cloud and scripted RuntimeModel implementations under the same policy.
 */

export const BENCHMARK_SCHEMA_VERSION = 1 as const;

export type BenchmarkCategory =
  | 'approval'
  | 'identifier_reuse'
  | 'recovery'
  | 'retrieval'
  | 'selection'
  | 'state_change';

export type ExpectedRunStatus =
  | 'approval_required'
  | 'completed'
  | 'denied'
  | 'stale_state'
  | 'step_limit'
  | 'write_failed';

export type BenchmarkFixtureId =
  | 'empty_trip'
  | 'human_edit_during_run'
  | 'seeded_tokyo_and_kyoto';

export interface IdentifierReuseExpectation {
  /** Tool that exposes the identifier in a successful result. */
  sourceTool: string;
  /** JSONPath-like, runner-owned path inside the source tool output. */
  sourceOutputPath: string;
  /** Tool that must consume the exact exposed identifier. */
  consumerTool: string;
  /** JSONPath-like, runner-owned path inside the consumer input. */
  consumerInputPath: string;
}

export interface ToolCallExpectation {
  min: number;
  max: number;
  requiredToolNames: readonly string[];
  forbiddenToolNames: readonly string[];
}

export interface BenchmarkExpectation {
  allowedStatuses: readonly ExpectedRunStatus[];
  approval: 'denied' | 'none' | 'required';
  identifierReuses: readonly IdentifierReuseExpectation[];
  stateEffect: 'changed' | 'unchanged';
  toolCalls: ToolCallExpectation;
}

export interface BenchmarkTask {
  categories: readonly BenchmarkCategory[];
  description: string;
  expected: BenchmarkExpectation;
  fixture: BenchmarkFixtureId;
  goal: string;
  id: string;
  title: string;
}

export type BenchmarkFailureCategory =
  | 'adapter'
  | 'approval'
  | 'configuration'
  | 'model_decision'
  | 'policy'
  | 'retrieval'
  | 'runtime'
  | 'state'
  | 'tool';

export interface BenchmarkFailure {
  category: BenchmarkFailureCategory;
  code: string;
  message: string;
  retryable: boolean;
}

export interface BenchmarkModelDescriptor {
  backend: 'cloud' | 'local' | 'scripted';
  identifier: string;
  quantization?: string;
}

export interface BenchmarkToolCallRecord {
  inputJson: string;
  outputJson?: string;
  step: number;
  toolName: string;
}

export interface BenchmarkMetrics {
  decisionCount: number;
  endToEndLatencyMs: number;
  identifierReuseRate: number;
  peakMemoryBytes?: number;
  schemaValidRate: number;
}

export interface BenchmarkAssertion {
  actual: string;
  expected: string;
  name: string;
  passed: boolean;
}

export interface BenchmarkResult {
  assertions: readonly BenchmarkAssertion[];
  completedAt: string;
  failure?: BenchmarkFailure;
  fixture: BenchmarkFixtureId;
  metrics: BenchmarkMetrics;
  model: BenchmarkModelDescriptor;
  outcome: ExpectedRunStatus | 'runtime_error';
  startedAt: string;
  taskId: string;
  toolCalls: readonly BenchmarkToolCallRecord[];
  version: typeof BENCHMARK_SCHEMA_VERSION;
}

/**
 * Reject broken task fixtures while they are still cheap to fix. The future
 * runner should call this before a model invocation, not after one.
 */
export function assertValidBenchmarkTask(task: BenchmarkTask): void {
  if (!/^smoke-[a-z0-9-]+$/.test(task.id)) {
    throw new Error(`Benchmark task id must start with "smoke-": ${task.id}`);
  }
  if (!task.title.trim() || !task.description.trim() || !task.goal.trim()) {
    throw new Error(`Benchmark task ${task.id} needs title, description and goal.`);
  }
  if (task.categories.length === 0 || new Set(task.categories).size !== task.categories.length) {
    throw new Error(`Benchmark task ${task.id} needs unique categories.`);
  }
  const { min, max, requiredToolNames, forbiddenToolNames } = task.expected.toolCalls;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new Error(`Benchmark task ${task.id} has invalid tool-call bounds.`);
  }
  if (new Set(requiredToolNames).size !== requiredToolNames.length) {
    throw new Error(`Benchmark task ${task.id} repeats a required tool.`);
  }
  if (requiredToolNames.length > min || requiredToolNames.length > max) {
    throw new Error(`Benchmark task ${task.id} cannot require more tools than its call bounds allow.`);
  }
  if (new Set(forbiddenToolNames).size !== forbiddenToolNames.length) {
    throw new Error(`Benchmark task ${task.id} repeats a forbidden tool.`);
  }
  if (requiredToolNames.some((tool) => forbiddenToolNames.includes(tool))) {
    throw new Error(`Benchmark task ${task.id} both requires and forbids a tool.`);
  }
  if (task.expected.allowedStatuses.length === 0) {
    throw new Error(`Benchmark task ${task.id} needs an allowed runtime status.`);
  }
  for (const reuse of task.expected.identifierReuses) {
    if (!reuse.sourceTool || !reuse.sourceOutputPath || !reuse.consumerTool || !reuse.consumerInputPath) {
      throw new Error(`Benchmark task ${task.id} has an incomplete identifier-reuse assertion.`);
    }
  }
}
