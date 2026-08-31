import type { JsonObject } from '@webmcp-loom/runtime';

export function readString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' ? value : undefined;
}

export function readBoolean(input: JsonObject, key: string): boolean | undefined {
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}
