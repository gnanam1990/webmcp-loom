/**
 * The canonical travel tool surface.
 *
 * One definition per capability. The same array is registered with WebMCP for
 * external agents and handed to the in-app runtime, so neither side maintains a
 * private registry.
 *
 * Every read tool returns the current `revision` alongside its data. A write
 * tool then requires that revision back in its own input. WebMCP's
 * `executeTool()` carries no revision token of its own, so putting it in the
 * validated input contract is what lets a page-owned executor reject a stale
 * plan whether the call arrived from the in-app runtime or from outside.
 */

import { ACTIVITIES, DESTINATIONS, FLIGHTS, STAYS } from './inventory.js';
import { readBoolean, readNumber, readString } from './input.js';
import { TravelDomainError } from './state.js';
import type { AddItemRequest, TripStore } from './state.js';
import type { ActivityTag, CityId } from './types.js';
import type { JsonObject, RuntimeTool, RuntimeToolExecuteContext } from './runtime-contract.js';

const CITY_IDS: readonly CityId[] = ['hakone', 'kyoto', 'nara', 'osaka', 'tokyo'];
const ACTIVITY_TAGS: readonly ActivityTag[] = ['culture', 'food', 'nature', 'nightlife', 'shopping'];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * WebMCP calls the page-owned executor directly, so validate each executor
 * input against the same flat schema advertised to callers. This keeps the
 * schema and direct-call boundary in lockstep without duplicating every
 * optional-filter check inside individual tools.
 */
