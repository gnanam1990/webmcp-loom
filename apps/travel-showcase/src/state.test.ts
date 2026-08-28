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

  it('requires a positive integer night count for stays', () => {
    const store = createTripStore();
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 0 }))
      .toThrow(/at least 1/);
    expect(() => store.addItem(1, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 2.5 }))
      .toThrow(/at least 1/);
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
