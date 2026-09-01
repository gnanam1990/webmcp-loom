import {
  AgentRuntimeError,
  createStaticToolProvider,
  parseAgentDecision,
  runAgentRuntime,
} from '@webmcp-loom/runtime';
import { createTravelTools } from '../apps/travel-showcase/src/tools.js';
import { benchmarkFixture } from './fixtures.js';
import {
  BENCHMARK_FAILURE_DEFAULTS,
  BENCHMARK_SCHEMA_VERSION,
  assertValidBenchmarkTask,
} from './schema.js';
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentToolResult,
  AgentRunResult,
  JsonObject,
  JsonValue,
  RuntimeModel,
  RuntimeModelRequest,
  RuntimeTool,
} from '@webmcp-loom/runtime';
import type {
  BenchmarkAssertion,
  BenchmarkFailure,
  BenchmarkFailureCode,
  BenchmarkModelDescriptor,
  BenchmarkResult,
  BenchmarkTask,
  BenchmarkToolCallRecord,
  IdentifierReuseExpectation,
} from './schema.js';

export interface BenchmarkRunnerOptions {
  /** Overrides the task-derived approval behaviour for an experiment. */
  approve?: (request: AgentApprovalRequest) => boolean | Promise<boolean>;
  /** Injected for reproducible result timestamps in tests and report generation. */
  now?: () => Date;
  model: RuntimeModel;
  modelDescriptor: BenchmarkModelDescriptor;
  task: BenchmarkTask;
}

interface ObservedModel {
  model: RuntimeModel;
  decisionCount(): number;
  generationFailed(): boolean;
  schemaValidCount(): number;
}

interface ObservedApproval {
  callback: ((request: AgentApprovalRequest) => boolean | Promise<boolean>) | undefined;
  failed(): boolean;
}

interface RunnerCall {
  input: JsonObject;
  output?: JsonValue;
  step: number;
  tool: string;
}

/**
 * Executes one task through the public runtime and real travel tools.
 *
 * The runner records observable protocol evidence only. It does not score the
 * natural-language quality of a final message or claim that a local model was
 * selected; those are separate report and review decisions.
 */
export async function runBenchmarkTask(options: BenchmarkRunnerOptions): Promise<BenchmarkResult> {
  assertValidBenchmarkTask(options.task);
  const startedAt = (options.now ?? (() => new Date()))();
  const startedMs = startedAt.getTime();
  const fixture = benchmarkFixture(options.task.fixture);
  const store = fixture.createStore();
  const tools = createTravelTools(store);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const observed = observeModel(options.model);
  const approval = observeApproval(options.approve ?? defaultApproval(options.task, fixture));
  let interrupted = false;
  let runtimeResult: AgentRunResult | undefined;
  let failure: BenchmarkFailure | undefined;
  const observedEvents: AgentEvent[] = [];

  try {
    runtimeResult = await runAgentRuntime({
      goal: options.task.goal,
      model: observed.model,
      toolProvider: createStaticToolProvider(tools),
      getStateRevision: () => store.getState().revision,
      maxSteps: options.task.expected.toolCalls.max + 1,
      ...(approval.callback === undefined ? {} : { approve: approval.callback }),
      onEvent: (event) => {
        observedEvents.push(event);
        if (!interrupted && event.type === 'tool_call_validated' && fixture.interrupt !== undefined) {
          interrupted = true;
          fixture.interrupt(store);
        }
      },
    });
  } catch (error) {
    failure = normalizeFailure(error, observed.generationFailed(), approval.failed());
  }

  const completedAt = (options.now ?? (() => new Date()))();
  const calls = collectCalls(runtimeResult?.history ?? [], runtimeResult?.events ?? observedEvents);
  if (failure === undefined && runtimeResult !== undefined) {
    failure = failureFromRuntimeHistory(runtimeResult.history);
  }
  const assertions = evaluateAssertions(options.task, runtimeResult, calls, toolsByName);
  const outcome = runtimeResult?.status ?? 'runtime_error';
  const result: BenchmarkResult = {
    assertions,
    completedAt: completedAt.toISOString(),
    ...(failure === undefined ? {} : { failure }),
    fixture: options.task.fixture,
    metrics: {
      decisionCount: observed.decisionCount(),
      endToEndLatencyMs: Math.max(0, completedAt.getTime() - startedMs),
      identifierReuseRate: assertionRate(assertions, 'identifier-reuse:'),
      schemaValidRate: rate(observed.schemaValidCount(), observed.decisionCount()),
    },
    model: options.modelDescriptor,
    outcome,
    startedAt: startedAt.toISOString(),
    taskId: options.task.id,
    toolCalls: calls.map(toToolCallRecord),
    version: BENCHMARK_SCHEMA_VERSION,
  };
  return result;
}

