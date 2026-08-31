/**
 * Deterministic Japan travel domain.
 *
 * Every monetary value is a whole number of Indian rupees. Every date is an
 * ISO `YYYY-MM-DD` calendar day in Asia/Tokyo local time. Neither carries a
 * floating-point value, so budget arithmetic and stale-state comparisons stay
 * exact and reproducible across runs.
 */

export type CityId = 'hakone' | 'kyoto' | 'nara' | 'osaka' | 'tokyo';

export type ItineraryItemKind = 'activity' | 'flight' | 'stay';

export type ActivityTag = 'culture' | 'food' | 'nature' | 'nightlife' | 'shopping';

export interface Destination {
  id: CityId;
  name: string;
  region: string;
  /** Shown in the UI so a person can judge a redistribution before approving it. */
  suggestedNights: number;
}

export interface Flight {
  id: string;
  carrier: string;
  originCode: string;
  destinationCode: string;
  departureDate: string;
  departureTime: string;
  arrivalTime: string;
  priceInr: number;
  /**
   * True when the flight departs between 21:00 and 05:00. The hero goal rejects
   * these, so the flag is part of the inventory rather than a derived guess.
   */
  redEye: boolean;
}

export interface Stay {
  id: string;
  cityId: CityId;
  name: string;
  pricePerNightInr: number;
  rating: number;
  walkMinutesToStation: number;
}

export interface Activity {
  id: string;
  cityId: CityId;
  name: string;
  priceInr: number;
  durationMinutes: number;
  tags: readonly ActivityTag[];
}

interface ItineraryItemBase {
  id: string;
  date: string;
  priceInr: number;
  /** Denormalised so the UI can label an item without a second lookup. */
  label: string;
}

export type ItineraryItem =
  | (ItineraryItemBase & { kind: 'activity'; activityId: string; cityId: CityId })
  | (ItineraryItemBase & { kind: 'flight'; flightId: string })
  | (ItineraryItemBase & { kind: 'stay'; stayId: string; cityId: CityId; nights: number });

export interface TripConstraints {
  budgetInr: number;
  startDate: string;
  endDate: string;
  totalDays: number;
  originCode: string;
  mustKeepCities: readonly CityId[];
  avoidRedEyeFlights: boolean;
  /**
   * Always false. The showcase stages plans; it never books. This is stated as
   * data so the agent can read the boundary rather than infer it from prose.
   */
  bookingEnabled: false;
}

export interface BudgetSummary {
  budgetInr: number;
  committedInr: number;
  remainingInr: number;
  overBudget: boolean;
  byKind: Readonly<Record<ItineraryItemKind, number>>;
}

/**
 * `revision` increments on every accepted write. The runtime captures it before
 * a model step and passes it back on execution, so a human edit landing mid-run
 * makes the agent's decision stale instead of silently overwriting the person.
 */
export interface TripState {
  revision: number;
  constraints: TripConstraints;
  items: readonly ItineraryItem[];
}
