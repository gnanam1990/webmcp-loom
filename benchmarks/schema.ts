/**
 * Contracts owned by the model and benchmark track.
 *
 * These contracts deliberately describe observable runtime behaviour rather
 * than a model provider's private API. A runner can therefore compare local,
 * cloud and scripted RuntimeModel implementations under the same policy.
 */

export const BENCHMARK_SCHEMA_VERSION = 1 as const;
/**
 * The runtime permits at most twenty decisions. A benchmark that expects N
 * tool calls also needs one final decision, so N must remain below that cap.
 */
export const BENCHMARK_MAX_TOOL_CALLS = 19 as const;

export type BenchmarkCategory =
  | 'approval'
  | 'identifier_reuse'
  | 'recovery'
  | 'retrieval'
  | 'selection'
  | 'state_change'
  /**
   * A goal the tool surface deliberately cannot satisfy — booking, payment,
   * deletion. Required by the evaluation plan, and distinct from the others
   * because success is measured by what the model declines to attempt.
   */
  | 'unavailable_tool';

export type ExpectedRunStatus =
  | 'approval_required'
  | 'cancelled'
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
  | 'selection'
  | 'state'
  | 'tool';

export const BENCHMARK_FAILURE_DEFAULTS = {
  invalid_task: { category: 'configuration', retryable: false },
  missing_fixture: { category: 'configuration', retryable: false },
  missing_profile: { category: 'configuration', retryable: false },
  load_failed: { category: 'adapter', retryable: true },
  transport_failed: { category: 'adapter', retryable: true },
  generation_cancelled: { category: 'adapter', retryable: false },
  response_unsupported: { category: 'adapter', retryable: false },
  malformed_json: { category: 'model_decision', retryable: false },
  invalid_decision: { category: 'model_decision', retryable: false },
  unknown_decision_type: { category: 'model_decision', retryable: false },
  missing_read: { category: 'retrieval', retryable: false },
  missing_required_tool: { category: 'selection', retryable: false },
  wrong_tool: { category: 'retrieval', retryable: false },
  unknown_identifier: { category: 'retrieval', retryable: false },
  identifier_reuse_failed: { category: 'retrieval', retryable: false },
  approval_missing: { category: 'approval', retryable: false },
  approval_failed: { category: 'approval', retryable: true },
  denial_mishandled: { category: 'approval', retryable: false },
  approval_bypassed: { category: 'approval', retryable: false },
  stale_stop_missing: { category: 'state', retryable: false },
  stale_write_attempted: { category: 'state', retryable: false },
  revision_mismatch: { category: 'state', retryable: false },
  execution_failed: { category: 'tool', retryable: false },
  tool_unavailable: { category: 'tool', retryable: false },
  invalid_output: { category: 'tool', retryable: false },
  tool_refresh_missing: { category: 'runtime', retryable: false },
  step_accounting_invalid: { category: 'runtime', retryable: false },
  cancellation_lost: { category: 'runtime', retryable: false },
  event_order_invalid: { category: 'runtime', retryable: false },
  forbidden_capability: { category: 'policy', retryable: false },
  ambiguous_write_retried: { category: 'policy', retryable: false },
} as const satisfies Record<string, {
  category: BenchmarkFailureCategory;
  retryable: boolean;
}>;

export type BenchmarkFailureCode = keyof typeof BENCHMARK_FAILURE_DEFAULTS;

type BenchmarkFailureFor<Code extends BenchmarkFailureCode> = {
  category: typeof BENCHMARK_FAILURE_DEFAULTS[Code]['category'];
  code: Code;
  message: string;
  retryable: typeof BENCHMARK_FAILURE_DEFAULTS[Code]['retryable'];
};

/** Code, category and retryability are one discriminated, taxonomy-owned contract. */
export type BenchmarkFailure = {
  [Code in BenchmarkFailureCode]: BenchmarkFailureFor<Code>;
}[BenchmarkFailureCode];

export interface BenchmarkModelDescriptor {
  backend: 'cloud' | 'local' | 'scripted';
  identifier: string;
  quantization?: string;
}

