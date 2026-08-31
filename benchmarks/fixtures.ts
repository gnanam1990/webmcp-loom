/**
 * Materialised benchmark fixtures.
 *
 * `BenchmarkFixtureId` named three starting states; this turns each of them
 * into a real store built through the travel domain's own tools, so a fixture
 * cannot describe a trip the domain would reject.
 *
 * Seeding goes through `addItem` rather than `initialItems` deliberately. The
 * write path is where inventory invariants live — a flight only on its
 * timetable date, a stay that checks out inside the window — so building a
 * fixture the same way a caller would proves the starting state is reachable
 * rather than merely well-typed.
 */

import { createTripStore } from '../apps/travel-showcase/src/state.js';
import type { TripStore } from '../apps/travel-showcase/src/state.js';
import type { BenchmarkFixtureId } from './schema.js';

export interface BenchmarkFixture {
  id: BenchmarkFixtureId;
  description: string;
  /** A fresh store for one task run. Never shared between tasks. */
  createStore(): TripStore;
  /**
   * Applied by the runner after the model's first decision, for fixtures that
   * exist to make a run go stale. Absent when the fixture is a static start.
   */
  interrupt?: (store: TripStore) => void;
}

function emptyTrip(): TripStore {
  return createTripStore();
}

/**
 * A part-built two-city trip: outbound flight, Tokyo nights, Kyoto nights, and
 * one Kyoto activity. Deliberately leaves the return flight unstaged and the
 * budget with room, so a task can repair or extend it without being forced
 * over the cap by the fixture itself.
 */
function seededTokyoAndKyoto(): TripStore {
  const store = createTripStore();
  store.addItem(1, { kind: 'flight', flightId: 'fl-blr-nrt-day', date: '2026-11-05' });
  // Keep a genuinely replaceable Tokyo stay: the swap task must be able to
  // select a cheaper option from the same real inventory.
  store.addItem(2, { kind: 'stay', stayId: 'st-tok-mid', date: '2026-11-05', nights: 5 });
  store.addItem(3, { kind: 'stay', stayId: 'st-kyo-budget', date: '2026-11-10', nights: 4 });
  store.addItem(4, { kind: 'activity', activityId: 'ac-kyo-fushimi', date: '2026-11-11' });
  return store;
}

export const BENCHMARK_FIXTURES: Readonly<Record<BenchmarkFixtureId, BenchmarkFixture>> =
  Object.freeze({
    empty_trip: {
      id: 'empty_trip',
      description: 'No staged items. Revision 1, full budget available.',
      createStore: emptyTrip,
    },
    seeded_tokyo_and_kyoto: {
      id: 'seeded_tokyo_and_kyoto',
      description: 'Outbound flight, Tokyo and Kyoto stays, and one Kyoto activity already staged.',
      createStore: seededTokyoAndKyoto,
    },
    human_edit_during_run: {
      id: 'human_edit_during_run',
      description: 'Starts seeded, then a person removes the Kyoto activity mid-run so any plan built against the earlier revision is stale.',
      createStore: seededTokyoAndKyoto,
      interrupt: (store) => {
        store.editAsHuman((items) => items.filter((item) => (
          !('activityId' in item) || item.activityId !== 'ac-kyo-fushimi'
        )));
      },
    },
  });

export function benchmarkFixture(id: BenchmarkFixtureId): BenchmarkFixture {
  const fixture = BENCHMARK_FIXTURES[id];
  if (fixture === undefined) throw new Error(`Unknown benchmark fixture: ${id}`);
  return fixture;
}
