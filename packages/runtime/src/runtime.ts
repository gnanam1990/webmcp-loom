import { RUNTIME_LIMITS, normalizeToolError, normalizeToolOutput } from './bounds.js';
import { AgentRuntimeError } from './errors.js';
import { cloneJsonObject, cloneJsonValue } from './json.js';
import {
  buildAgentRuntimePrompt,
  getAgentDecisionSchema,
  parseAgentDecision,
} from './prompt.js';
import {
  describeTool,
  snapshotToolRegistry,
  toolFingerprint,
} from './registry.js';
import { validateToolInput } from './schema.js';
import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  AgentToolResult,
  JsonObject,
  JsonValue,
  RuntimeStateRevision,
  RuntimeTool,
  ToolRefreshPhase,
} from './types.js';

const DEFAULT_MAX_STEPS = 6;
const MAX_ALLOWED_STEPS = 20;

export async function runAgentRuntime(options: AgentRunOptions): Promise<AgentRunResult> {
  const goal = options.goal.trim();
  if (!goal) throw configurationError('Enter an agent goal first.');
  if (goal.length > RUNTIME_LIMITS.goalCharacters) {
    throw new AgentRuntimeError('resource_limit', 'Agent goal exceeded the runtime size limit.');
  }
  const maxSteps = normalizeMaxSteps(options.maxSteps);
  const maxToolCalls = normalizeMaxToolCalls(options.maxToolCalls);
  const history: AgentToolResult[] = [];
  const events: AgentEvent[] = [];
  let currentStep = 0;
  let executedToolCalls = 0;
  const emit = (event: AgentEvent): void => {
    const stored = cloneEvent(event);
    events.push(stored);
    try {
      void Promise.resolve(options.onEvent?.(cloneEvent(event))).catch(() => undefined);
    } catch {
      // Observers cannot change runtime state or turn success into apparent failure.
    }
  };

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      currentStep = step;
      throwIfAborted(options.signal);
      const promptTools = await refreshTools(options, step, 'prompt', emit);
      const stateRevision = await readStateRevision(options);
      throwIfAborted(options.signal);

      const rawDecision = await raceWithAbort(
        options.model.generate({
          prompt: buildAgentRuntimePrompt(goal, promptTools, history, stateRevision),
          responseSchema: getAgentDecisionSchema(),
          signal: options.signal,
        }),
        options.signal,
      );
      throwIfAborted(options.signal);
      const decision = parseAgentDecision(rawDecision);
      const staleAfterModel = await staleStateResult(
        stateRevision,
        options,
        step,
        history,
        events,
        emit,
      );
      if (staleAfterModel !== undefined) return staleAfterModel;

      if (decision.type === 'final') {
        emit({ type: 'completed', step, message: decision.message });
        return { status: 'completed', message: decision.message, history, events };
      }

      if (maxToolCalls !== undefined && executedToolCalls >= maxToolCalls) {
        emit({ type: 'step_limit_reached', step });
        return { status: 'step_limit', history, events };
      }

      const advertisedTool = promptTools.find(({ name }) => name === decision.tool);
      if (advertisedTool === undefined) {
        throw new AgentRuntimeError(
          'tool_unavailable',
          `Model requested an unavailable tool: ${decision.tool}`,
        );
      }

      const activeTools = await refreshTools(options, step, 'pre_execute', emit);
      const activeTool = activeTools.find(({ name }) => name === decision.tool);
      if (activeTool === undefined) {
        throw new AgentRuntimeError(
          'tool_unavailable',
          `Tool became unavailable before execution: ${decision.tool}`,
        );
      }
      if (toolFingerprint(advertisedTool) !== toolFingerprint(activeTool)) {
        throw new AgentRuntimeError(
          'tool_changed',
          `Tool definition changed before execution: ${decision.tool}`,
        );
      }
      const staleAfterRefresh = await staleStateResult(
        stateRevision,
        options,
        step,
        history,
        events,
        emit,
      );
      if (staleAfterRefresh !== undefined) return staleAfterRefresh;

      validateToolInput(decision.input, activeTool.inputSchema);
      assertToolInputSize(decision.input);
      const validatedInput = cloneJsonObject(decision.input);
      emit({
        type: 'tool_call_validated',
        step,
        toolName: activeTool.name,
        input: cloneJsonObject(validatedInput),
      });

      const approvalRequest = createApprovalRequest(
        step,
        activeTool,
        validatedInput,
        stateRevision,
      );
      if (!activeTool.annotations.readOnlyHint) {
        emit({ type: 'approval_required', step, toolName: activeTool.name });
        if (options.approve === undefined) {
          return {
            status: 'approval_required',
            pendingApproval: approvalRequest,
            history,
            events,
          };
        }
        const approved = await raceWithAbort(
          Promise.resolve(options.approve(cloneApprovalRequest(approvalRequest))),
          options.signal,
        );
        const staleAfterApproval = await staleStateResult(
          stateRevision,
          options,
          step,
          history,
          events,
          emit,
        );
        if (staleAfterApproval !== undefined) return staleAfterApproval;
        if (!approved) {
          emit({ type: 'denied', step, toolName: activeTool.name });
          return { status: 'denied', deniedCall: approvalRequest, history, events };
        }
      }

      throwIfAborted(options.signal);
      executedToolCalls += 1;
      emit({ type: 'tool_started', step, toolName: activeTool.name });
      throwIfAborted(options.signal);
      let output: JsonValue;
      try {
        const execution = Promise.resolve(activeTool.execute(
          cloneJsonObject(validatedInput),
          {
            signal: options.signal,
            expectedStateRevision: stateRevision,
          },
        ));
        const rawOutput = activeTool.annotations.readOnlyHint
          ? await raceWithAbort(execution, options.signal)
          : await execution;
        output = normalizeToolOutput(rawOutput);
      } catch (error) {
        if (isCancellation(error) && activeTool.annotations.readOnlyHint) throw error;
        const message = normalizeToolError(error);
        history.push({
          step,
          tool: activeTool.name,
          input: validatedInput,
          ok: false,
          error: message,
        });
        emit({ type: 'tool_failed', step, toolName: activeTool.name, error: message });
        if (!activeTool.annotations.readOnlyHint) {
          return {
            status: 'write_failed',
            failedCall: approvalRequest,
            error: message,
            history,
            events,
          };
        }
        continue;
      }

      if (activeTool.annotations.readOnlyHint) {
        const staleAfterRead = await staleStateResult(
          stateRevision,
          options,
          step,
          history,
          events,
          emit,
        );
        if (staleAfterRead !== undefined) return staleAfterRead;
      }
      history.push({
        step,
        tool: activeTool.name,
        input: validatedInput,
        ok: true,
        output,
      });
      emit({ type: 'tool_succeeded', step, toolName: activeTool.name });
      if (options.signal?.aborted) {
        emit({ type: 'cancelled', step });
        return { status: 'cancelled', history, events };
      }
    }
  } catch (error) {
    if (isCancellation(error)) {
      emit({ type: 'cancelled', step: currentStep });
      return { status: 'cancelled', history, events };
    }
    throw error;
  }

  emit({ type: 'step_limit_reached', step: maxSteps });
  return { status: 'step_limit', history, events };
}

