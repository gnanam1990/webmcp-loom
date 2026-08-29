import { describe, expect, it } from 'vitest';
import { TravelDomainError, createTripStore } from './state.js';
import { createTravelTools } from './tools.js';
import type { JsonObject, RuntimeTool, RuntimeToolExecuteContext } from './runtime-contract.js';
import type { TripStore } from './state.js';

/**
 * Mirrors the runtime's bounded JSON Schema subset. The travel package cannot
 * import the runtime validator before that package is built, so this guards
 * against a schema keyword the runtime would reject at registration time.
 * Day 3 integration replaces this with the real `assertValidToolSchema`.
 */
const SUPPORTED_SCHEMA_KEYS = new Set([
  '$id', '$schema', 'additionalProperties', 'const', 'default', 'deprecated',
  'description', 'enum', 'examples', 'exclusiveMaximum', 'exclusiveMinimum',
  'items', 'maxItems', 'maxLength', 'maximum', 'minItems', 'minLength',
  'minimum', 'properties', 'readOnly', 'required', 'title', 'type',
  'writeOnly',
]);

const FORBIDDEN_CAPABILITY = /\b(book|booking|pay|payment|purchase|checkout|credential|password|delete account|refund)\b/i;

function context(expectedStateRevision?: number): RuntimeToolExecuteContext {
  return { signal: undefined, expectedStateRevision };
}

function toolsFor(store: TripStore): Map<string, RuntimeTool> {
  return new Map(createTravelTools(store).map((tool) => [tool.name, tool]));
}

function call(tool: RuntimeTool | undefined, input: JsonObject, revision?: number): JsonObject {
  if (tool === undefined) throw new Error('Tool is not registered.');
  return tool.execute(input, context(revision)) as JsonObject;
}

function collectSchemaKeys(schema: unknown, found: Set<string>): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return;
  for (const [key, value] of Object.entries(schema)) {
    found.add(key);
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const child of Object.values(value)) collectSchemaKeys(child, found);
    } else if (key === 'items') {
      collectSchemaKeys(value, found);
    }
  }
}

