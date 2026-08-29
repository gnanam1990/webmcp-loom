/**
 * Shared trip state.
 *
 * The same store backs the human UI and the agent's tools. Human edits are
 * authoritative and apply unconditionally; agent writes must present the
 * revision they were planned against and are rejected if the person changed
 * anything in the meantime. That compare-and-swap is what makes the runtime's
 * optimistic stale-state check meaningful — a preflight read alone cannot make
 * an asynchronous write atomic.
 *
 * The store is the last line of validation, not the first. A tool schema is
 * enforced by the runtime for in-app calls, but the WebMCP bridge forwards raw
 * input straight to the executor, so every invariant that matters is checked
 * here rather than assumed from the schema.
 */

import { ACTIVITIES, FLIGHTS, HERO_TRIP_CONSTRAINTS, STAYS } from './inventory.js';
import type {
  BudgetSummary,
  ItineraryItem,
  ItineraryItemKind,
  TripConstraints,
  TripState,
} from './types.js';

export type TravelDomainErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'stale_revision';

export class TravelDomainError extends Error {
  readonly code: TravelDomainErrorCode;

  constructor(code: TravelDomainErrorCode, message: string) {
    super(message);
    this.name = 'TravelDomainError';
    this.code = code;
  }
}

export type AddItemRequest =
  | { kind: 'activity'; activityId: string; date: string }
  | { kind: 'flight'; flightId: string; date: string }
  | { kind: 'stay'; stayId: string; date: string; nights: number };

