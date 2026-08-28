import {
  hasUnsafeJsonSerializationHook,
  isPlainRecord,
} from './json.js';
import type { JsonValue } from './types.js';

const MAX_OUTPUT_SERIALIZATION_DEPTH = 64;

export const RUNTIME_LIMITS = Object.freeze({
  goalCharacters: 4_000,
  modelDecisionCharacters: 50_000,
  promptHistoryCharacters: 8_000,
  promptHistoryEntryCharacters: 2_000,
  stateRevisionCharacters: 256,
  storedErrorCharacters: 4_000,
  storedToolResultCharacters: 4_000,
  toolInputCharacters: 4_000,
});

export function normalizeToolOutput(value: unknown): JsonValue {
  try {
    const serialization = serializeJsonBounded(
      value,
      RUNTIME_LIMITS.storedToolResultCharacters,
    );
    if (serialization === null) return unavailableToolOutput();
    if (!serialization.truncated) return JSON.parse(serialization.serialized) as JsonValue;
    return fitPreviewEnvelope(
      { truncated: true },
      serialization.serialized,
      RUNTIME_LIMITS.storedToolResultCharacters,
    );
  } catch {
    return unavailableToolOutput();
  }
}

function serializeJsonBounded(
  value: unknown,
  maxCharacters: number,
): { serialized: string; truncated: boolean } | null {
  let serialized = '';
  let truncated = false;
  let invalid = false;
  const ancestors = new Set<object>();

  const append = (text: string): boolean => {
    const remaining = maxCharacters - serialized.length;
    if (text.length <= remaining) {
      serialized += text;
      return true;
    }
    if (remaining > 0) serialized += text.slice(0, remaining);
    truncated = true;
    return false;
  };

  const appendString = (text: string): boolean => {
    if (!append('"')) return false;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      let escaped: string;
      if (code === 0x22) escaped = '\\"';
      else if (code === 0x5c) escaped = '\\\\';
      else if (code === 0x08) escaped = '\\b';
      else if (code === 0x0c) escaped = '\\f';
      else if (code === 0x0a) escaped = '\\n';
      else if (code === 0x0d) escaped = '\\r';
      else if (code === 0x09) escaped = '\\t';
      else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff)) {
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
          const next = text.charCodeAt(index + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            escaped = text.slice(index, index + 2);
            index += 1;
          } else {
            escaped = `\\u${code.toString(16).padStart(4, '0')}`;
          }
        } else {
          escaped = `\\u${code.toString(16).padStart(4, '0')}`;
        }
      } else escaped = text[index] ?? '';
      if (!append(escaped)) return false;
    }
    return append('"');
  };

  const visit = (candidate: unknown, depth: number): void => {
    if (truncated || invalid) return;
    if (candidate === null) {
      append('null');
      return;
    }
    if (typeof candidate === 'string') {
      appendString(candidate);
      return;
    }
    if (typeof candidate === 'boolean') {
      append(candidate ? 'true' : 'false');
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) invalid = true;
      else append(JSON.stringify(candidate));
      return;
    }
    if (typeof candidate !== 'object' || depth > MAX_OUTPUT_SERIALIZATION_DEPTH) {
      invalid = true;
      return;
    }
    if (ancestors.has(candidate)) {
      invalid = true;
      return;
    }
    if (!Array.isArray(candidate) && !isPlainRecord(candidate)) {
      invalid = true;
      return;
    }
    if (hasUnsafeJsonSerializationHook(candidate)) {
      invalid = true;
      return;
    }
    const prototype = Object.getPrototypeOf(candidate) as object | null;
    if (prototype !== null) {
      for (const inheritedKey in prototype) {
        void inheritedKey;
        invalid = true;
        return;
      }
    }

    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        if (!append('[')) return;
        for (let index = 0; index < candidate.length; index += 1) {
          if (!Object.hasOwn(candidate, index)) {
            invalid = true;
            return;
          }
          if (index > 0 && !append(',')) return;
          const descriptor = Object.getOwnPropertyDescriptor(candidate, index);
          if (descriptor === undefined || !('value' in descriptor)) {
            invalid = true;
            return;
          }
          visit(descriptor.value, depth + 1);
          if (truncated || invalid) return;
        }
        let expectedKey = 0;
        for (const key in candidate) {
          if (!Object.hasOwn(candidate, key)) continue;
          if (key !== String(expectedKey)) {
            invalid = true;
            return;
          }
          expectedKey += 1;
        }
        if (expectedKey !== candidate.length) {
          invalid = true;
          return;
        }
        append(']');
        return;
      }

      if (!append('{')) return;
      let first = true;
      for (const key in candidate) {
        if (!Object.hasOwn(candidate, key)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable) continue;
        if (!('value' in descriptor)) {
          invalid = true;
          return;
        }
        if (!first && !append(',')) return;
        if (!appendString(key) || !append(':')) return;
        visit(descriptor.value, depth + 1);
        if (truncated || invalid) return;
        first = false;
      }
      append('}');
    } finally {
      ancestors.delete(candidate);
    }
  };

  try {
    visit(value, 0);
  } catch {
    return null;
  }
  if (invalid) return null;
  return { serialized, truncated };
}

export function normalizeToolError(error: unknown): string {
  let message = 'Tool execution failed.';
  try {
    if (error instanceof Error && typeof error.message === 'string' && error.message) {
      message = error.message;
    } else if (typeof error === 'string' && error) {
      message = error;
    }
  } catch {
    // Preserve the safe fallback for errors with hostile accessors.
  }
  if (message.length <= RUNTIME_LIMITS.storedErrorCharacters) return message;
  return `${message.slice(0, RUNTIME_LIMITS.storedErrorCharacters - 1)}…`;
}

export function fitPreviewEnvelope(
  base: Record<string, JsonValue>,
  serialized: string,
  maxCharacters: number,
): JsonValue {
  let preview = serialized.slice(0, maxCharacters);
  let envelope: Record<string, JsonValue> = { ...base, preview: `${preview}…` };
  while (JSON.stringify(envelope).length > maxCharacters && preview.length > 0) {
    const excess = JSON.stringify(envelope).length - maxCharacters;
    preview = preview.slice(0, Math.max(0, preview.length - excess));
    envelope = { ...base, preview: `${preview}…` };
  }
  return envelope;
}

function unavailableToolOutput(): JsonValue {
  return {
    unavailable: true,
    reason: 'Tool output was not JSON-compatible.',
  };
}
