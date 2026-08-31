/**
 * Ambient declaration for the runtime package.
 *
 * The UI needs the runtime's *values* (`runAgentRuntime`,
 * `createStaticToolProvider`), not just its types, so the structural mirror in
 * `runtime-contract.ts` is not enough on its own. The runtime package
 * typechecks with `noEmit` and publishes no declarations until its build step,
 * while `npm run verify` typechecks before it builds, so a plain import cannot
 * resolve types on a clean checkout.
 *
 * Declaring the module here lets TypeScript resolve the imports while Vite and
 * Node resolve the real `dist/index.js` at build and run time. The shapes below
 * are the subset of the public API this application uses.
 *
 * Keep in sync with `packages/runtime/src/types.ts`. Day 3 integration should
 * replace both this file and `runtime-contract.ts` with the real import once the
 * runtime emits declarations.
 */

declare module '@webmcp-loom/runtime' {
  import type {
    JsonObject,
    JsonSchema,
    RuntimeStateRevision,
    RuntimeTool,
    RuntimeToolDescriptor,
  } from './runtime-contract.js';

  export type { JsonObject, JsonSchema, RuntimeStateRevision, RuntimeTool };

  export interface RuntimeModelRequest {
    prompt: string;
    responseSchema: JsonSchema;
    signal: AbortSignal | undefined;
  }

  export interface RuntimeModel {
    generate(request: RuntimeModelRequest): Promise<string>;
  }

  export interface RuntimeToolProvider {
    getTools(context: { signal: AbortSignal | undefined }):
      | Promise<readonly RuntimeTool[]>
      | readonly RuntimeTool[];
  }

  export interface AgentToolResult {
    step: number;
    tool: string;
    input: JsonObject;
    ok: boolean;
    output?: unknown;
    error?: string;
  }

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
    | {
      type: 'stale_state';
      step: number;
      expected: RuntimeStateRevision;
      current: RuntimeStateRevision;
    }
    | { type: 'step_limit_reached'; step: number }
    | { type: 'tool_call_validated'; step: number; toolName: string; input: JsonObject }
    | { type: 'tool_failed'; step: number; toolName: string; error: string }
    | { type: 'tool_started'; step: number; toolName: string }
    | { type: 'tool_succeeded'; step: number; toolName: string }
    | {
      type: 'tools_refreshed';
      step: number;
      phase: ToolRefreshPhase;
      toolNames: string[];
    };

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
    onEvent?: (event: AgentEvent) => Promise<void> | void;
    signal?: AbortSignal;
  }

  export function runAgentRuntime(options: AgentRunOptions): Promise<AgentRunResult>;
  export function createStaticToolProvider(tools: readonly RuntimeTool[]): RuntimeToolProvider;
}