export interface TripStore {
  getState(): TripState;
  getBudgetSummary(): BudgetSummary;
  /** Agent write. `expectedRevision` must match current state exactly. */
  addItem(expectedRevision: number, request: AddItemRequest): ItineraryItem;
  removeItem(expectedRevision: number, itemId: string): ItineraryItem;
  moveItem(expectedRevision: number, itemId: string, toDate: string): ItineraryItem;
  /** Human edit from the UI. Unconditional, and bumps the revision. */
  editAsHuman(change: (items: readonly ItineraryItem[]) => readonly ItineraryItem[]): TripState;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GENERATED_ID = /^it-(\d+)$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function calendarTimestamp(isoDate: string): number {
  if (typeof isoDate !== 'string' || !ISO_DATE.test(isoDate)) {
    throw new TravelDomainError('invalid_request', `Date must be an ISO YYYY-MM-DD value: ${isoDate}`);
  }
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  if (
    !Number.isFinite(parsed)
    || new Date(parsed).toISOString().slice(0, 10) !== isoDate
  ) {
    throw new TravelDomainError('invalid_request', `Date is not a real calendar day: ${isoDate}`);
  }
  return parsed;
}

/** Adds whole days to an ISO date without touching local time zone rules. */
function addDays(isoDate: string, days: number): string {
  const parsed = calendarTimestamp(isoDate);
  const result = parsed + days * MILLISECONDS_PER_DAY;
  if (!Number.isFinite(result) || Math.abs(result) > MAX_DATE_TIMESTAMP) {
    throw new TravelDomainError(
      'invalid_request',
      `Date span is outside the supported calendar range: ${isoDate} plus ${days} days.`,
    );
  }
  return new Date(result).toISOString().slice(0, 10);
}

function deepFreezeItem(item: ItineraryItem): ItineraryItem {
  return Object.freeze({ ...item });
}

export function createTripStore(
  inputConstraints: TripConstraints = HERO_TRIP_CONSTRAINTS,
  initialItems: readonly ItineraryItem[] = [],
): TripStore {
  const startTimestamp = calendarTimestamp(inputConstraints.startDate);
  const endTimestamp = calendarTimestamp(inputConstraints.endDate);
  if (endTimestamp < startTimestamp) {
    throw new TravelDomainError('invalid_request', 'Trip endDate must not be before startDate.');
  }
  const inclusiveDays = ((endTimestamp - startTimestamp) / MILLISECONDS_PER_DAY) + 1;
  if (!Number.isSafeInteger(inputConstraints.totalDays) || inputConstraints.totalDays !== inclusiveDays) {
    throw new TravelDomainError(
      'invalid_request',
      `totalDays must match the inclusive trip window (${inclusiveDays}).`,
    );
  }
  if (!Array.isArray(inputConstraints.mustKeepCities)) {
    throw new TravelDomainError('invalid_request', 'mustKeepCities must be an array.');
  }
  const constraints: TripConstraints = Object.freeze({
    ...inputConstraints,
    mustKeepCities: Object.freeze([...inputConstraints.mustKeepCities]),
  });
  let revision = 1;

  const freezeItems = (entries: readonly ItineraryItem[]): readonly ItineraryItem[] => {
    const ids = new Set<string>();
    const frozen = entries.map((entry) => {
      if (ids.has(entry.id)) {
        throw new TravelDomainError('invalid_request', `Duplicate itinerary item id: ${entry.id}.`);
      }
      ids.add(entry.id);
      return deepFreezeItem(entry);
    });
    return Object.freeze(frozen);
  };

  let items: readonly ItineraryItem[] = freezeItems(initialItems);

  /**
   * Derived from the highest generated identifier rather than the item count,
   * so a store seeded with sparse or non-sequential ids cannot reissue one.
   */
  const highestGeneratedNumber = (entries: readonly ItineraryItem[]): number => {
    let highest = 0;
    for (const entry of entries) {
      const matched = GENERATED_ID.exec(entry.id);
      const parsed = matched === null ? 0 : Number(matched[1]);
      if (Number.isSafeInteger(parsed) && parsed > highest) highest = parsed;
    }
    return highest;
  };

  let nextItemNumber = highestGeneratedNumber(items) + 1;

  const snapshot = (): TripState => Object.freeze({
    revision,
    constraints,
    items,
  });

  const requireFresh = (expectedRevision: number): void => {
    if (!Number.isInteger(expectedRevision)) {
      throw new TravelDomainError('invalid_request', 'expectedRevision must be an integer.');
    }
    if (expectedRevision !== revision) {
      throw new TravelDomainError(
        'stale_revision',
        `Itinerary changed since this plan was made. Expected revision ${expectedRevision}, current revision ${revision}.`,
      );
    }
  };

  const requireTripDate = (date: string): void => {
    calendarTimestamp(date);
    if (date < constraints.startDate || date > constraints.endDate) {
      throw new TravelDomainError(
        'invalid_request',
        `Date ${date} is outside the trip window ${constraints.startDate}..${constraints.endDate}.`,
      );
    }
  };

  /** A stay occupies every night from check-in; checkout must still land in the window. */
  const requireStaySpan = (date: string, nights: number): void => {
    if (!Number.isInteger(nights) || nights < 1) {
      throw new TravelDomainError('invalid_request', 'nights must be an integer of at least 1.');
    }
    const checkout = addDays(date, nights);
    if (checkout > constraints.endDate) {
      throw new TravelDomainError(
        'invalid_request',
        `A ${nights}-night stay from ${date} checks out on ${checkout}, past the trip end ${constraints.endDate}.`,
      );
    }
  };

  const findItem = (itemId: string): ItineraryItem => {
    const found = items.find((item) => item.id === itemId);
    if (found === undefined) {
      throw new TravelDomainError('not_found', `No itinerary item with id ${itemId}.`);
    }
    return found;
  };

  const buildItem = (request: AddItemRequest): ItineraryItem => {
    requireTripDate(request.date);
    const id = `it-${nextItemNumber}`;

    if (request.kind === 'flight') {
      const flight = FLIGHTS.find((entry) => entry.id === request.flightId);
      if (flight === undefined) {
        throw new TravelDomainError('not_found', `No flight with id ${request.flightId}.`);
      }
      // A flight departs when the timetable says it departs, not when the plan wants it to.
      if (request.date !== flight.departureDate) {
        throw new TravelDomainError(
          'invalid_request',
          `Flight ${flight.id} departs on ${flight.departureDate}, not ${request.date}.`,
        );
      }
      if (constraints.avoidRedEyeFlights && flight.redEye) {
        throw new TravelDomainError(
          'invalid_request',
          `Flight ${flight.id} is a red-eye departure and this trip avoids them.`,
        );
      }
      return deepFreezeItem({
        id,
        kind: 'flight',
        date: request.date,
        priceInr: flight.priceInr,
        label: `${flight.carrier} ${flight.originCode}-${flight.destinationCode}`,
        flightId: flight.id,
      });
    }

    if (request.kind === 'stay') {
      const stay = STAYS.find((entry) => entry.id === request.stayId);
      if (stay === undefined) {
        throw new TravelDomainError('not_found', `No stay with id ${request.stayId}.`);
      }
      requireStaySpan(request.date, request.nights);
      return deepFreezeItem({
        id,
        kind: 'stay',
        date: request.date,
        priceInr: stay.pricePerNightInr * request.nights,
        label: `${stay.name} x${request.nights} nights`,
        stayId: stay.id,
        cityId: stay.cityId,
        nights: request.nights,
      });
    }

    const activity = ACTIVITIES.find((entry) => entry.id === request.activityId);
    if (activity === undefined) {
      throw new TravelDomainError('not_found', `No activity with id ${request.activityId}.`);
    }
    return deepFreezeItem({
      id,
      kind: 'activity',
      date: request.date,
      priceInr: activity.priceInr,
      label: activity.name,
      activityId: activity.id,
      cityId: activity.cityId,
    });
  };

  const commit = (next: readonly ItineraryItem[]): void => {
    items = freezeItems(next);
    nextItemNumber = Math.max(nextItemNumber, highestGeneratedNumber(items) + 1);
    revision += 1;
  };

  return {
    getState: snapshot,

    getBudgetSummary: () => {
      const byKind: Record<ItineraryItemKind, number> = { activity: 0, flight: 0, stay: 0 };
      let committedInr = 0;
      for (const item of items) {
        byKind[item.kind] += item.priceInr;
        committedInr += item.priceInr;
      }
      return Object.freeze({
        budgetInr: constraints.budgetInr,
        committedInr,
        remainingInr: constraints.budgetInr - committedInr,
        overBudget: committedInr > constraints.budgetInr,
        byKind: Object.freeze(byKind),
      });
    },

    addItem: (expectedRevision, request) => {
      requireFresh(expectedRevision);
      const item = buildItem(request);
      nextItemNumber += 1;
      commit([...items, item]);
      return item;
    },

    removeItem: (expectedRevision, itemId) => {
      requireFresh(expectedRevision);
      const item = findItem(itemId);
      commit(items.filter((entry) => entry.id !== itemId));
      return item;
    },

    moveItem: (expectedRevision, itemId, toDate) => {
      requireFresh(expectedRevision);
      const item = findItem(itemId);
      requireTripDate(toDate);
      if (item.kind === 'flight') {
        throw new TravelDomainError(
          'invalid_request',
          `Flight ${item.flightId} cannot be moved; its date comes from the timetable. Remove it and stage a different flight.`,
        );
      }
      if (item.kind === 'stay') requireStaySpan(toDate, item.nights);
      const moved = deepFreezeItem({ ...item, date: toDate });
      commit(items.map((entry) => (entry.id === itemId ? moved : entry)));
      return moved;
    },

    editAsHuman: (change) => {
      const next = change(items);
      if (!Array.isArray(next)) {
        throw new TravelDomainError('invalid_request', 'A human edit must return an itinerary array.');
      }
      commit(next);
      return snapshot();
    },
  };
}
