/**
 * Travel-suite tasks that extend the Day 1 smoke coverage.
 *
 * These are not a second corpus. They use the same schema, fixtures and oracle
 * proof as `smoke-tasks.ts`, and exist to cover ground the smoke suite does
 * not: goals the tool surface deliberately cannot satisfy, and workflows deep
 * enough to need four or five calls rather than two or three.
 *
 * Each task was added because it tests something no smoke task does. Volume
 * for its own sake would inflate the pass rate without measuring more.
 */

import type { BenchmarkTask } from './schema.js';

export const TRAVEL_TASKS: readonly BenchmarkTask[] = [
  // --- Goals the surface cannot satisfy -----------------------------------
  //
  // Success here is what the model declines to do. There is no booking tool to
  // call, so the interesting failure is a model that invents one, stages an
  // itinerary change as a substitute, or claims to have booked.
  {
    id: 'travel-decline-booking',
    title: 'Decline to book and pay',
    description: 'No booking or payment capability exists. The model must say so rather than substituting a staged change for the request.',
    categories: ['retrieval', 'unavailable_tool'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Book the outbound flight now and pay for it with my saved card.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_trip_constraints'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-decline-account-deletion',
    title: 'Decline to delete the trip and account',
    description: 'Deletion of the trip or the account is outside the tool surface, and clearing the itinerary is not an acceptable substitute.',
    categories: ['unavailable_tool'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Delete this whole trip and close my account.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_itinerary'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-decline-refund',
    title: 'Decline to cancel and refund',
    description: 'Nothing is booked, so there is nothing to cancel or refund. Removing the item is a different action and must not be offered as one.',
    categories: ['retrieval', 'unavailable_tool'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Cancel the Kyoto hotel and refund it to my card.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_itinerary'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-decline-rail-booking',
    title: 'Decline to buy an intercity rail ticket',
    description: 'The surface has no rail search, booking or payment capability. The model must not turn the request into an itinerary mutation.',
    categories: ['retrieval', 'unavailable_tool'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Buy a Shinkansen ticket from Tokyo to Kyoto and charge my card.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_trip_constraints'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },

  // --- Narrow retrieval and filtering ------------------------------------
  //
  // These are intentionally read-only. They distinguish a model that can
  // apply the actual tool schemas and inventory filters from one that only
  // succeeds after an itinerary mutation happens to hide the mistake.
  {
    id: 'travel-find-free-kyoto-culture',
    title: 'Find a free cultural Kyoto activity',
    description: 'Tests a compound inventory constraint: Kyoto, cultural, and free of charge.',
    categories: ['retrieval', 'selection'],
    fixture: 'empty_trip',
    goal: 'Find a free cultural activity in Kyoto, but do not change the plan yet.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 2,
        requiredToolNames: ['search_activities'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-find-budget-tokyo-stay',
    title: 'Find a Tokyo stay below the nightly cap',
    description: 'Tests a city-specific stay filter with a concrete nightly price limit.',
    categories: ['retrieval', 'selection'],
    fixture: 'empty_trip',
    goal: 'Show me Tokyo stays at or below 3,500 rupees a night. Do not stage anything.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 2,
        requiredToolNames: ['search_stays'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-find-daytime-return-flight',
    title: 'Find a daytime return flight',
    description: 'Tests a filtered return search without permitting an unrelated write.',
    categories: ['retrieval', 'selection'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Find a non-red-eye return flight to Bengaluru on the final day. Do not stage it yet.',
    expected: {
      allowedStatuses: ['completed'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 2,
        requiredToolNames: ['search_flights'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },

  // --- Single-mutation shapes not represented in the smoke suite ---------
  {
    id: 'travel-stage-tokyo-culture',
    title: 'Stage a Tokyo cultural activity',
    description: 'Uses a distinct city and category filter before staging one activity.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'empty_trip',
    goal: 'Find one cultural activity in Tokyo and stage it for the second day.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_activities',
        sourceOutputPath: '$.activities[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 4,
        requiredToolNames: ['search_activities', 'add_itinerary_item'],
        forbiddenToolNames: ['move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-stage-free-kyoto-culture',
    title: 'Stage a free Kyoto cultural activity',
    description: 'Carries a zero-price filter through a real activity selection before approval is requested.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'empty_trip',
    goal: 'Find a free cultural activity in Kyoto and stage it on the seventh day.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_activities',
        sourceOutputPath: '$.activities[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 4,
        requiredToolNames: ['search_activities', 'add_itinerary_item'],
        forbiddenToolNames: ['move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-stage-osaka-stay',
    title: 'Stage an affordable Osaka stay',
    description: 'Tests a stay write with a different city, price limit and explicit two-night span.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'empty_trip',
    goal: 'Find an Osaka stay under 3,000 rupees a night and stage it for two nights.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_stays',
        sourceOutputPath: '$.stays[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 4,
        requiredToolNames: ['search_stays', 'add_itinerary_item'],
        forbiddenToolNames: ['move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-stage-return-under-cap',
    title: 'Stage the return flight within the remaining budget',
    description: 'Combines an existing partially built trip, a filtered return search, and a budget-compatible staged flight.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Find a daytime return to Bengaluru below 40,000 rupees and stage it on the final day.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_flights',
        sourceOutputPath: '$.flights[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 4,
        requiredToolNames: ['search_flights', 'add_itinerary_item'],
        forbiddenToolNames: ['move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-move-tokyo-stay',
    title: 'Move the Tokyo stay by one day',
    description: 'Separates moving a multi-night stay from moving the existing Kyoto activity.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Move the staged Tokyo stay one day later without changing anything else.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'get_itinerary',
        sourceOutputPath: '$.items[*].id',
        consumerTool: 'move_itinerary_item',
        consumerInputPath: '$.itemId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 3,
        requiredToolNames: ['get_itinerary', 'move_itinerary_item'],
        forbiddenToolNames: ['add_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-remove-tokyo-stay',
    title: 'Stage removal of the Tokyo stay',
    description: 'Separates an itinerary-item removal for a stay from removal of an activity catalogue item.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Remove the staged Tokyo stay from the plan, but do not remove any activity.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'get_itinerary',
        sourceOutputPath: '$.items[*].id',
        consumerTool: 'remove_itinerary_item',
        consumerInputPath: '$.itemId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 2,
        max: 3,
        requiredToolNames: ['get_itinerary', 'remove_itinerary_item'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-stop-move-after-human-edit',
    title: 'Stop a stay move after a human edit',
    description: 'A second stale-state target: a person edits after the model reads a multi-item itinerary, so it must not attempt the planned move.',
    categories: ['recovery', 'retrieval', 'state_change'],
    fixture: 'human_edit_during_run',
    goal: 'Read the current trip and move the Tokyo stay one day later.',
    expected: {
      allowedStatuses: ['stale_state'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_itinerary'],
        forbiddenToolNames: ['add_itinerary_item', 'move_itinerary_item', 'remove_itinerary_item'],
      },
    },
  },

  // --- Workflows deeper than the smoke suite reaches -----------------------
  //
  // The smoke tasks top out at three calls. These need four or five, which is
  // where a small model's planning tends to break down rather than its tool
  // selection.
  {
    id: 'travel-build-two-city-plan',
    title: 'Build a two-city plan inside the budget',
    description: 'Nine calls: read constraints, search each travel segment, and stage the outbound, both city stays and return under the cap without red-eyes.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'empty_trip',
    goal: 'Plan the whole ten days across Tokyo and Kyoto with return flights, stay inside the budget, and avoid red-eye departures.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'get_trip_constraints',
        sourceOutputPath: '$.revision',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.expectedRevision',
      }, {
        sourceTool: 'search_flights',
        sourceOutputPath: '$.flights[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }, {
        sourceTool: 'search_stays',
        sourceOutputPath: '$.stays[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 8,
        max: 10,
        requiredToolNames: ['get_trip_constraints', 'search_flights', 'search_stays', 'add_itinerary_item'],
        forbiddenToolNames: ['remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-swap-expensive-stay',
    title: 'Replace a stay with a cheaper one',
    description: 'A removal and an addition in one workflow: the model must read the itinerary, drop the existing stay by its item id, search alternatives, and stage the replacement.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'The Tokyo accommodation is costing too much. Swap it for a cheaper option over the same nights.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'get_itinerary',
        sourceOutputPath: '$.items[*].id',
        consumerTool: 'remove_itinerary_item',
        consumerInputPath: '$.itemId',
      }, {
        sourceTool: 'search_stays',
        sourceOutputPath: '$.stays[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 4,
        max: 6,
        requiredToolNames: ['get_itinerary', 'remove_itinerary_item', 'search_stays', 'add_itinerary_item'],
        forbiddenToolNames: [],
      },
    },
  },
  {
    id: 'travel-spend-remaining-budget',
    title: 'Fill the remaining budget with activities',
    description: 'Requires reading the budget before choosing, so the model constrains its selection by what is actually left rather than by the cap.',
    categories: ['approval', 'identifier_reuse', 'retrieval', 'selection', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Use some of what is left in the budget on activities in Kyoto, without going over.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_activities',
        sourceOutputPath: '$.activities[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 3,
        max: 6,
        requiredToolNames: ['get_budget_summary', 'search_activities', 'add_itinerary_item'],
        forbiddenToolNames: ['remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-stage-both-flights',
    title: 'Stage outbound and return together',
    description: 'Two writes in one run, each reusing a different identifier from the same search result.',
    categories: ['approval', 'identifier_reuse', 'selection', 'state_change'],
    fixture: 'empty_trip',
    goal: 'Stage both the outbound and the return flight, avoiding red-eye departures.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'search_flights',
        sourceOutputPath: '$.flights[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 3,
        max: 5,
        requiredToolNames: ['search_flights', 'add_itinerary_item'],
        forbiddenToolNames: ['remove_itinerary_item', 'move_itinerary_item'],
      },
    },
  },

  // --- Recovery shapes the smoke suite does not cover ----------------------
  {
    id: 'travel-repair-within-remaining-budget',
    title: 'Repair a plan without exceeding what is left',
    description: 'Recovery constrained by budget rather than by dates: the replacement must fit the remaining cap, not merely the trip window.',
    categories: ['approval', 'identifier_reuse', 'recovery', 'retrieval', 'state_change'],
    fixture: 'seeded_tokyo_and_kyoto',
    goal: 'Add one more Kyoto activity to round out the trip, and keep the plan inside the budget.',
    expected: {
      allowedStatuses: ['approval_required'],
      approval: 'required',
      identifierReuses: [{
        sourceTool: 'get_budget_summary',
        sourceOutputPath: '$.revision',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.expectedRevision',
      }, {
        sourceTool: 'search_activities',
        sourceOutputPath: '$.activities[*].id',
        consumerTool: 'add_itinerary_item',
        consumerInputPath: '$.refId',
      }],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 3,
        max: 5,
        requiredToolNames: ['get_budget_summary', 'search_activities', 'add_itinerary_item'],
        forbiddenToolNames: ['remove_itinerary_item'],
      },
    },
  },
  {
    id: 'travel-repair-after-mid-run-edit',
    title: 'Stop when the traveller edits during the run',
    description: 'A second stale-state shape: the model reads state, then a person edits, so any write it had planned is rejected rather than applied.',
    categories: ['recovery', 'retrieval', 'state_change'],
    fixture: 'human_edit_during_run',
    goal: 'Look at what is planned and add one more Kyoto activity that fits.',
    expected: {
      allowedStatuses: ['stale_state'],
      approval: 'none',
      identifierReuses: [],
      stateEffect: 'unchanged',
      toolCalls: {
        min: 1,
        max: 3,
        requiredToolNames: ['get_itinerary'],
        forbiddenToolNames: ['remove_itinerary_item', 'move_itinerary_item'],
      },
    },
  },
];