describe('travel tool surface', () => {
  it('exposes 10 uniquely named tools inside the 8-12 planned range', () => {
    const tools = createTravelTools(createTripStore());
    expect(tools).toHaveLength(10);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(10);
  });

  it('marks exactly the seven read tools read-only and the three write tools not', () => {
    const tools = createTravelTools(createTripStore());
    const readOnly = tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name);
    const writes = tools.filter((tool) => !tool.annotations.readOnlyHint).map((tool) => tool.name);
    expect(readOnly.sort()).toEqual([
      'get_budget_summary',
      'get_itinerary',
      'get_trip_constraints',
      'list_destinations',
      'search_activities',
      'search_flights',
      'search_stays',
    ]);
    expect(writes.sort()).toEqual([
      'add_itinerary_item',
      'move_itinerary_item',
      'remove_itinerary_item',
    ]);
  });

  it('exposes no booking, payment, credential or account-deletion capability', () => {
    for (const tool of createTravelTools(createTripStore())) {
      expect(tool.name).not.toMatch(FORBIDDEN_CAPABILITY);
      expect(tool.title).not.toMatch(FORBIDDEN_CAPABILITY);
    }
  });

  it('uses only JSON Schema keywords the runtime supports', () => {
    for (const tool of createTravelTools(createTripStore())) {
      const found = new Set<string>();
      collectSchemaKeys(tool.inputSchema, found);
      for (const key of found) {
        expect(SUPPORTED_SCHEMA_KEYS.has(key), `${tool.name} uses ${key}`).toBe(true);
      }
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('requires an expected revision on every write tool and on no read tool', () => {
    for (const tool of createTravelTools(createTripStore())) {
      const required = tool.inputSchema.required;
      const names = Array.isArray(required) ? required : [];
      expect(names.includes('expectedRevision')).toBe(!tool.annotations.readOnlyHint);
    }
  });
});

describe('read tools', () => {
  it('return the current revision so a later write can present it', () => {
    const store = createTripStore();
    const tools = toolsFor(store);
    for (const name of ['get_trip_constraints', 'get_itinerary', 'get_budget_summary', 'list_destinations']) {
      expect(call(tools.get(name), {}), name).toMatchObject({ revision: 1 });
    }
    store.addItem(1, { kind: 'activity', activityId: 'ac-tok-teamlab', date: '2026-11-06' });
    expect(call(toolsFor(store).get('get_itinerary'), {})).toMatchObject({ revision: 2 });
  });

  it('reports booking as disabled through the constraints tool', () => {
    const result = call(toolsFor(createTripStore()).get('get_trip_constraints'), {});
    expect(result).toMatchObject({
      constraints: { bookingEnabled: false, budgetInr: 150_000, avoidRedEyeFlights: true },
    });
  });

  it('filters red-eye departures out of a flight search', () => {
    const tools = toolsFor(createTripStore());
    const all = call(tools.get('search_flights'), { originCode: 'BLR' });
    const dayOnly = call(tools.get('search_flights'), { originCode: 'BLR', excludeRedEye: true });
    expect((all.flights as unknown[]).length).toBe(3);
    expect((dayOnly.flights as unknown[]).length).toBe(2);
    for (const flight of dayOnly.flights as { redEye: boolean }[]) {
      expect(flight.redEye).toBe(false);
    }
  });

  it('applies price and city filters to stays', () => {
    const tools = toolsFor(createTripStore());
    const stays = call(tools.get('search_stays'), { cityId: 'kyoto', maxPricePerNightInr: 6_000 });
    const ids = (stays.stays as { id: string }[]).map((stay) => stay.id);
    expect(ids).toEqual(['st-kyo-budget', 'st-kyo-mid']);
  });

  it('applies tag and price filters to activities', () => {
    const tools = toolsFor(createTripStore());
    const food = call(tools.get('search_activities'), { cityId: 'kyoto', tag: 'food' });
    expect((food.activities as { id: string }[]).map((entry) => entry.id)).toEqual(['ac-kyo-nishiki']);
    const free = call(tools.get('search_activities'), { cityId: 'kyoto', maxPriceInr: 0 });
    expect((free.activities as { id: string }[]).map((entry) => entry.id)).toEqual(['ac-kyo-fushimi']);
  });

  it('returns an empty result rather than failing when nothing matches', () => {
    const tools = toolsFor(createTripStore());
    expect(call(tools.get('search_stays'), { cityId: 'nara' }).stays).toEqual([]);
  });
});

describe('write tools', () => {
  it('stages an item and reports the new revision and budget together', () => {
    const store = createTripStore();
    const result = call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1,
      kind: 'flight',
      refId: 'fl-blr-nrt-day',
      date: '2026-11-05',
    }, 1);
    expect(result).toMatchObject({
      revision: 2,
      staged: { kind: 'flight', priceInr: 38_500, date: '2026-11-05' },
      budget: { committedInr: 38_500, overBudget: false },
    });
  });

  it('reuses an identifier returned by an earlier read', () => {
    const store = createTripStore();
    const staged = call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'activity', refId: 'ac-kyo-tea', date: '2026-11-10',
    }, 1);
    const itemId = (staged.staged as { id: string }).id;
    const listed = call(toolsFor(store).get('get_itinerary'), {});
    expect((listed.items as { id: string }[])[0]?.id).toBe(itemId);

    const moved = call(toolsFor(store).get('move_itinerary_item'), {
      expectedRevision: 2, itemId, toDate: '2026-11-11',
    }, 2);
    expect(moved).toMatchObject({ revision: 3, moved: { id: itemId, date: '2026-11-11' } });
  });

  it('removes a staged item and refunds it in the budget', () => {
    const store = createTripStore();
    const staged = call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'stay', refId: 'st-tok-mid', date: '2026-11-05', nights: 3,
    }, 1);
    const itemId = (staged.staged as { id: string }).id;
    const removed = call(toolsFor(store).get('remove_itinerary_item'), {
      expectedRevision: 2, itemId,
    }, 2);
    expect(removed).toMatchObject({ revision: 3, budget: { committedInr: 0 } });
  });

  it('rejects a write whose declared revision is stale after a human edit', () => {
    const store = createTripStore();
    store.editAsHuman((items) => items);
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'flight', refId: 'fl-blr-nrt-day', date: '2026-11-05',
    }, 1)).toThrow(/Itinerary changed since this plan was made/);
  });

  it('rejects a write whose declared revision disagrees with the captured revision', () => {
    const store = createTripStore();
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'flight', refId: 'fl-blr-nrt-day', date: '2026-11-05',
    }, 2)).toThrow(/planned against revision 2/);
    expect(store.getState().revision).toBe(1);
  });

  it('rejects a missing or non-integer expected revision', () => {
    const store = createTripStore();
    for (const expectedRevision of [undefined, 'one', 1.5]) {
      const input: JsonObject = { kind: 'flight', refId: 'fl-blr-nrt-day', date: '2026-11-05' };
      if (expectedRevision !== undefined) input.expectedRevision = expectedRevision as never;
      expect(() => call(toolsFor(store).get('add_itinerary_item'), input))
        .toThrow(/expectedRevision (?:is required|must be integer)/);
    }
  });

  it('requires a night count when staging a stay', () => {
    const store = createTripStore();
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'stay', refId: 'st-tok-mid', date: '2026-11-05',
    }, 1)).toThrow(/nights is required when staging a stay/);
  });
});

