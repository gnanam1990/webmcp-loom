import { describe, expect, it } from 'vitest';

import { createDeterministicToolSelector, rankRuntimeTools } from './retrieval.js';
import type { AgentToolResult, JsonValue, RuntimeTool } from '@webmcp-loom/runtime';

function tool(
  name: string,
  description: string,
  readOnlyHint: boolean,
  required: readonly string[] = [],
): RuntimeTool {
  return {
    name,
    title: name.replaceAll('_', ' '),
    description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(required.map((field) => [field, { type: 'string' }])),
      required: [...required],
      additionalProperties: false,
    },
    annotations: { readOnlyHint },
    execute: () => null,
  };
}

const tools = [
  tool('search_stays', 'Find hotel accommodation in one city.', true),
  tool('get_itinerary', 'Read staged trip items.', true),
  tool('add_itinerary_item', 'Stage a stay from a search result.', false, ['expectedRevision', 'refId']),
  tool('remove_itinerary_item', 'Remove an existing itinerary item.', false, ['expectedRevision', 'itemId']),
] as const;

function history(output: JsonValue, toolName = 'search_stays'): AgentToolResult[] {
  return [{ step: 1, tool: toolName, input: {}, ok: true, output }];
}

describe('deterministic tool retrieval', () => {
  it('ranks matching reads and withholds reference-bearing writes before evidence exists', () => {
    const select = createDeterministicToolSelector({
      maxTools: 3,
      synonymGroups: [['stay', 'hotel', 'accommodation']],
    });

    expect(select({
      goal: 'Find a hotel, then stage the best stay.',
      history: [],
      stateRevision: 1,
      step: 1,
      tools,
    })).toEqual(['search_stays', 'get_itinerary']);
  });

  it('admits a relevant write only after a successful result supplies an id and revision', () => {
    const selected = createDeterministicToolSelector({ maxTools: 3 })({
      goal: 'Find a stay and stage it.',
      history: history({ revision: 1, stays: [{ id: 'stay-1' }] }),
      stateRevision: 1,
      step: 2,
      tools,
    });

    expect(selected).toContain('add_itinerary_item');
    expect(selected[0]).toBe('search_stays');
  });

  it('keeps every write out of an explicitly read-only goal', () => {
    const selected = createDeterministicToolSelector({ maxTools: 4 })({
      goal: 'Show me stays but do not change anything.',
      history: history({ revision: 1, stays: [{ id: 'stay-1' }] }),
      stateRevision: 1,
      step: 2,
      tools,
    });

    expect(selected).toEqual(['search_stays', 'get_itinerary']);
  });

  it('does not treat failed output as identifier evidence', () => {
    const selected = createDeterministicToolSelector({ maxTools: 4 })({
      goal: 'Stage a stay.',
      history: [{
        step: 1,
        tool: 'search_stays',
        input: {},
        ok: false,
        error: 'failed with refId stay-1 at revision 1',
      }],
      stateRevision: 1,
      step: 2,
      tools,
    });

    expect(selected).not.toContain('add_itinerary_item');
  });

  it('is stable across ties and validates its configured cap', () => {
    expect(rankRuntimeTools({
      goal: 'Unrelated request.',
      history: [],
      stateRevision: undefined,
      step: 1,
      tools: tools.slice(0, 2),
    }).map(({ name }) => name)).toEqual(['search_stays', 'get_itinerary']);
    expect(() => createDeterministicToolSelector({ maxTools: 0 })).toThrow('1 to 20');
  });
});