function observeModel(source: RuntimeModel): ObservedModel {
  let decisions = 0;
  let generationFailed = false;
  let schemaValid = 0;
  return {
    model: {
      async generate(request: RuntimeModelRequest): Promise<string> {
        let raw: string;
        try {
          raw = await source.generate(request);
        } catch (error) {
          generationFailed = true;
          throw error;
        }
        decisions += 1;
        try {
          parseAgentDecision(raw);
          schemaValid += 1;
        } catch {
          // The runtime remains the authority that rejects this untrusted output.
        }
        return raw;
      },
    },
    decisionCount: () => decisions,
    generationFailed: () => generationFailed,
    schemaValidCount: () => schemaValid,
  };
}

function defaultApproval(
  task: BenchmarkTask,
  fixture: ReturnType<typeof benchmarkFixture>,
): ((request: AgentApprovalRequest) => boolean) | undefined {
  if (task.expected.approval === 'denied') return () => false;
  // A stale fixture changes revision immediately after validation. Let the
  // runtime reach its post-approval stale guard for write-first scripts.
  if (fixture.interrupt !== undefined) return () => true;
  return undefined;
}

function observeApproval(
  source: ((request: AgentApprovalRequest) => boolean | Promise<boolean>) | undefined,
): ObservedApproval {
  let failed = false;
  return {
    callback: source === undefined
      ? undefined
      : async (request) => {
        try {
          return await source(request);
        } catch (error) {
          failed = true;
          throw error;
        }
      },
    failed: () => failed,
  };
}

function collectCalls(
  historyEntries: readonly AgentToolResult[],
  events: readonly AgentEvent[],
): RunnerCall[] {
  const history = new Map(historyEntries.map((entry) => [`${entry.step}:${entry.tool}`, entry]));
  return events.flatMap((event) => {
    if (event.type !== 'tool_call_validated') return [];
    const executed = history.get(`${event.step}:${event.toolName}`);
    return [{
      input: event.input,
      ...(executed?.ok && executed.output !== undefined ? { output: executed.output } : {}),
      step: event.step,
      tool: event.toolName,
    }];
  });
}

function toToolCallRecord(call: RunnerCall): BenchmarkToolCallRecord {
  return {
    inputJson: JSON.stringify(call.input),
    ...(call.output === undefined ? {} : { outputJson: JSON.stringify(call.output) }),
    step: call.step,
    toolName: call.tool,
  };
}

function evaluateAssertions(
  task: BenchmarkTask,
  runtimeResult: AgentRunResult | undefined,
  calls: readonly RunnerCall[],
  toolsByName: ReadonlyMap<string, RuntimeTool>,
): BenchmarkAssertion[] {
  const toolNames = calls.map((call) => call.tool);
  const assertions: BenchmarkAssertion[] = [
    assertion(
      'outcome',
      task.expected.allowedStatuses.join(', '),
      runtimeResult?.status ?? 'runtime_error',
      runtimeResult !== undefined && task.expected.allowedStatuses.includes(runtimeResult.status),
    ),
    assertion(
      'tool-call-bounds',
      `${task.expected.toolCalls.min}..${task.expected.toolCalls.max}`,
      String(toolNames.length),
      toolNames.length >= task.expected.toolCalls.min && toolNames.length <= task.expected.toolCalls.max,
    ),
  ];
  for (const tool of task.expected.toolCalls.requiredToolNames) {
    assertions.push(assertion(`required-tool:${tool}`, 'called', toolNames.includes(tool) ? 'called' : 'missing', toolNames.includes(tool)));
  }
  for (const tool of task.expected.toolCalls.forbiddenToolNames) {
    assertions.push(assertion(`forbidden-tool:${tool}`, 'not called', toolNames.includes(tool) ? 'called' : 'not called', !toolNames.includes(tool)));
  }
  assertions.push(approvalAssertion(task, runtimeResult));
  const completedWrites = calls.filter((call) => call.output !== undefined && !toolsByName.get(call.tool)?.annotations.readOnlyHint);
  assertions.push(assertion(
    'state-effect',
    task.expected.stateEffect,
    completedWrites.length > 0 ? 'changed' : 'unchanged',
    task.expected.stateEffect === 'changed' ? completedWrites.length > 0 : completedWrites.length === 0,
  ));
  for (const reuse of task.expected.identifierReuses) {
    assertions.push(identifierReuseAssertion(reuse, calls));
  }
  return assertions;
}

