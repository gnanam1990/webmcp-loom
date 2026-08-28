/**
 * Structural mirror of the runtime's tool contract.
 *
 * The travel domain deliberately does not import `@webmcp-loom/runtime` yet.
 * That package typechecks with `noEmit`, so it publishes no declarations before
 * its build step, and `npm run verify` typechecks before it builds. Importing it
 * here would make a clean checkout fail on ordering alone.
 *
 * These declarations are structural, so a tool array built against them is
 * assignable to `RuntimeTool[]` without a cast. Day 3 integration owns wiring
 * the two together and should add a compile-time conformance assertion against
 * the real exported types at that point, which is also what will catch drift if
 * the runtime contract changes.
 *
 * Keep in sync with `packages/runtime/src/types.ts`.
 */

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export type RuntimeStateRevision = number | string;

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
