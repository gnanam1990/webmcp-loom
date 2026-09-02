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
  tool('move_itinerary_item', 'Move an existing itinerary item.', false, ['expectedRevision', 'itemId']),
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

  it('returns no tools for a read-only request on a write-only surface', () => {
    const selected = createDeterministicToolSelector({ maxTools: 4 })({
      goal: 'Show the current state but do not change anything.',
      history: history({ revision: 1, items: [{ id: 'item-1' }] }, 'get_itinerary'),
      stateRevision: 1,
      step: 1,
      tools: tools.slice(2),
    });

    expect(selected).toEqual([]);
  });

  it('does not restore reference-bearing writes when successful evidence is absent', () => {
    const selected = createDeterministicToolSelector({ maxTools: 4 })({
      goal: 'Remove the existing itinerary item.',
      history: [],
      stateRevision: 1,
      step: 1,
      tools: tools.slice(2),
    });

    expect(selected).toEqual([]);
  });

  it('preserves an affirmative mutation whose negative clause protects everything else', () => {
    const selected = createDeterministicToolSelector({ maxTools: 4 })({
      goal: 'Remove the existing itinerary item without changing anything else.',
      history: history({ revision: 3, items: [{ id: 'item-1' }] }, 'get_itinerary'),
      stateRevision: 3,
      step: 2,
      tools,
    });

    expect(selected).toContain('remove_itinerary_item');
  });

  it.each([
    ['Please remove the item without changing anything else.', 'remove_itinerary_item'],
    ['Please just remove the item without changing anything else.', 'remove_itinerary_item'],
    ['Could you delete the item without changing anything else?', 'remove_itinerary_item'],
    ['Would you please delete the item without changing anything else?', 'remove_itinerary_item'],
    ['I need you to drop the item without changing anything else.', 'remove_itinerary_item'],
    ['Please reschedule the item without changing anything else.', 'move_itinerary_item'],
    ['Could you shift the item without changing anything else?', 'move_itinerary_item'],
    ['Do not remove anything, but remove the existing item.', 'remove_itinerary_item'],
    ['Remove the no-show stay without changing anything else.', 'remove_itinerary_item'],
  ])('recognizes polite and synonym mutation clauses in %s', (goal, expected) => {
    const selected = createDeterministicToolSelector({
      maxTools: 4,
      synonymGroups: [
        ['move', 'reschedule', 'shift'],
        ['remove', 'delete', 'drop'],
      ],
    })({
      goal,
      history: history({ revision: 3, items: [{ id: 'item-1' }] }, 'get_itinerary'),
      stateRevision: 3,
      step: 2,
      tools,
    });

    expect(selected).toContain(expected);
  });

  it.each([
    ['Update nothing; just read the itinerary without changing anything.'],
    ['Update nothing; just read the itinerary.'],
    ['Do not change anything. Just show me the plan and then move on to the next step.'],
    ['Do not change anything. Just show me the plan and then shift to the next step.'],
    ['Do not change anything, but remove is unnecessary.'],
    ['Please do not remove anything; just read the itinerary.'],
  ])('does not treat negated writes or move-on idioms as affirmative in %s', (goal) => {
    const selected = createDeterministicToolSelector({ maxTools: 5 })({
      goal,
      history: history({ revision: 3, items: [{ id: 'item-1' }] }, 'get_itinerary'),
      stateRevision: 3,
      step: 2,
      tools,
    });

    expect(selected).toEqual(['get_itinerary', 'search_stays']);
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
