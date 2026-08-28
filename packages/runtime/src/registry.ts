import { AgentRuntimeError } from './errors.js';
import { cloneJsonObject, stableJson } from './json.js';
import { assertValidToolSchema } from './schema.js';
import type {
  RuntimeTool,
  RuntimeToolDescriptor,
  RuntimeToolProvider,
} from './types.js';

const MAX_TOOLS = 64;
const MAX_TOOL_NAME_CHARACTERS = 128;
const MAX_TOOL_TITLE_CHARACTERS = 256;
const MAX_TOOL_DESCRIPTION_CHARACTERS = 2_000;
const MAX_TOOL_SURFACE_CHARACTERS = 64_000;

export function snapshotToolRegistry(tools: readonly RuntimeTool[]): RuntimeTool[] {
  if (tools.length > MAX_TOOLS) {
    throw new AgentRuntimeError('resource_limit', `Tool registry exceeds the ${MAX_TOOLS}-tool limit.`);
  }
  const names = new Set<string>();
  const snapshot: RuntimeTool[] = [];
  let surfaceCharacters = 0;

  for (const candidate of tools) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw invalidTool('Runtime tool entries must be objects.');
    }
    const { name, title, description } = candidate;
    if (typeof name !== 'string' || !name.trim()) throw invalidTool('Runtime tools require a name.');
    if (name !== name.trim()) throw invalidTool(`Tool names cannot have surrounding whitespace: ${name}`);
    if (name.length > MAX_TOOL_NAME_CHARACTERS) throw resourceLimit(`Tool name is too long: ${name}`);
    if (names.has(name)) throw invalidTool(`Duplicate runtime tool: ${name}`);
    if (typeof title !== 'string' || !title.trim()) throw invalidTool(`Tool title is invalid: ${name}`);
    if (title.length > MAX_TOOL_TITLE_CHARACTERS) throw resourceLimit(`Tool title is too long: ${name}`);
    if (typeof description !== 'string' || !description.trim()) {
      throw invalidTool(`Tool description is invalid: ${name}`);
    }
    if (description.length > MAX_TOOL_DESCRIPTION_CHARACTERS) {
      throw resourceLimit(`Tool description is too long: ${name}`);
    }
    if (typeof candidate.inputSchema !== 'object' || candidate.inputSchema === null) {
      throw invalidTool(`Tool input schema is invalid: ${name}`);
    }
    assertValidToolSchema(candidate.inputSchema, `${name}.inputSchema`);
    if (typeof candidate.annotations?.readOnlyHint !== 'boolean') {
      throw invalidTool(`Tool readOnlyHint must be boolean: ${name}`);
    }
    if (candidate.annotations.untrustedContentHint !== undefined
      && typeof candidate.annotations.untrustedContentHint !== 'boolean') {
      throw invalidTool(`Tool untrustedContentHint must be boolean: ${name}`);
    }
    if (candidate.origin !== undefined && (
      typeof candidate.origin !== 'string' || !candidate.origin.trim()
    )) {
      throw invalidTool(`Tool origin is invalid: ${name}`);
    }
    if (typeof candidate.execute !== 'function') {
      throw invalidTool(`Tool executor is invalid: ${name}`);
    }

    const inputSchema = cloneJsonObject(candidate.inputSchema);
    const tool: RuntimeTool = {
      name,
      title,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: candidate.annotations.readOnlyHint,
        ...(candidate.annotations.untrustedContentHint === undefined
          ? {}
          : { untrustedContentHint: candidate.annotations.untrustedContentHint }),
      },
      ...(candidate.origin === undefined ? {} : { origin: candidate.origin }),
      execute: candidate.execute.bind(candidate),
    };
    surfaceCharacters += toolFingerprint(tool).length;
    if (surfaceCharacters > MAX_TOOL_SURFACE_CHARACTERS) {
      throw resourceLimit('Combined tool surface exceeded the runtime size limit.');
    }
    snapshot.push(tool);
    names.add(name);
  }
  return snapshot;
}

export function describeTool(tool: RuntimeTool): RuntimeToolDescriptor {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: cloneJsonObject(tool.inputSchema),
    annotations: { ...tool.annotations },
    ...(tool.origin === undefined ? {} : { origin: tool.origin }),
  };
}

export function toolFingerprint(tool: RuntimeTool | RuntimeToolDescriptor): string {
  return stableJson({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    origin: tool.origin ?? null,
  });
}

export function createStaticToolProvider(tools: readonly RuntimeTool[]): RuntimeToolProvider {
  const stableTools = snapshotToolRegistry(tools);
  return {
    getTools: () => snapshotToolRegistry(stableTools),
  };
}

function invalidTool(message: string): AgentRuntimeError {
  return new AgentRuntimeError('invalid_tool', message);
}

function resourceLimit(message: string): AgentRuntimeError {
  return new AgentRuntimeError('resource_limit', message);
}
