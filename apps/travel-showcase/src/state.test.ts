import { describe, expect, it } from 'vitest';
import { HERO_TRIP_CONSTRAINTS } from './inventory.js';
import { TravelDomainError, createTripStore } from './state.js';
import type { ItineraryItem } from './types.js';

function storeWithFlight(): { store: ReturnType<typeof createTripStore>; item: ItineraryItem } {
  const store = createTripStore();
  const item = store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-05' });
  return { store, item };
}

describe('trip store revision contract', () => {
  it('starts at revision 1 with an empty itinerary', () => {
    const state = createTripStore().getState();
    expect(state.revision).toBe(1);
    expect(state.items).toEqual([]);
    expect(state.constraints).toEqual(HERO_TRIP_CONSTRAINTS);
  });

  it('increments the revision once per accepted write', () => {
    const { store } = storeWithFlight();
    expect(store.getState().revision).toBe(2);
    store.addItem(2, { kind: 'activity', activityId: 'ac-kyo-fushimi', date: '2026-11-09' });
    expect(store.getState().revision).toBe(3);
  });

  it('rejects a write that presents a stale revision', () => {
    const { store, item } = storeWithFlight();
    expect(() => store.removeItem(1, item.id)).toThrow(TravelDomainError);
    expect(() => store.removeItem(1, item.id)).toThrow(/current revision 2/);
    expect(store.getState().items).toHaveLength(1);
    expect(store.getState().revision).toBe(2);
  });

  it('rejects a write that presents a revision from the future', () => {
    const store = createTripStore();
    expect(() => store.addItem(9, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-05' }))
      .toThrow(/Expected revision 9, current revision 1/);
  });

  it('rejects a non-integer revision without mutating state', () => {
    const store = createTripStore();
    expect(() => store.addItem(1.5, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-05' }))
      .toThrow(/must be an integer/);
    expect(store.getState().revision).toBe(1);
  });

  it('applies a human edit unconditionally and bumps the revision', () => {
    const { store, item } = storeWithFlight();
    const next = store.editAsHuman((items) => items.filter((entry) => entry.id !== item.id));
    expect(next.revision).toBe(3);
    expect(next.items).toEqual([]);
  });

  it('makes an agent write planned before a human edit stale', () => {
    const { store } = storeWithFlight();
    const plannedAgainst = store.getState().revision;
    store.editAsHuman((items) => items);
    expect(() => store.addItem(plannedAgainst, {
      kind: 'activity',
      activityId: 'ac-tok-teamlab',
      date: '2026-11-06',
    })).toThrow(/Itinerary changed since this plan was made/);
  });
});

describe('trip store validation', () => {
  it('rejects unknown catalogue identifiers', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'nope', date: '2026-11-05' }))
      .toThrow(/No flight with id nope/);
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'nope', date: '2026-11-05', nights: 2 }))
      .toThrow(/No stay with id nope/);
    expect(() => store.addItem(1, { kind: 'activity', activityId: 'nope', date: '2026-11-05' }))
      .toThrow(/No activity with id nope/);
  });

  it('rejects dates outside the trip window and malformed dates', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-04' }))
      .toThrow(/outside the trip window/);
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-15' }))
      .toThrow(/outside the trip window/);
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '5 Nov' }))
      .toThrow(/ISO YYYY-MM-DD/);
  });

  it('rejects impossible calendar days even when they are lexically inside the trip window', () => {
    const store = createTripStore({
      ...HERO_TRIP_CONSTRAINTS,
      startDate: '2026-02-28',
      endDate: '2026-03-02',
      totalDays: 3,
    });
    expect(() => store.addItem(1, {
      kind: 'activity',
      activityId: 'ac-tok-teamlab',
      date: '2026-02-30',
    })).toThrow(/not a real calendar day/);
  });

  it('requires a positive integer night count for stays', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 0 }))
      .toThrow(/at least 1/);
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 2.5 }))
      .toThrow(/at least 1/);
  });

  it('reports an out-of-range stay span as a domain validation error', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, {
      kind: 'stay',
      stayId: 'st-tok-mid',
      date: '2026-11-05',
      nights: Number.MAX_SAFE_INTEGER,
    })).toThrow(TravelDomainError);
  });

  it('rejects a checkout that would require an extended-year date', () => {
    const store = createTripStore({
      ...HERO_TRIP_CONSTRAINTS,
      startDate: '9999-12-31',
      endDate: '9999-12-31',
      totalDays: 1,
    });
    expect(() => store.addItem(1, {
      kind: 'stay',
      stayId: 'st-tok-mid',
      date: '9999-12-31',
      nights: 1,
    })).toThrow(/outside the supported calendar range/);
  });

  it('reports a missing itinerary item rather than silently succeeding', () => {
    const { store } = storeWithFlight();
    expect(() => store.removeItem(2, 'it-999')).toThrow(/No itinerary item with id it-999/);
    expect(() => store.moveItem(2, 'it-999', '2026-11-07')).toThrow(/No itinerary item with id it-999/);
  });

  it('assigns stable sequential item identifiers', () => {
    const store = createTripStore();
    const first = store.addItem(1, { kind: 'activity', activityId: 'ac-tok-teamlab', date: '2026-11-06' });
    const second = store.addItem(2, { kind: 'activity', activityId: 'ac-tok-tsukiji', date: '2026-11-07' });
    expect([first.id, second.id]).toEqual(['it-1', 'it-2']);
  });
});