/** Serializable identity of the prompt-shaping profile used by one run. */
export interface BenchmarkRetrievalProfile {
  id: string;
  maxTools: number;
  /** Exact repository commit containing the profile implementation. */
  sourceRevision: string;
  version: number;
}

export interface BenchmarkToolCallRecord {
  error?: string;
  inputJson: string;
  outputJson?: string;
  step: number;
  status: 'failed' | 'succeeded' | 'validated';
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
  retrievalProfile?: BenchmarkRetrievalProfile;
  startedAt: string;
  taskId: string;
  toolCalls: readonly BenchmarkToolCallRecord[];
  version: typeof BENCHMARK_SCHEMA_VERSION;
}

/** Rejects incomplete retrieval provenance before a model is invoked. */
export function assertValidBenchmarkRetrievalProfile(profile: BenchmarkRetrievalProfile): void {
  if (!profile.id.trim()) throw new Error('Retrieval profile id is required.');
  if (!Number.isInteger(profile.version) || profile.version < 1) {
    throw new Error('Retrieval profile version must be a positive integer.');
  }
  if (!Number.isInteger(profile.maxTools) || profile.maxTools < 1 || profile.maxTools > 20) {
    throw new Error('Retrieval profile maxTools must be an integer from 1 to 20.');
  }
  if (!/^[0-9a-f]{40}$/i.test(profile.sourceRevision)) {
    throw new Error('Retrieval profile sourceRevision must be an exact 40-character Git commit.');
  }
}

/**
 * Reject broken task fixtures while they are still cheap to fix. The future
 * runner should call this before a model invocation, not after one.
 */
export function assertValidBenchmarkTask(task: BenchmarkTask): void {
  // The corpus outgrows the Day 1 smoke suite, so the prefix names which suite
  // a task belongs to rather than pinning every task to the first one.
  if (!/^(smoke|travel)-[a-z0-9-]+$/.test(task.id)) {
    throw new Error(`Benchmark task id must start with "smoke-" or "travel-": ${task.id}`);
  }
  if (!task.title.trim() || !task.description.trim() || !task.goal.trim()) {
    throw new Error(`Benchmark task ${task.id} needs title, description and goal.`);
  }
  if (task.categories.length === 0 || new Set(task.categories).size !== task.categories.length) {
    throw new Error(`Benchmark task ${task.id} needs unique categories.`);
  }
  const { min, max, requiredToolNames, forbiddenToolNames } = task.expected.toolCalls;
  if (!Number.isInteger(min)
    || !Number.isInteger(max)
    || min < 0
    || max < min
    || max > BENCHMARK_MAX_TOOL_CALLS) {
    throw new Error(`Benchmark task ${task.id} has invalid tool-call bounds.`);
  }
  if (requiredToolNames.some((tool) => !tool.trim())) {
    throw new Error(`Benchmark task ${task.id} has an empty required tool.`);
  }
  if (new Set(requiredToolNames).size !== requiredToolNames.length) {
    throw new Error(`Benchmark task ${task.id} repeats a required tool.`);
  }
  if (requiredToolNames.length > min || requiredToolNames.length > max) {
    throw new Error(`Benchmark task ${task.id} cannot require more tools than its call bounds allow.`);
  }
  if (forbiddenToolNames.some((tool) => !tool.trim())) {
    throw new Error(`Benchmark task ${task.id} has an empty forbidden tool.`);
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
  if (new Set(task.expected.allowedStatuses).size !== task.expected.allowedStatuses.length) {
    throw new Error(`Benchmark task ${task.id} repeats an allowed runtime status.`);
  }
  for (const reuse of task.expected.identifierReuses) {
    if (![reuse.sourceTool, reuse.sourceOutputPath, reuse.consumerTool, reuse.consumerInputPath]
      .every((value) => value.trim())) {
      throw new Error(`Benchmark task ${task.id} has an incomplete identifier-reuse assertion.`);
    }
  }
}
