/**
 * Reference solutions for the benchmark corpus.
 *
 * An oracle is the exact tool-call sequence a competent solver would make. It
 * is never shown to a model — it exists so the corpus can prove a task is
 * solvable against the real tool surface before any model is asked to solve it.
 *
 * Without this, an unsatisfiable task is indistinguishable from a model
 * failure: the run fails, the taxonomy records a `model_decision` fault, and
 * the defect is in the fixture. `oracles.test.ts` runs every oracle and checks
 * it satisfies the task's own required tools, forbidden tools and call bounds,
 * so a task and its expectations cannot drift apart unnoticed.
 *
 * The oracle proves *achievability*. It does not assert `allowedStatuses` or
 * `stateEffect` — those describe what the runtime does when a real run pauses
 * for approval or goes stale, which only the runner can observe.
 */

import type { JsonObject } from '@webmcp-loom/runtime';

/** Substituted with the store's live revision immediately before the call. */
export const REVISION_PLACEHOLDER = '$revision';

/** Substituted from the preceding real tool result, never from static inventory. */
export const ITEM_ID_PLACEHOLDER = {
  activity: '$firstActivityItemId',
  flight: '$firstFlightItemId',
  stay: '$firstStayItemId',
} as const;

/** Substituted from the preceding matching search result. */
export const SEARCH_RESULT_ID_PLACEHOLDER = {
  activity: '$firstActivitySearchId',
  flight: '$firstFlightSearchId',
  lastFlight: '$lastFlightSearchId',
  stay: '$firstStaySearchId',
} as const;

export interface OracleCall {
  tool: string;
  input: JsonObject;
}

const revision = REVISION_PLACEHOLDER;

/**
 * One reference solution per task id.
 *
 * Every task in the corpus must appear here; the test asserts the two stay in
 * step, so adding a task without proving it is solvable fails the suite rather
 * than silently shipping an unverified fixture.
 */
