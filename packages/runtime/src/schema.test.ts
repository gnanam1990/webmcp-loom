import { describe, expect, it } from 'vitest';
import { createStaticToolProvider, snapshotToolRegistry } from './registry.js';
import { assertValidToolSchema, validateToolInput } from './schema.js';
import type { RuntimeTool } from './types.js';

function validTool(name = 'inspect'): RuntimeTool {
  return {
    name,
    title: 'Inspect',
    description: 'Inspect a fixture.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 3 },
        label: { type: 'string', minLength: 2, maxLength: 4 },
        tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
      },
      required: ['count', 'label', 'tags'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => null,
  };
}

describe('tool schema validation', () => {
  it('validates the supported bounded JSON Schema subset', () => {
    expect(() => validateToolInput(
      { count: 2, label: 'abc', tags: ['a'] },
      validTool().inputSchema,
    )).not.toThrow();
    expect(() => validateToolInput(
      { count: 0, label: 'abc', tags: ['a'] },
      validTool().inputSchema,
    )).toThrow(/at least 1/);
    expect(() => validateToolInput(
      { count: 2, label: 'a', tags: ['a'] },
      validTool().inputSchema,
    )).toThrow(/at least 2 characters/);
    expect(() => validateToolInput(
      { count: 2, label: 'abc', tags: [] },
      validTool().inputSchema,
    )).toThrow(/at least 1 items/);
    expect(() => validateToolInput(
      { count: 2, label: 'abc', tags: ['a'], unexpected: true },
      validTool().inputSchema,
    )).toThrow(/not allowed/);
  });

  it('fails closed for unsupported or malformed schema definitions', () => {
    expect(() => assertValidToolSchema({ oneOf: [] })).toThrow(/unsupported JSON Schema keyword/);
    expect(() => assertValidToolSchema({ required: ['id', 'id'] })).toThrow(/invalid required/);
    expect(() => assertValidToolSchema({ minLength: -1 })).toThrow(/non-negative integer/);
    expect(() => assertValidToolSchema({ type: ['string', 'null'] })).toThrow(/unsupported JSON Schema type/);
  });

  it('handles own properties named constructor without prototype lookups', () => {
    const input = JSON.parse('{"constructor":"safe"}') as Record<string, string>;
    expect(() => validateToolInput(input, {
      type: 'object',
      properties: { constructor: { type: 'string', const: 'safe' } },
      required: ['constructor'],
      additionalProperties: false,
    })).not.toThrow();
  });
});

describe('tool registry', () => {
  it('rejects duplicate, malformed and oversized registries', () => {
    expect(() => snapshotToolRegistry([validTool(), validTool()])).toThrow(/Duplicate/);
    expect(() => snapshotToolRegistry([validTool(' bad')])).toThrow(/whitespace/);
    expect(() => snapshotToolRegistry(Array.from(
      { length: 65 },
      (_, index) => validTool(`tool_${index}`),
    ))).toThrow(/64-tool limit/);
  });

  it('snapshots metadata while preserving a bound executor', async () => {
    const source = validTool();
    source.execute = function execute() {
      return this.name;
    };
    const provider = createStaticToolProvider([source]);
    source.title = 'Mutated later';
    source.inputSchema.type = 'string';
    const current = await provider.getTools({ signal: undefined });
    expect(current[0]?.title).toBe('Inspect');
    expect(await current[0]?.execute({}, {
      signal: undefined,
      expectedStateRevision: undefined,
    })).toBe('inspect');
  });
});
