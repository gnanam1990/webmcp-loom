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
  assertValidBenchmarkRetrievalProfile,
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
  RuntimeToolSelector,
} from '@webmcp-loom/runtime';
import type {
  BenchmarkAssertion,
  BenchmarkFailure,
  BenchmarkFailureCode,
  BenchmarkModelDescriptor,
  BenchmarkRetrievalProfile,
  BenchmarkResult,
  BenchmarkTask,
  BenchmarkToolCallRecord,
  IdentifierReuseExpectation,
} from './schema.js';

export interface BenchmarkRetrievalConfiguration {
  profile: BenchmarkRetrievalProfile;
  toolSelector: RuntimeToolSelector;
}

export interface BenchmarkRunnerOptions {
  /** Overrides the task-derived approval behaviour for an experiment. */
  approve?: (request: AgentApprovalRequest) => boolean | Promise<boolean>;
  /** Injected for reproducible result timestamps in tests and report generation. */
  now?: () => Date;
  model: RuntimeModel;
  modelDescriptor: BenchmarkModelDescriptor;
  retrieval?: BenchmarkRetrievalConfiguration;
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
  error?: string;
  input: JsonObject;
  output?: JsonValue;
  step: number;
  status: 'failed' | 'succeeded' | 'validated';
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
  const startedAt = (options.now ?? (() => new Date()))();
  const startedMs = startedAt.getTime();
  let fixture: ReturnType<typeof benchmarkFixture>;
  try {
    assertValidBenchmarkTask(options.task);
    if (options.retrieval !== undefined) {
      assertValidBenchmarkRetrievalProfile(options.retrieval.profile);
    }
    fixture = benchmarkFixture(options.task.fixture);
  } catch (error) {
    return configurationResult(options, startedAt, error);
  }
  const store = fixture.createStore();
  const tools = createTravelTools(store);
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const observed = observeModel(options.model);
  const approval = observeApproval(options.approve ?? defaultApproval(options.task, fixture));
  let interrupted = false;
  let runtimeResult: AgentRunResult | undefined;
  let failure: BenchmarkFailure | undefined;
  const observedEvents: AgentEvent[] = [];
  const validatedCalls = new Map<number, { input: JsonObject; tool: string }>();
  let activeCall: { input: JsonObject; step: number; tool: string } | undefined;
  const observedHistory: AgentToolResult[] = [];
  const observedTools = tools.map((tool) => ({
    ...tool,
    execute: async (input: JsonObject, context: Parameters<typeof tool.execute>[1]): Promise<unknown> => {
      const call = activeCall?.tool === tool.name ? activeCall : undefined;
      try {
        const output = await tool.execute(input, context);
        // The public runtime remains the output-normalization authority. Travel
        // tools are JSON-contract tools, so this shadow history is only used if
        // a later runtime step throws before its normalized history is returned.
        if (call !== undefined) observedHistory.push({ ...call, ok: true, output: output as JsonValue });
        return output;
      } catch (error) {
        if (call !== undefined) {
          observedHistory.push({
            ...call,
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          });
        }
        throw error;
      } finally {
        if (activeCall === call) activeCall = undefined;
      }
    },
  }));

  try {
    runtimeResult = await runAgentRuntime({
      goal: options.task.goal,
      model: observed.model,
      toolProvider: createStaticToolProvider(observedTools),
      getStateRevision: () => store.getState().revision,
      maxSteps: options.task.expected.toolCalls.max + 1,
      maxToolCalls: options.task.expected.toolCalls.max,
      ...(options.retrieval === undefined
        ? {}
        : { toolSelector: boundedToolSelector(options.retrieval) }),
      ...(approval.callback === undefined ? {} : { approve: approval.callback }),
      onEvent: (event) => {
        observedEvents.push(event);
        if (event.type === 'tool_call_validated') {
          validatedCalls.set(event.step, { input: event.input, tool: event.toolName });
        }
        if (event.type === 'tool_started') {
          const validated = validatedCalls.get(event.step);
          if (validated !== undefined && validated.tool === event.toolName) {
            activeCall = { ...validated, step: event.step };
          }
        }
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
  const history = runtimeResult?.history ?? observedHistory;
  const calls = collectCalls(history, runtimeResult?.events ?? observedEvents);
  if (failure === undefined && runtimeResult !== undefined) {
    failure = failureFromRuntimeHistory(runtimeResult.history);
  }
  const assertions = evaluateAssertions(options.task, runtimeResult, calls, toolsByName);
  if (failure === undefined) failure = failureFromAssertions(assertions, toolsByName);
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
    ...(options.retrieval === undefined ? {} : { retrievalProfile: options.retrieval.profile }),
    startedAt: startedAt.toISOString(),
    taskId: options.task.id,
    toolCalls: calls.map(toToolCallRecord),
    version: BENCHMARK_SCHEMA_VERSION,
  };
  return result;
}

/** Keeps the selector's effective prompt surface within its recorded cap. */
function boundedToolSelector(retrieval: BenchmarkRetrievalConfiguration): RuntimeToolSelector {
  return (context) => {
    const selectedNames = retrieval.toolSelector(context);
    return Array.isArray(selectedNames)
      ? selectedNames.slice(0, retrieval.profile.maxTools)
      : selectedNames;
  };
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
      ...(executed?.ok === false && executed.error !== undefined ? { error: executed.error } : {}),
      step: event.step,
      status: executed === undefined ? 'validated' : executed.ok ? 'succeeded' : 'failed',
      tool: event.toolName,
    }];
  });
}