async function refreshTools(
  options: AgentRunOptions,
  step: number,
  phase: ToolRefreshPhase,
  emit: (event: AgentEvent) => void,
): Promise<RuntimeTool[]> {
  const provided = await raceWithAbort(
    Promise.resolve(options.toolProvider.getTools({ signal: options.signal })),
    options.signal,
  );
  if (!Array.isArray(provided)) {
    throw new AgentRuntimeError('invalid_tool', 'Tool provider must return an array.');
  }
  const tools = snapshotToolRegistry(provided);
  emit({ type: 'tools_refreshed', step, phase, toolNames: tools.map(({ name }) => name) });
  throwIfAborted(options.signal);
  return tools;
}

async function readStateRevision(
  options: AgentRunOptions,
): Promise<RuntimeStateRevision | undefined> {
  if (options.getStateRevision === undefined) return undefined;
  const revision = await raceWithAbort(
    Promise.resolve(options.getStateRevision()),
    options.signal,
  );
  if (typeof revision === 'string' && revision.length > RUNTIME_LIMITS.stateRevisionCharacters) {
    throw new AgentRuntimeError('resource_limit', 'State revision exceeded the runtime size limit.');
  }
  if ((typeof revision === 'string' && revision.length > 0)
    || (typeof revision === 'number' && Number.isFinite(revision))) {
    return revision;
  }
  throw configurationError('State revision must be a non-empty string or finite number.');
}

async function staleStateResult(
  expected: RuntimeStateRevision | undefined,
  options: AgentRunOptions,
  step: number,
  history: AgentToolResult[],
  events: AgentEvent[],
  emit: (event: AgentEvent) => void,
): Promise<AgentRunResult | undefined> {
  if (expected === undefined) return undefined;
  const current = await readStateRevision(options);
  if (current === expected) return undefined;
  if (current === undefined) throw configurationError('State revision provider disappeared during a run.');
  emit({ type: 'stale_state', step, expected, current });
  return {
    status: 'stale_state',
    expectedRevision: expected,
    currentRevision: current,
    history,
    events,
  };
}

function createApprovalRequest(
  step: number,
  tool: RuntimeTool,
  input: JsonObject,
  stateRevision: RuntimeStateRevision | undefined,
): AgentApprovalRequest {
  return {
    step,
    tool: describeTool(tool),
    input: cloneJsonObject(input),
    ...(stateRevision === undefined ? {} : { stateRevision }),
  };
}

function cloneApprovalRequest(request: AgentApprovalRequest): AgentApprovalRequest {
  return {
    step: request.step,
    tool: {
      ...request.tool,
      inputSchema: cloneJsonObject(request.tool.inputSchema),
      annotations: { ...request.tool.annotations },
    },
    input: cloneJsonObject(request.input),
    ...(request.stateRevision === undefined ? {} : { stateRevision: request.stateRevision }),
  };
}

function cloneEvent(event: AgentEvent): AgentEvent {
  return cloneJsonValue(event as unknown as JsonValue) as unknown as AgentEvent;
}

function assertToolInputSize(input: JsonObject): void {
  if (JSON.stringify(input).length > RUNTIME_LIMITS.toolInputCharacters) {
    throw new AgentRuntimeError('resource_limit', 'Tool input exceeded the runtime size limit.');
  }
}

function normalizeMaxSteps(value: number | undefined): number {
  const maxSteps = value ?? DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_ALLOWED_STEPS) {
    throw configurationError(`maxSteps must be an integer between 1 and ${MAX_ALLOWED_STEPS}.`);
  }
  return maxSteps;
}

function normalizeMaxToolCalls(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > MAX_ALLOWED_STEPS) {
    throw configurationError(`maxToolCalls must be an integer between 0 and ${MAX_ALLOWED_STEPS}.`);
  }
  return value;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AgentRuntimeError('cancelled', 'Agent run was cancelled.');
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(new AgentRuntimeError('cancelled', 'Agent run was cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new AgentRuntimeError('cancelled', 'Agent run was cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function isCancellation(error: unknown): boolean {
  return error instanceof AgentRuntimeError && error.code === 'cancelled';
}

function configurationError(message: string): AgentRuntimeError {
  return new AgentRuntimeError('invalid_configuration', message);
}