describe('itinerary mutation', () => {
  it('prices a stay by nights and moves an item without changing its price', () => {
    const store = createTripStore();
    const stay = store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 4 });
    expect(stay.priceInr).toBe(6_400 * 4);
    const moved = store.moveItem(2, stay.id, '2026-11-06');
    expect(moved.date).toBe('2026-11-06');
    expect(moved.priceInr).toBe(stay.priceInr);
    expect(store.getState().items).toHaveLength(1);
  });

  it('rejects moving an item outside the trip window', () => {
    const { store, item } = storeWithFlight();
    expect(() => store.moveItem(2, item.id, '2026-12-01')).toThrow(/outside the trip window/);
    expect(store.getState().items[0]?.date).toBe('2026-11-05');
  });
});

describe('budget summary', () => {
  it('reports zero commitment for an empty plan', () => {
    const summary = createTripStore().getBudgetSummary();
    expect(summary).toEqual({
      budgetInr: 150_000,
      committedInr: 0,
      remainingInr: 150_000,
      overBudget: false,
      byKind: { activity: 0, flight: 0, stay: 0 },
    });
  });

  it('totals per kind and flags an over-cap plan', () => {
    const store = createTripStore();
    store.addItem(1, { kind: 'flight', flightId: 'fl-blr-hnd-morning', date: '2026-11-05' });
    store.addItem(2, { kind: 'flight', flightId: 'fl-nrt-blr-day', date: '2026-11-14' });
    store.addItem(3, { kind: 'stay', stayId: 'st-tok-high', date: '2026-11-05', nights: 6 });
    const summary = store.getBudgetSummary();
    expect(summary.byKind.flight).toBe(41_900 + 39_600);
    expect(summary.byKind.stay).toBe(11_800 * 6);
    expect(summary.committedInr).toBe(152_300);
    expect(summary.remainingInr).toBe(-2_300);
    expect(summary.overBudget).toBe(true);
  });

  it('keeps the cheapest hero-compatible plan under the cap', () => {
    const store = createTripStore();
    store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-05' });
    store.addItem(2, { kind: 'flight', flightId: 'fl-nrt-blr-day', date: '2026-11-14' });
    store.addItem(3, { kind: 'stay', stayId: 'st-tok-capsule', date: '2026-11-05', nights: 5 });
    store.addItem(4, { kind: 'stay', stayId: 'st-kyo-budget', date: '2026-11-10', nights: 4 });
    const summary = store.getBudgetSummary();
    expect(summary.overBudget).toBe(false);
    expect(summary.remainingInr).toBeGreaterThan(0);
  });
});

describe('inventory invariants enforced on write', () => {
  it('rejects a flight staged on a date the flight does not depart', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-10' }))
      .toThrow(/departs on 2026-11-05, not 2026-11-10/);
    expect(store.getState().items).toEqual([]);
  });

  it('rejects a red-eye flight while the trip avoids them', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-redeye', date: '2026-11-05' }))
      .toThrow(/red-eye departure/);
  });

  it('allows a red-eye flight when the trip does not avoid them', () => {
    const relaxed = createTripStore({ ...HERO_TRIP_CONSTRAINTS, avoidRedEyeFlights: false });
    const staged = relaxed.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-redeye', date: '2026-11-05' });
    expect(staged.priceInr).toBe(31_200);
  });

  it('refuses to move a flight even to a date inside the window', () => {
    const { store, item } = storeWithFlight();
    expect(() => store.moveItem(2, item.id, '2026-11-07')).toThrow(/cannot be moved/);
    expect(store.getState().items[0]?.date).toBe('2026-11-05');
  });

  it('rejects a stay whose checkout falls past the trip end', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-14', nights: 14 }))
      .toThrow(/checks out on 2026-11-28, past the trip end 2026-11-14/);
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-13', nights: 2 }))
      .toThrow(/past the trip end/);
  });

  it('accepts a stay that checks out exactly on the trip end', () => {
    const store = createTripStore();
    const stay = store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-13', nights: 1 });
    expect(stay.kind).toBe('stay');
    if (stay.kind !== 'stay') throw new Error('Expected a staged stay.');
    expect(stay.nights).toBe(1);
  });

  it('rejects moving a stay to a date that would overrun the trip end', () => {
    const store = createTripStore();
    const stay = store.addItem(1, { kind: 'stay', stayId: 'st-kyo-mid', date: '2026-11-05', nights: 4 });
    expect(() => store.moveItem(2, stay.id, '2026-11-12')).toThrow(/past the trip end/);
    expect(store.getState().items[0]?.date).toBe('2026-11-05');
  });
});