function toToolCallRecord(call: RunnerCall): BenchmarkToolCallRecord {
  return {
    ...(call.error === undefined ? {} : { error: call.error }),
    inputJson: JSON.stringify(call.input),
    ...(call.output === undefined ? {} : { outputJson: JSON.stringify(call.output) }),
    step: call.step,
    status: call.status,
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
  const completedWrites = calls.filter((call) => (
    call.status === 'succeeded'
    && call.output !== undefined
    && !toolsByName.get(call.tool)?.annotations.readOnlyHint
  ));
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
  const passed = calls
    .filter((consumer) => consumer.tool === expectation.consumerTool)
    .some((consumer) => {
      const consumed = valueAtConsumerPath(consumer.input, expectation.consumerInputPath);
      return calls
        .filter((source) => (
          source.tool === expectation.sourceTool
          && source.step < consumer.step
          && source.output !== undefined
        ))
        .flatMap((source) => valuesAtSourcePath(source.output, expectation.sourceOutputPath))
        .some((value) => consumed.includes(value));
    });
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

function configurationResult(
  options: BenchmarkRunnerOptions,
  startedAt: Date,
  error: unknown,
): BenchmarkResult {
  const code: BenchmarkFailureCode = error instanceof Error && error.message.startsWith('Unknown benchmark fixture')
    ? 'missing_fixture'
    : error instanceof Error && error.message.startsWith('Retrieval profile')
      ? 'missing_profile'
    : 'invalid_task';
  return {
    assertions: [],
    completedAt: startedAt.toISOString(),
    failure: benchmarkFailure(code, error instanceof Error ? error.message : String(error)),
    fixture: options.task.fixture,
    metrics: {
      decisionCount: 0,
      endToEndLatencyMs: 0,
      identifierReuseRate: 1,
      schemaValidRate: 1,
    },
    model: options.modelDescriptor,
    outcome: 'runtime_error',
    ...(options.retrieval === undefined || code === 'missing_profile'
      ? {}
      : { retrievalProfile: options.retrieval.profile }),
    startedAt: startedAt.toISOString(),
    taskId: options.task.id,
    toolCalls: [],
    version: BENCHMARK_SCHEMA_VERSION,
  };
}

function failureFromRuntimeHistory(history: readonly AgentToolResult[]): BenchmarkFailure | undefined {
  const failed = [...history].reverse().find((entry) => !entry.ok);
  return failed === undefined
    ? undefined
    : benchmarkFailure('execution_failed', failed.error ?? 'Tool execution failed.');
}

function failureFromAssertions(
  assertions: readonly BenchmarkAssertion[],
  toolsByName: ReadonlyMap<string, RuntimeTool>,
): BenchmarkFailure | undefined {
  const failed = assertions.filter((assertion) => !assertion.passed);
  const named = (prefix: string): BenchmarkAssertion | undefined => failed.find(({ name }) => name.startsWith(prefix));
  const forbidden = named('forbidden-tool:');
  if (forbidden !== undefined) return benchmarkFailure('forbidden_capability', `${forbidden.name}: ${forbidden.actual}`);
  const approval = named('approval');
  if (approval !== undefined) {
    const code = approval.expected === 'denied' ? 'denial_mishandled' : 'approval_missing';
    return benchmarkFailure(code, `${approval.name}: expected ${approval.expected}, received ${approval.actual}`);
  }
  const reuse = named('identifier-reuse:');
  if (reuse !== undefined) return benchmarkFailure('identifier_reuse_failed', `${reuse.name}: ${reuse.actual}`);
  const required = named('required-tool:');
  if (required !== undefined) {
    const toolName = required.name.slice('required-tool:'.length);
    const code = toolsByName.get(toolName)?.annotations.readOnlyHint
      ? 'missing_read'
      : 'missing_required_tool';
    return benchmarkFailure(code, `${required.name}: ${required.actual}`);
  }
  const bounds = named('tool-call-bounds');
  if (bounds !== undefined) return benchmarkFailure('step_accounting_invalid', `${bounds.name}: ${bounds.actual}`);
  const state = named('state-effect');
  if (state !== undefined) return benchmarkFailure('revision_mismatch', `${state.name}: ${state.actual}`);
  const outcome = named('outcome');
  return outcome === undefined ? undefined : benchmarkFailure('invalid_decision', `${outcome.name}: ${outcome.actual}`);
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
    if (error.code === 'tool_unavailable') {
      return error.message.startsWith('Model requested an unavailable tool') ? 'wrong_tool' : 'tool_unavailable';
    }
    if (error.code === 'cancelled') return 'generation_cancelled';
  }
  if (generationFailed) return 'transport_failed';
  return 'execution_failed';
}