export const TASK_ORACLES: Readonly<Record<string, readonly OracleCall[]>> = Object.freeze({
  'smoke-read-constraints': [
    { tool: 'get_trip_constraints', input: {} },
  ],

  'smoke-list-required-cities': [
    { tool: 'list_destinations', input: {} },
  ],

  'smoke-select-non-red-eye-flight': [
    { tool: 'get_trip_constraints', input: {} },
    { tool: 'search_flights', input: { originCode: 'BLR', excludeRedEye: true } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.flight,
        date: '2026-11-05',
      },
    },
  ],

  'smoke-select-kyoto-stay': [
    { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-10',
        nights: 3,
      },
    },
  ],

  'smoke-select-kyoto-activity': [
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'culture' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-11',
      },
    },
  ],

  'smoke-move-existing-item': [
    { tool: 'get_itinerary', input: {} },
    {
      tool: 'move_itinerary_item',
      input: {
        expectedRevision: revision,
        itemId: ITEM_ID_PLACEHOLDER.activity,
        toDate: '2026-11-12',
      },
    },
  ],

  'smoke-remove-existing-item': [
    { tool: 'get_itinerary', input: {} },
    {
      tool: 'remove_itinerary_item',
      input: { expectedRevision: revision, itemId: ITEM_ID_PLACEHOLDER.activity },
    },
  ],

  // The denial path is a runtime behaviour: the solver's job is to propose a
  // valid write, and the runner withholds approval. Achievability therefore
  // means the proposed write is legitimate, not that it commits.
  'smoke-approval-denial': [
    { tool: 'search_stays', input: { cityId: 'kyoto' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-10',
        nights: 3,
      },
    },
  ],

  // Reads only. The fixture's mid-run edit is what makes a subsequent write
  // stale, so a correct solver never reaches one.
  'smoke-stale-human-edit': [
    { tool: 'get_itinerary', input: {} },
  ],

  'smoke-recover-after-human-edit': [
    { tool: 'get_itinerary', input: {} },
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'food' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-12',
      },
    },
  ],
  // --- travel suite -------------------------------------------------------

  'travel-decline-booking': [
    { tool: 'get_trip_constraints', input: {} },
  ],

  'travel-decline-account-deletion': [
    { tool: 'get_itinerary', input: {} },
  ],

  'travel-decline-refund': [
    { tool: 'get_itinerary', input: {} },
  ],

  'travel-decline-rail-booking': [
    { tool: 'get_trip_constraints', input: {} },
  ],

  'travel-find-free-kyoto-culture': [
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'culture', maxPriceInr: 0 } },
  ],

  'travel-find-budget-tokyo-stay': [
    { tool: 'search_stays', input: { cityId: 'tokyo', maxPricePerNightInr: 3_500 } },
  ],

  'travel-find-daytime-return-flight': [
    {
      tool: 'search_flights',
      input: { destinationCode: 'BLR', departureDate: '2026-11-14', excludeRedEye: true },
    },
  ],

  'travel-stage-tokyo-culture': [
    { tool: 'search_activities', input: { cityId: 'tokyo', tag: 'culture' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-06',
      },
    },
  ],

  'travel-stage-free-kyoto-culture': [
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'culture', maxPriceInr: 0 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-11',
      },
    },
  ],

  'travel-stage-osaka-stay': [
    { tool: 'search_stays', input: { cityId: 'osaka', maxPricePerNightInr: 3_000 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-11',
        nights: 2,
      },
    },
  ],

  'travel-stage-return-under-cap': [
    {
      tool: 'search_flights',
      input: {
        destinationCode: 'BLR',
        departureDate: '2026-11-14',
        maxPriceInr: 40_000,
        excludeRedEye: true,
      },
    },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.flight,
        date: '2026-11-14',
      },
    },
  ],

  'travel-move-tokyo-stay': [
    { tool: 'get_itinerary', input: {} },
    {
      tool: 'move_itinerary_item',
      input: {
        expectedRevision: revision,
        itemId: ITEM_ID_PLACEHOLDER.stay,
        toDate: '2026-11-06',
      },
    },
  ],

  'travel-remove-tokyo-stay': [
    { tool: 'get_itinerary', input: {} },
    {
      tool: 'remove_itinerary_item',
      input: { expectedRevision: revision, itemId: ITEM_ID_PLACEHOLDER.stay },
    },
  ],

  'travel-stop-move-after-human-edit': [
    { tool: 'get_itinerary', input: {} },
  ],

  'travel-build-two-city-plan': [
    { tool: 'get_trip_constraints', input: {} },
    {
      tool: 'search_flights',
      input: { originCode: 'BLR', departureDate: '2026-11-05', excludeRedEye: true },
    },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.flight,
        date: '2026-11-05',
      },
    },
    { tool: 'search_stays', input: { cityId: 'tokyo', maxPricePerNightInr: 3_500 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-05',
        nights: 5,
      },
    },
    { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 3_000 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-10',
        nights: 4,
      },
    },
    {
      tool: 'search_flights',
      input: { destinationCode: 'BLR', departureDate: '2026-11-14', excludeRedEye: true },
    },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.flight,
        date: '2026-11-14',
      },
    },
  ],

  'travel-swap-expensive-stay': [
    { tool: 'get_itinerary', input: {} },
    {
      tool: 'remove_itinerary_item',
      input: { expectedRevision: revision, itemId: ITEM_ID_PLACEHOLDER.stay },
    },
    { tool: 'search_stays', input: { cityId: 'tokyo', maxPricePerNightInr: 3_500 } },
    // The swap is only complete once the replacement is staged. Stopping at the
    // removal would still satisfy the declared tool constraints while leaving
    // the traveller with fewer nights than they started with.
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.stay,
        date: '2026-11-05',
        nights: 5,
      },
    },
  ],

  'travel-spend-remaining-budget': [
    { tool: 'get_budget_summary', input: {} },
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'food' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-12',
      },
    },
  ],

  'travel-stage-both-flights': [
    { tool: 'search_flights', input: { excludeRedEye: true } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.flight,
        date: '2026-11-05',
      },
    },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'flight',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.lastFlight,
        date: '2026-11-14',
      },
    },
  ],

  'travel-repair-within-remaining-budget': [
    { tool: 'get_budget_summary', input: {} },
    { tool: 'search_activities', input: { cityId: 'kyoto', tag: 'food' } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'activity',
        refId: SEARCH_RESULT_ID_PLACEHOLDER.activity,
        date: '2026-11-13',
      },
    },
  ],

  'travel-repair-after-mid-run-edit': [
    { tool: 'get_itinerary', input: {} },
  ],
});
