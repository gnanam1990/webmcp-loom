export type AgentRuntimeErrorCode =
  | 'cancelled'
  | 'invalid_configuration'
  | 'invalid_decision'
  | 'invalid_tool'
  | 'invalid_tool_input'
  | 'resource_limit'
  | 'tool_changed'
  | 'tool_unavailable';

export class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode;

  constructor(code: AgentRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}
