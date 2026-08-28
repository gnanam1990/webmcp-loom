/**
 * Shared trip state.
 *
 * The same store backs the human UI and the agent's tools. Human edits are
 * authoritative and apply unconditionally; agent writes must present the
 * revision they were planned against and are rejected if the person changed
 * anything in the meantime. That compare-and-swap is what makes the runtime's
 * optimistic stale-state check meaningful — a preflight read alone cannot make
 * an asynchronous write atomic.
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

export function createTripStore(
  constraints: TripConstraints = HERO_TRIP_CONSTRAINTS,
  initialItems: readonly ItineraryItem[] = [],
): TripStore {
  let revision = 1;
  let items: readonly ItineraryItem[] = Object.freeze([...initialItems]);
  let nextItemNumber = initialItems.length + 1;

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
    if (typeof date !== 'string' || !ISO_DATE.test(date)) {
      throw new TravelDomainError('invalid_request', `Date must be an ISO YYYY-MM-DD value: ${date}`);
    }
    if (date < constraints.startDate || date > constraints.endDate) {
      throw new TravelDomainError(
        'invalid_request',
        `Date ${date} is outside the trip window ${constraints.startDate}..${constraints.endDate}.`,
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
      return Object.freeze({
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
      if (!Number.isInteger(request.nights) || request.nights < 1) {
        throw new TravelDomainError('invalid_request', 'nights must be an integer of at least 1.');
      }
      return Object.freeze({
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
    return Object.freeze({
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
    items = Object.freeze([...next]);
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
      const moved = Object.freeze({ ...item, date: toDate });
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