function approvalAssertion(task: BenchmarkTask, result: AgentRunResult | undefined): BenchmarkAssertion {
  const actual = result?.status ?? 'runtime_error';
  if (task.expected.approval === 'required') {
    return assertion('approval', 'approval_required', actual, actual === 'approval_required');
  }
  if (task.expected.approval === 'denied') {
    return assertion('approval', 'denied', actual, actual === 'denied');
  }
  return assertion('approval', 'no approval pause', actual, actual !== 'approval_required' && actual !== 'denied');
}

function identifierReuseAssertion(
  expectation: IdentifierReuseExpectation,
  calls: readonly RunnerCall[],
): BenchmarkAssertion {
  const exposed = calls
    .filter((call) => call.tool === expectation.sourceTool && call.output !== undefined)
    .flatMap((call) => valuesAtSourcePath(call.output, expectation.sourceOutputPath));
  const consumed = calls
    .filter((call) => call.tool === expectation.consumerTool)
    .flatMap((call) => valueAtConsumerPath(call.input, expectation.consumerInputPath));
  const passed = exposed.some((value) => consumed.includes(value));
  return assertion(
    `identifier-reuse:${expectation.sourceTool}->${expectation.consumerTool}`,
    `${expectation.sourceOutputPath} reused by ${expectation.consumerInputPath}`,
    passed ? 'exact identifier reused' : 'no matching identifier reuse',
    passed,
  );
}

function valuesAtSourcePath(output: JsonValue | undefined, path: string): readonly (number | string)[] {
  if (output === undefined || !isRecord(output)) return [];
  if (path === '$.revision') return scalarValues([output.revision]);
  const match = /^\$\.(activities|flights|items|stays)\[\*\]\.id$/.exec(path);
  if (match === null) return [];
  const collectionName = match[1];
  if (collectionName === undefined) return [];
  const collection = output[collectionName];
  if (!Array.isArray(collection)) return [];
  return collection.flatMap((entry) => isRecord(entry) ? scalarValues([entry.id]) : []);
}

function valueAtConsumerPath(input: JsonObject, path: string): readonly (number | string)[] {
  const match = /^\$\.(expectedRevision|itemId|refId)$/.exec(path);
  const key = match?.[1];
  return key === undefined ? [] : scalarValues([input[key]]);
}

function scalarValues(values: readonly unknown[]): readonly (number | string)[] {
  return values.filter((value): value is number | string => (
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertion(name: string, expected: string, actual: string, passed: boolean): BenchmarkAssertion {
  return { actual, expected, name, passed };
}

function assertionRate(assertions: readonly BenchmarkAssertion[], prefix: string): number {
  const relevant = assertions.filter((entry) => entry.name.startsWith(prefix));
  return relevant.length === 0 ? 1 : relevant.filter((entry) => entry.passed).length / relevant.length;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function normalizeFailure(
  error: unknown,
  generationFailed: boolean,
  approvalFailed: boolean,
): BenchmarkFailure {
  const code = failureCode(error, generationFailed, approvalFailed);
  return benchmarkFailure(code, error instanceof Error ? error.message : String(error));
}

function failureFromRuntimeHistory(history: readonly AgentToolResult[]): BenchmarkFailure | undefined {
  const failed = [...history].reverse().find((entry) => !entry.ok);
  return failed === undefined
    ? undefined
    : benchmarkFailure('execution_failed', failed.error ?? 'Tool execution failed.');
}

function benchmarkFailure(code: BenchmarkFailureCode, message: string): BenchmarkFailure {
  const defaults = BENCHMARK_FAILURE_DEFAULTS[code];
  return {
    category: defaults.category,
    code,
    message,
    retryable: defaults.retryable,
  } as BenchmarkFailure;
}

function failureCode(
  error: unknown,
  generationFailed: boolean,
  approvalFailed: boolean,
): BenchmarkFailureCode {
  if (approvalFailed) return 'approval_failed';
  if (error instanceof AgentRuntimeError) {
    if (error.code === 'invalid_decision') {
      if (error.message.includes('malformed JSON')) return 'malformed_json';
      if (error.message.includes('unsupported decision type')) return 'unknown_decision_type';
      return 'invalid_decision';
    }
    if (error.code === 'invalid_tool_input' || error.code === 'resource_limit') return 'invalid_decision';
    if (error.code === 'invalid_tool' || error.code === 'tool_changed') return 'tool_refresh_missing';
    if (error.code === 'tool_unavailable') return 'tool_unavailable';
    if (error.code === 'cancelled') return 'generation_cancelled';
  }
  if (generationFailed) return 'transport_failed';
  return 'execution_failed';
}
