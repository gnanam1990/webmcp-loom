import { isJsonCompatible } from './json.js';
import type { JsonValue } from './types.js';

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
    if (!isJsonCompatible(value)) return unavailableToolOutput();
    const serialized = JSON.stringify(value);
    if (serialized.length <= RUNTIME_LIMITS.storedToolResultCharacters) {
      return JSON.parse(serialized) as JsonValue;
    }
    return fitPreviewEnvelope(
      { truncated: true },
      serialized,
      RUNTIME_LIMITS.storedToolResultCharacters,
    );
  } catch {
    return unavailableToolOutput();
  }
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
