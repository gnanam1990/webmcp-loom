import { describe, expect, it } from 'vitest';

import { createTravelToolSelector, TRAVEL_RETRIEVAL_PROFILE } from './retrieval.js';
import { createTripStore } from './state.js';
import { createTravelTools } from './tools.js';
import type { AgentToolResult } from '@webmcp-loom/runtime';

const goal = 'Prepare a 10-day Japan trip under 1.5L. Keep Tokyo and Kyoto, avoid red-eye flights, and do not book anything.';

function context(history: readonly AgentToolResult[] = []) {
  return {
    goal,
    history,
    stateRevision: 1,
    step: history.length + 1,
    tools: createTravelTools(createTripStore()),
  };
}

describe('travel retrieval profile', () => {
  it.each([
    ['Inspect the trip constraints and tell me whether booking is available.', 'get_trip_constraints'],
    ['List the available destinations and confirm Tokyo and Kyoto.', 'list_destinations'],
    ['Find a free cultural activity in Kyoto.', 'search_activities'],
    ['Show me Tokyo stays below 3,500 rupees a night.', 'search_stays'],
    ['Find a non-red-eye return flight to Bengaluru.', 'search_flights'],
    ['Use some of what is left in the budget on activities.', 'get_budget_summary'],
    ['Look at what is planned and add one Kyoto activity.', 'get_itinerary'],
    ['Rework everything around that.', 'get_itinerary'],
  ])('puts the applicable first read first for %s', (request, expected) => {
    expect(createTravelToolSelector()({ ...context(), goal: request })[0]).toBe(expected);
  });

  it('is versioned and narrows the initial planning surface to relevant reads', () => {
    const selected = createTravelToolSelector()(context());

    expect(TRAVEL_RETRIEVAL_PROFILE).toEqual({ id: 'travel-deterministic-v1', maxTools: 4 });
    expect(selected).toHaveLength(4);
    expect(selected).toEqual(expect.arrayContaining([
      'get_trip_constraints',
      'search_flights',
      'search_stays',
    ]));
    expect(selected).not.toContain('add_itinerary_item');
  });

  it.each([
    ['Plan a flight to Tokyo.', 'search_flights', 'search_stays'],
    ['Plan a flight for this trip.', 'search_flights', 'search_stays'],
    ['Plan a red-eye for this trip.', 'search_flights', 'search_stays'],
    ['Plan airfare for this trip.', 'search_flights', 'search_stays'],
    ['Prepare a Kyoto hotel stay.', 'search_stays', 'search_flights'],
    ['Plan accommodation for this trip.', 'search_stays', 'search_flights'],
  ])('keeps a scoped planning request inside its domain for %s', (request, expected, excluded) => {
    const selected = createTravelToolSelector()({ ...context(), goal: request });

    expect(selected[0]).toBe(expected);
    expect(selected).not.toContain(excluded);
  });

  it('keeps a cultural-activity request from becoming a full-trip plan', () => {
    const selected = createTravelToolSelector()({
      ...context(),
      goal: 'Plan a cultural activity for this trip.',
    });

    expect(selected[0]).toBe('search_activities');
    expect(selected).not.toContain('search_flights');
    expect(selected).not.toContain('search_stays');
  });

  it('keeps a multi-domain planning request on the full planning workflow', () => {
    const selected = createTravelToolSelector()({
      ...context(),
      goal: 'Plan a flight and hotel stay for this trip.',
    });

    expect(selected).toEqual(expect.arrayContaining([
      'get_trip_constraints',
      'search_flights',
      'search_stays',
    ]));
  });

  it.each([
    ['Plan a flight and cultural activity.', 'search_stays'],
    ['Plan a hotel stay and cultural activity.', 'search_flights'],
  ])('does not invent an unmentioned domain for %s', (request, excluded) => {
    const selected = createTravelToolSelector()({ ...context(), goal: request });

    expect(selected).not.toContain(excluded);
  });

  it.each([
    'Delete the whole trip.',
    'Delete the whole trip including every hotel stay.',
    'Remove my itinerary.',
    'Close my account and delete the trip.',
  ])('does not advertise item removal for unsupported destructive intent: %s', (request) => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }]),
      goal: request,
    });

    expect(selected.filter((name) => name.endsWith('_itinerary_item'))).toEqual([]);
  });

  it.each([
    'Do not remove the staged stay.',
    'Remove all staged stays.',
    'Delete both itinerary items.',
  ])('does not expose singular removal for negated or plural intent: %s', (request) => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }]),
      goal: request,
    });

    expect(selected).not.toContain('remove_itinerary_item');
  });

  it.each([
    'Remove the itinerary item.',
    'Remove 1 staged stay.',
    'Remove one staged stay.',
    'I want to remove the itinerary item.',
    'Please delete the staged Tokyo stay.',
    'I need you to drop the trip item.',
  ])('recognizes a singular item-removal command: %s', (request) => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }]),
      goal: request,
    });

    expect(selected[0]).toBe('remove_itinerary_item');
  });

  it('admits staging after a search returns a reusable id and revision', () => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'search_flights',
        input: { originCode: 'BLR', excludeRedEye: true },
        ok: true,
        output: { revision: 1, flights: [{ id: 'fl-blr-nrt-day' }] },
      }]),
      goal: 'Find a non-red-eye flight and stage it.',
    });

    expect(selected).toContain('search_flights');
    expect(selected).toContain('add_itinerary_item');
    expect(selected).not.toContain('move_itinerary_item');
    expect(selected).not.toContain('remove_itinerary_item');
  });

  it('retrieves the itinerary before exposing a move that needs its item id', () => {
    const selector = createTravelToolSelector();
    const moveGoal = {
      ...context(),
      goal: 'Move the staged Tokyo stay one day later without changing anything else.',
    };
    const initial = selector(moveGoal);
    const afterRead = selector({
      ...moveGoal,
      history: [{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }],
      stateRevision: 4,
      step: 2,
    });

    expect(initial[0]).toBe('get_itinerary');
    expect(initial).not.toContain('move_itinerary_item');
    expect(afterRead).toContain('move_itinerary_item');
  });

  it('keeps a requested removal available when its negative clause protects another kind', () => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }]),
      goal: 'Remove the staged Tokyo stay, but do not remove any activity.',
    });

    expect(selected[0]).toBe('remove_itinerary_item');
  });

  it.each([
    ['Please delete the staged Tokyo stay without changing anything else.', 'remove_itinerary_item'],
    ['I need you to drop the staged Tokyo stay without changing anything else.', 'remove_itinerary_item'],
    ['Could you reschedule the staged Tokyo stay without changing anything else?', 'move_itinerary_item'],
    ['Please shift the staged Tokyo stay without changing anything else.', 'move_itinerary_item'],
  ])('keeps the travel synonym mutation retrievable for %s', (request, expected) => {
    const selected = createTravelToolSelector()({
      ...context([{
        step: 1,
        tool: 'get_itinerary',
        input: {},
        ok: true,
        output: { revision: 4, items: [{ id: 'item-2', kind: 'stay' }] },
      }]),
      goal: request,
    });

    expect(selected[0]).toBe(expected);
  });
});
