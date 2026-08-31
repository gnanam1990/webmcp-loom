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

/** Substituted with the id of the first staged itinerary item matching a kind. */
export const ITEM_ID_PLACEHOLDER = {
  activity: '$firstActivityItemId',
  flight: '$firstFlightItemId',
  stay: '$firstStayItemId',
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
      input: { expectedRevision: revision, kind: 'flight', refId: 'fl-blr-nrt-day', date: '2026-11-05' },
    },
  ],

  'smoke-select-kyoto-stay': [
    { tool: 'search_stays', input: { cityId: 'kyoto', maxPricePerNightInr: 6_000 } },
    {
      tool: 'add_itinerary_item',
      input: {
        expectedRevision: revision,
        kind: 'stay',
        refId: 'st-kyo-mid',
        date: '2026-11-10',
        nights: 4,
      },
    },
  ],

  'smoke-select-kyoto-activity': [
    { tool: 'search_activities', input: { cityId: 'kyoto' } },
    {
      tool: 'add_itinerary_item',
      input: { expectedRevision: revision, kind: 'activity', refId: 'ac-kyo-bamboo', date: '2026-11-11' },
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
        refId: 'st-kyo-budget',
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
    {
      tool: 'add_itinerary_item',
      input: { expectedRevision: revision, kind: 'activity', refId: 'ac-kyo-nishiki', date: '2026-11-12' },
    },
  ],
});