describe('store integrity', () => {
  it('never reissues an identifier when seeded with non-sequential items', () => {
    const seeded = createTripStore(HERO_TRIP_CONSTRAINTS, [{
      id: 'it-7',
      kind: 'activity',
      date: '2026-11-06',
      priceInr: 900,
      label: 'Akihabara electronics run',
      activityId: 'ac-tok-akihabara',
      cityId: 'tokyo',
    }]);
    const added = seeded.addItem(1, { kind: 'activity', activityId: 'ac-tok-teamlab', date: '2026-11-07' });
    expect(added.id).toBe('it-8');
    expect(new Set(seeded.getState().items.map((item) => item.id)).size).toBe(2);
  });

  it('never reissues an identifier introduced by a human edit', () => {
    const store = createTripStore();
    store.editAsHuman((items) => [...items, {
      id: 'it-1',
      kind: 'activity',
      date: '2026-11-06',
      priceInr: 0,
      label: 'Fushimi Inari torii climb',
      activityId: 'ac-kyo-fushimi',
      cityId: 'kyoto',
    }]);
    const added = store.addItem(2, {
      kind: 'activity',
      activityId: 'ac-tok-teamlab',
      date: '2026-11-07',
    });
    expect(added.id).toBe('it-2');
  });

  it('clones and freezes custom constraints at construction', () => {
    const constraints = {
      ...HERO_TRIP_CONSTRAINTS,
      mustKeepCities: [...HERO_TRIP_CONSTRAINTS.mustKeepCities],
    };
    const store = createTripStore(constraints);
    constraints.budgetInr = 1;
    constraints.mustKeepCities.length = 0;
    const stored = store.getState().constraints;
    expect(stored.budgetInr).toBe(150_000);
    expect(stored.mustKeepCities).toEqual(['tokyo', 'kyoto']);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.mustKeepCities)).toBe(true);
  });

  it('rejects duplicate identifiers introduced by a human edit', () => {
    const { store, item } = storeWithFlight();
    expect(() => store.editAsHuman((items) => [...items, { ...item }]))
      .toThrow(/Duplicate itinerary item id/);
    expect(store.getState()).toMatchObject({ revision: 2, items: [item] });
  });

  it('rejects invalid seeded items before publishing state', () => {
    expect(() => createTripStore(HERO_TRIP_CONSTRAINTS, [{
      id: 'seed-flight',
      kind: 'flight',
      date: '2026-11-06',
      priceInr: 38_500,
      label: 'Sakura Airways BLR-NRT',
      flightId: 'fl-blr-nrt-day',
    }])).toThrow(/departs on 2026-11-05/);
  });

  it('rejects non-canonical items introduced by a human edit', () => {
    const store = createTripStore();
    expect(() => store.editAsHuman((items) => [...items, {
      id: 'human-activity',
      kind: 'activity',
      date: '2026-11-06',
      priceInr: -1,
      label: 'teamLab Planets',
      activityId: 'ac-tok-teamlab',
      cityId: 'tokyo',
    }])).toThrow(/canonical price/);
    expect(store.getState()).toEqual({
      revision: 1,
      constraints: HERO_TRIP_CONSTRAINTS,
      items: [],
    });
  });

  it('rejects generated identifiers that exhaust the safe numeric range', () => {
    expect(() => createTripStore(HERO_TRIP_CONSTRAINTS, [{
      id: `it-${Number.MAX_SAFE_INTEGER}`,
      kind: 'activity',
      date: '2026-11-06',
      priceInr: 2_400,
      label: 'teamLab Planets',
      activityId: 'ac-tok-teamlab',
      cityId: 'tokyo',
    }])).toThrow(/supported numeric range/);
  });

  it('reports identifier exhaustion before attempting an add', () => {
    const lastUsable = Number.MAX_SAFE_INTEGER - 1;
    const store = createTripStore(HERO_TRIP_CONSTRAINTS, [{
      id: `it-${lastUsable}`,
      kind: 'activity',
      date: '2026-11-06',
      priceInr: 2_400,
      label: 'teamLab Planets',
      activityId: 'ac-tok-teamlab',
      cityId: 'tokyo',
    }]);
    expect(() => store.addItem(1, {
      kind: 'activity',
      activityId: 'ac-kyo-fushimi',
      date: '2026-11-07',
    })).toThrow(/identifier sequence is exhausted/);
    expect(store.getState()).toMatchObject({ revision: 1, items: [{ id: `it-${lastUsable}` }] });
  });

  it('freezes items so state cannot change without a revision bump', () => {
    const { store } = storeWithFlight();
    const item = store.getState().items[0] as ItineraryItem;
    expect(Object.isFrozen(item)).toBe(true);
    expect(() => {
      (item as { date: string }).date = '2026-11-09';
    }).toThrow(TypeError);
    expect(store.getState().revision).toBe(2);
  });

  it('freezes items introduced by a human edit', () => {
    const { store } = storeWithFlight();
    const next = store.editAsHuman((items) => [...items, {
      id: 'it-99',
      kind: 'activity',
      date: '2026-11-08',
      priceInr: 0,
      label: 'Fushimi Inari torii climb',
      activityId: 'ac-kyo-fushimi',
      cityId: 'kyoto',
    }]);
    expect(next.items.every((item) => Object.isFrozen(item))).toBe(true);
  });
});
