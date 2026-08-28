import { AgentRuntimeError } from './errors.js';
import type { JsonObject, JsonValue } from './types.js';

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function isJsonCompatible(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;
  if (!Array.isArray(value) && !isPlainRecord(value)) return false;

  ancestors.add(value);
  try {
    const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
    return children.every((child) => isJsonCompatible(child, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

export function cloneJsonValue(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function cloneJsonObject(value: JsonObject | Record<string, unknown>): JsonObject {
  if (!isJsonCompatible(value) || !isPlainRecord(value)) {
    throw new AgentRuntimeError('invalid_tool_input', 'Expected a JSON-compatible object.');
  }
  return cloneJsonValue(value) as JsonObject;
}

export function jsonEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length
      && left.every((entry, index) => jsonEquals(entry, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index] && jsonEquals(left[key], right[key])
      ));
  }
  return false;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