describe('untrusted input reaching the executor directly', () => {
  it('rejects an unknown kind instead of treating it as a stay', () => {
    const store = createTripStore();
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'hotel', refId: 'st-tok-mid', date: '2026-11-05', nights: 2,
    }, 1)).toThrow(/kind must match an allowed value/);
    expect(store.getState().items).toEqual([]);
  });

  it('rejects a non-numeric captured revision rather than skipping the check', () => {
    const store = createTripStore();
    const tool = toolsFor(store).get('add_itinerary_item');
    if (tool === undefined) throw new Error('Tool is not registered.');
    expect(() => tool.execute(
      { expectedRevision: 1, kind: 'flight', refId: 'fl-blr-nrt-day', date: '2026-11-05' },
      { signal: undefined, expectedStateRevision: 'rev-1' },
    )).toThrow(/numeric state revisions/);
    expect(store.getState().items).toEqual([]);
  });

  it('rejects a flight staged off its timetable date through the tool layer', () => {
    const store = createTripStore();
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'flight', refId: 'fl-nrt-blr-day', date: '2026-11-05',
    }, 1)).toThrow(/departs on 2026-11-14/);
  });

  it('rejects a red-eye flight through the tool layer', () => {
    const store = createTripStore();
    expect(() => call(toolsFor(store).get('add_itinerary_item'), {
      expectedRevision: 1, kind: 'flight', refId: 'fl-blr-nrt-redeye', date: '2026-11-05',
    }, 1)).toThrow(/red-eye departure/);
  });

  it('rejects wrong-typed optional filters instead of silently dropping them', () => {
    const tools = toolsFor(createTripStore());
    const cases: Array<[string, JsonObject]> = [
      ['search_flights', { originCode: 123 } as unknown as JsonObject],
      ['search_flights', { maxPriceInr: '40000' } as unknown as JsonObject],
      ['search_flights', { excludeRedEye: 'yes' } as unknown as JsonObject],
      ['search_stays', { cityId: 'kyoto', maxPricePerNightInr: false } as unknown as JsonObject],
      ['search_activities', { cityId: 'kyoto', tag: 1 } as unknown as JsonObject],
    ];
    for (const [name, input] of cases) {
      expect(() => call(tools.get(name), input), name).toThrow(TravelDomainError);
    }
  });

  it('enforces enum, numeric-bound and additional-property schema rules', () => {
    const tools = toolsFor(createTripStore());
    expect(() => call(tools.get('search_stays'), { cityId: 'moon' }))
      .toThrow(/must match an allowed value/);
    expect(() => call(tools.get('search_flights'), { maxPriceInr: -1 }))
      .toThrow(/must be at least 0/);
    expect(() => call(tools.get('search_flights'), { maxPriceInr: 1.5 }))
      .toThrow(/must be integer/);
    expect(() => call(tools.get('search_flights'), { surprise: true }))
      .toThrow(/surprise is not allowed/);
  });
});
