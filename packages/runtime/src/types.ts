export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export interface RuntimeToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint?: boolean;
}

export interface RuntimeToolExecuteContext {
  signal: AbortSignal | undefined;
  expectedStateRevision: RuntimeStateRevision | undefined;
}

export interface RuntimeTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: RuntimeToolAnnotations;
  origin?: string;
  execute(input: JsonObject, context: RuntimeToolExecuteContext): unknown | Promise<unknown>;
}

export type RuntimeToolDescriptor = Omit<RuntimeTool, 'execute'>;

export interface RuntimeToolProvider {
  getTools(context: { signal: AbortSignal | undefined }):
    | Promise<readonly RuntimeTool[]>
    | readonly RuntimeTool[];
}

export interface RuntimeModelRequest {
  prompt: string;
  responseSchema: JsonSchema;
  signal: AbortSignal | undefined;
}

export interface RuntimeModel {
  generate(request: RuntimeModelRequest): Promise<string>;
}

export type AgentDecision =
  | { type: 'final'; message: string }
  | { type: 'tool_call'; input: JsonObject; tool: string };

export interface AgentToolResult {
  step: number;
  tool: string;
  input: JsonObject;
  ok: boolean;
  output?: JsonValue;
  error?: string;
}

export type RuntimeStateRevision = number | string;

export interface AgentApprovalRequest {
  step: number;
  tool: RuntimeToolDescriptor;
  input: JsonObject;
  stateRevision?: RuntimeStateRevision;
}

export type ToolRefreshPhase = 'pre_execute' | 'prompt';

export type AgentEvent =
  | { type: 'approval_required'; step: number; toolName: string }
  | { type: 'cancelled'; step: number }
  | { type: 'completed'; step: number; message: string }
  | { type: 'denied'; step: number; toolName: string }
  | { type: 'stale_state'; step: number; expected: RuntimeStateRevision; current: RuntimeStateRevision }
  | { type: 'step_limit_reached'; step: number }
  | { type: 'tool_call_validated'; step: number; toolName: string; input: JsonObject }
  | { type: 'tool_failed'; step: number; toolName: string; error: string }
  | { type: 'tool_started'; step: number; toolName: string }
  | { type: 'tool_succeeded'; step: number; toolName: string }
  | { type: 'tools_refreshed'; step: number; phase: ToolRefreshPhase; toolNames: string[] };

interface AgentRunResultBase {
  events: AgentEvent[];
  history: AgentToolResult[];
}

export type AgentRunResult = AgentRunResultBase & (
  | { status: 'approval_required'; pendingApproval: AgentApprovalRequest }
  | { status: 'cancelled' }
  | { status: 'completed'; message: string }
  | { status: 'denied'; deniedCall: AgentApprovalRequest }
  | {
    status: 'stale_state';
    expectedRevision: RuntimeStateRevision;
    currentRevision: RuntimeStateRevision;
  }
  | { status: 'step_limit' }
  | { status: 'write_failed'; failedCall: AgentApprovalRequest; error: string }
);

export interface AgentRunOptions {
  goal: string;
  model: RuntimeModel;
  toolProvider: RuntimeToolProvider;
  approve?: (request: AgentApprovalRequest) => boolean | Promise<boolean>;
  getStateRevision?: () => Promise<RuntimeStateRevision> | RuntimeStateRevision;
  maxSteps?: number;
  /**
   * Strict cap on calls that reach execution. Unlike `maxSteps`, this leaves
   * room for a terminal model decision after the final allowed tool call.
   */
  maxToolCalls?: number;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
  signal?: AbortSignal;
}
