import { AgentRuntimeError } from './errors.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_JSON_COMPATIBILITY_DEPTH = 64;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Object.keys(value);
  return keys.length === value.length
    && keys.every((key, index) => key === String(index));
}

export function hasUnsafeJsonSerializationHook(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'toJSON');
    if (descriptor !== undefined) {
      return !('value' in descriptor) || typeof descriptor.value === 'function';
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return false;
}

export function isJsonCompatible(
  value: unknown,
  ancestors = new Set<object>(),
  depth = 0,
): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (depth > MAX_JSON_COMPATIBILITY_DEPTH) return false;
  if (ancestors.has(value)) return false;
  try {
    if (!Array.isArray(value) && !isPlainRecord(value)) return false;
    if (hasUnsafeJsonSerializationHook(value)) return false;
    if (Array.isArray(value) && !isDenseArray(value)) return false;
  } catch {
    return false;
  }

  ancestors.add(value);
  try {
    const keys = Object.keys(value);
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined
        && 'value' in descriptor
        && isJsonCompatible(descriptor.value, ancestors, depth + 1);
    });
  } catch {
    return false;
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