function validateExecutorInput(input: JsonObject, schema: Record<string, unknown>): void {
  if (!isRecord(input)) {
    throw new TravelDomainError('invalid_request', 'Tool input must be an object.');
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : [];

  for (const key of required) {
    if (!Object.hasOwn(input, key)) {
      throw new TravelDomainError('invalid_request', `${key} is required.`);
    }
  }

  for (const [key, value] of Object.entries(input)) {
    const propertySchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    if (!isRecord(propertySchema)) {
      if (schema.additionalProperties === false) {
        throw new TravelDomainError('invalid_request', `${key} is not allowed.`);
      }
      continue;
    }
    validateExecutorValue(key, value, propertySchema);
  }
}

function validateExecutorValue(key: string, value: unknown, schema: Record<string, unknown>): void {
  const type = schema.type;
  const matchesType = type === 'integer'
    ? typeof value === 'number' && Number.isInteger(value)
    : type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : type === undefined || typeof value === type;
  if (!matchesType) {
    throw new TravelDomainError('invalid_request', `${key} must be ${String(type)}.`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TravelDomainError('invalid_request', `${key} must be finite.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new TravelDomainError('invalid_request', `${key} must match an allowed value.`);
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) {
      throw new TravelDomainError('invalid_request', `${key} is too short.`);
    }
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) {
      throw new TravelDomainError('invalid_request', `${key} is too long.`);
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new TravelDomainError('invalid_request', `${key} must be at least ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new TravelDomainError('invalid_request', `${key} must be at most ${schema.maximum}.`);
    }
  }
}

function requireString(input: JsonObject, key: string): string {
  const value = readString(input, key);
  if (value === undefined) {
    throw new TravelDomainError('invalid_request', `${key} is required and must be a string.`);
  }
  return value;
}

/**
 * Writes trust the revision in the validated input, because that is the value
 * WebMCP can carry. When the in-app runtime also supplies its captured revision
 * out-of-band, the two must agree: a mismatch means the plan and the call were
 * built against different states.
 *
 * The runtime's revision type also permits strings. This domain issues numeric
 * revisions only, so a captured value of any other type is a contract mismatch
 * and is rejected rather than skipped — silently ignoring it would let a call
 * execute against a different planned state than the one it was built on.
 */
function requireExpectedRevision(input: JsonObject, context: RuntimeToolExecuteContext): number {
  const declared = readNumber(input, 'expectedRevision');
  if (declared === undefined || !Number.isInteger(declared)) {
    throw new TravelDomainError('invalid_request', 'expectedRevision is required and must be an integer.');
  }
  const captured = context.expectedStateRevision;
  if (captured !== undefined) {
    if (typeof captured !== 'number') {
      throw new TravelDomainError(
        'invalid_request',
        `This domain uses numeric state revisions; the runtime supplied ${typeof captured}.`,
      );
    }
    if (captured !== declared) {
      throw new TravelDomainError(
        'stale_revision',
        `Call declared revision ${declared} but was planned against revision ${captured}.`,
      );
    }
  }
  return declared;
}

export function createTravelTools(store: TripStore): RuntimeTool[] {
  const tools: RuntimeTool[] = [
    {
      name: 'get_trip_constraints',
      title: 'Get trip constraints',
      description: 'Read the budget cap, trip dates, origin airport, cities that must stay in the plan, and whether booking is permitted. Booking is always disabled.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => {
        const state = store.getState();
        return { revision: state.revision, constraints: state.constraints };
      },
    },
    {
      name: 'get_itinerary',
      title: 'Get itinerary',
      description: 'Read every staged itinerary item with its id, kind, date and price, plus the current state revision required by write tools.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => {
        const state = store.getState();
        return { revision: state.revision, items: state.items };
      },
    },
    {
      name: 'get_budget_summary',
      title: 'Get budget summary',
      description: 'Read committed spend, remaining budget, whether the plan is over cap, and the per-kind breakdown across flights, stays and activities.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({
        revision: store.getState().revision,
        budget: store.getBudgetSummary(),
      }),
    },
    {
      name: 'list_destinations',
      title: 'List destinations',
      description: 'Read the destinations available in this trip planner and the nights each one typically warrants.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ revision: store.getState().revision, destinations: DESTINATIONS }),
    },
    {
      name: 'search_flights',
      title: 'Search flights',
      description: 'Find flights, optionally filtered by origin, destination, departure date, maximum price, and whether to exclude red-eye departures.',
      inputSchema: {
        type: 'object',
        properties: {
          originCode: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA origin code, for example BLR.' },
          destinationCode: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA destination code, for example NRT.' },
          departureDate: { type: 'string', minLength: 10, maxLength: 10, description: 'ISO YYYY-MM-DD departure date.' },
          maxPriceInr: { type: 'integer', minimum: 0, description: 'Upper price bound in rupees.' },
          excludeRedEye: { type: 'boolean', description: 'Drop flights departing late at night.' },
        },
        required: [],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const originCode = readString(input, 'originCode');
        const destinationCode = readString(input, 'destinationCode');
        const departureDate = readString(input, 'departureDate');
        const maxPriceInr = readNumber(input, 'maxPriceInr');
        const excludeRedEye = readBoolean(input, 'excludeRedEye');
        const flights = FLIGHTS.filter((flight) => (
          (originCode === undefined || flight.originCode === originCode)
          && (destinationCode === undefined || flight.destinationCode === destinationCode)
          && (departureDate === undefined || flight.departureDate === departureDate)
          && (maxPriceInr === undefined || flight.priceInr <= maxPriceInr)
          && (excludeRedEye !== true || !flight.redEye)
        ));
        return { revision: store.getState().revision, flights };
      },
    },
    {
      name: 'search_stays',
      title: 'Search stays',
      description: 'Find places to stay in one city, optionally under a maximum nightly price.',
      inputSchema: {
        type: 'object',
        properties: {
          cityId: { type: 'string', enum: [...CITY_IDS], description: 'City to search.' },
          maxPricePerNightInr: { type: 'integer', minimum: 0, description: 'Upper nightly price bound in rupees.' },
        },
        required: ['cityId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const cityId = requireString(input, 'cityId');
        const maxPricePerNightInr = readNumber(input, 'maxPricePerNightInr');
        const stays = STAYS.filter((stay) => (
          stay.cityId === cityId
          && (maxPricePerNightInr === undefined || stay.pricePerNightInr <= maxPricePerNightInr)
        ));
        return { revision: store.getState().revision, stays };
      },
    },
    {
      name: 'search_activities',
      title: 'Search activities',
      description: 'Find activities in one city, optionally filtered by a single interest tag and a maximum price.',
      inputSchema: {
        type: 'object',
        properties: {
          cityId: { type: 'string', enum: [...CITY_IDS], description: 'City to search.' },
          tag: { type: 'string', enum: [...ACTIVITY_TAGS], description: 'Single interest filter.' },
          maxPriceInr: { type: 'integer', minimum: 0, description: 'Upper price bound in rupees.' },
        },
        required: ['cityId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const cityId = requireString(input, 'cityId');
        const tag = readString(input, 'tag');
        const maxPriceInr = readNumber(input, 'maxPriceInr');
        const activities = ACTIVITIES.filter((activity) => (
          activity.cityId === cityId
          && (tag === undefined || activity.tags.some((entry) => entry === tag))
          && (maxPriceInr === undefined || activity.priceInr <= maxPriceInr)
        ));
        return { revision: store.getState().revision, activities };
      },
    },
    {
      name: 'add_itinerary_item',
      title: 'Stage an itinerary item',
      description: 'Stage one flight, stay or activity onto a trip date. Staging changes the plan shown to the traveller; it never books, pays for, or reserves anything. Requires the revision returned by a read tool.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 1, description: 'Revision this plan was built against.' },
          kind: { type: 'string', enum: ['activity', 'flight', 'stay'], description: 'What is being staged.' },
          refId: { type: 'string', minLength: 1, maxLength: 64, description: 'Flight, stay or activity id from a search result.' },
          date: { type: 'string', minLength: 10, maxLength: 10, description: 'ISO YYYY-MM-DD date inside the trip window.' },
          nights: { type: 'integer', minimum: 1, maximum: 14, description: 'Required for stays, ignored otherwise.' },
        },
        required: ['expectedRevision', 'kind', 'refId', 'date'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input, context) => {
        const expectedRevision = requireExpectedRevision(input, context);
        const kind = requireString(input, 'kind');
        const refId = requireString(input, 'refId');
        const date = requireString(input, 'date');

        // The schema enum only binds callers the runtime validates. The WebMCP
        // bridge forwards raw input, so an unknown kind must fail here rather
        // than fall through into the stay branch.
        let request: AddItemRequest;
        if (kind === 'flight') {
          request = { kind: 'flight', flightId: refId, date };
        } else if (kind === 'activity') {
          request = { kind: 'activity', activityId: refId, date };
        } else if (kind === 'stay') {
          const nights = readNumber(input, 'nights');
          if (nights === undefined) {
            throw new TravelDomainError('invalid_request', 'nights is required when staging a stay.');
          }
          request = { kind: 'stay', stayId: refId, date, nights };
        } else {
          throw new TravelDomainError(
            'invalid_request',
            `Unknown itinerary kind: ${kind}. Expected activity, flight or stay.`,
          );
        }

        const item = store.addItem(expectedRevision, request);
        return { revision: store.getState().revision, staged: item, budget: store.getBudgetSummary() };
      },
    },
    {
      name: 'remove_itinerary_item',
      title: 'Remove an itinerary item',
      description: 'Remove one staged item from the plan by its itinerary item id. Requires the revision returned by a read tool.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 1, description: 'Revision this plan was built against.' },
          itemId: { type: 'string', minLength: 1, maxLength: 64, description: 'Itinerary item id, not a catalogue id.' },
        },
        required: ['expectedRevision', 'itemId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input, context) => {
        const expectedRevision = requireExpectedRevision(input, context);
        const removed = store.removeItem(expectedRevision, requireString(input, 'itemId'));
        return { revision: store.getState().revision, removed, budget: store.getBudgetSummary() };
      },
    },
    {
      name: 'move_itinerary_item',
      title: 'Move an itinerary item',
      description: 'Move one staged item to another date inside the trip window. Requires the revision returned by a read tool.',
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 1, description: 'Revision this plan was built against.' },
          itemId: { type: 'string', minLength: 1, maxLength: 64, description: 'Itinerary item id, not a catalogue id.' },
          toDate: { type: 'string', minLength: 10, maxLength: 10, description: 'ISO YYYY-MM-DD date inside the trip window.' },
        },
        required: ['expectedRevision', 'itemId', 'toDate'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input, context) => {
        const expectedRevision = requireExpectedRevision(input, context);
        const moved = store.moveItem(
          expectedRevision,
          requireString(input, 'itemId'),
          requireString(input, 'toDate'),
        );
        return { revision: store.getState().revision, moved, budget: store.getBudgetSummary() };
      },
    },
  ];
  return tools.map((tool) => {
    const execute = tool.execute;
    return {
      ...tool,
      execute: (input, context) => {
        const normalizedInput = input === undefined ? {} : input;
        validateExecutorInput(normalizedInput, tool.inputSchema);
        return execute(normalizedInput, context);
      },
    };
  });
}
