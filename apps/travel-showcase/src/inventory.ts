/**
 * Fixed demo inventory.
 *
 * Nothing here is fetched, randomised, or time-dependent, so a benchmark task
 * and a live demo see identical data. Prices are chosen so the hero goal
 * (10 days, two cities, under the budget cap) is satisfiable but not trivially
 * so: the cheapest combination clears the cap with room to spare, while the
 * comfortable combination does not.
 */

import type { Activity, Destination, Flight, Stay, TripConstraints } from './types.js';

/** Freezes each entry and the array without widening the annotated element type. */
function deepFreeze<T>(items: readonly T[]): readonly T[] {
  for (const entry of items) Object.freeze(entry);
  return Object.freeze(items);
}

export const HERO_TRIP_CONSTRAINTS: TripConstraints = Object.freeze({
  budgetInr: 150_000,
  startDate: '2026-11-05',
  endDate: '2026-11-14',
  totalDays: 10,
  originCode: 'BLR',
  mustKeepCities: Object.freeze(['tokyo', 'kyoto'] as const),
  avoidRedEyeFlights: true,
  bookingEnabled: false,
});

export const DESTINATIONS: readonly Destination[] = deepFreeze([
  { id: 'tokyo', name: 'Tokyo', region: 'Kanto', suggestedNights: 4 },
  { id: 'hakone', name: 'Hakone', region: 'Kanto', suggestedNights: 1 },
  { id: 'kyoto', name: 'Kyoto', region: 'Kansai', suggestedNights: 3 },
  { id: 'nara', name: 'Nara', region: 'Kansai', suggestedNights: 1 },
  { id: 'osaka', name: 'Osaka', region: 'Kansai', suggestedNights: 2 },
]);

export const FLIGHTS: readonly Flight[] = deepFreeze([
  {
    id: 'fl-blr-hnd-morning',
    carrier: 'Nihon Air',
    originCode: 'BLR',
    destinationCode: 'HND',
    departureDate: '2026-11-05',
    departureTime: '07:15',
    arrivalTime: '19:05',
    priceInr: 41_900,
    redEye: false,
  },
  {
    id: 'fl-blr-nrt-day',
    carrier: 'Sakura Airways',
    originCode: 'BLR',
    destinationCode: 'NRT',
    departureDate: '2026-11-05',
    departureTime: '09:40',
    arrivalTime: '21:10',
    priceInr: 38_500,
    redEye: false,
  },
  {
    id: 'fl-blr-nrt-redeye',
    carrier: 'Sakura Airways',
    originCode: 'BLR',
    destinationCode: 'NRT',
    departureDate: '2026-11-05',
    departureTime: '23:55',
    arrivalTime: '11:20',
    priceInr: 31_200,
    redEye: true,
  },
  {
    id: 'fl-kix-blr-day',
    carrier: 'Kansai Connect',
    originCode: 'KIX',
    destinationCode: 'BLR',
    departureDate: '2026-11-14',
    departureTime: '10:30',
    arrivalTime: '16:45',
    priceInr: 36_800,
    redEye: false,
  },
  {
    id: 'fl-kix-blr-redeye',
    carrier: 'Kansai Connect',
    originCode: 'KIX',
    destinationCode: 'BLR',
    departureDate: '2026-11-14',
    departureTime: '01:05',
    arrivalTime: '07:30',
    priceInr: 29_400,
    redEye: true,
  },
  {
    id: 'fl-nrt-blr-day',
    carrier: 'Sakura Airways',
    originCode: 'NRT',
    destinationCode: 'BLR',
    departureDate: '2026-11-14',
    departureTime: '11:50',
    arrivalTime: '18:20',
    priceInr: 39_600,
    redEye: false,
  },
]);

export const STAYS: readonly Stay[] = deepFreeze([
  { id: 'st-tok-capsule', cityId: 'tokyo', name: 'Shinjuku Capsule Loft', pricePerNightInr: 3_200, rating: 4.1, walkMinutesToStation: 4 },
  { id: 'st-tok-mid', cityId: 'tokyo', name: 'Asakusa Riverside Inn', pricePerNightInr: 6_400, rating: 4.5, walkMinutesToStation: 7 },
  { id: 'st-tok-high', cityId: 'tokyo', name: 'Marunouchi Tower Hotel', pricePerNightInr: 11_800, rating: 4.8, walkMinutesToStation: 3 },
  { id: 'st-kyo-budget', cityId: 'kyoto', name: 'Gion Guesthouse', pricePerNightInr: 2_900, rating: 4.0, walkMinutesToStation: 9 },
  { id: 'st-kyo-mid', cityId: 'kyoto', name: 'Higashiyama Machiya', pricePerNightInr: 5_600, rating: 4.4, walkMinutesToStation: 6 },
  { id: 'st-kyo-ryokan', cityId: 'kyoto', name: 'Arashiyama Ryokan', pricePerNightInr: 8_900, rating: 4.7, walkMinutesToStation: 12 },
  { id: 'st-osa-budget', cityId: 'osaka', name: 'Namba Pod Stay', pricePerNightInr: 2_600, rating: 3.9, walkMinutesToStation: 8 },
  { id: 'st-osa-mid', cityId: 'osaka', name: 'Dotonbori Central', pricePerNightInr: 4_800, rating: 4.3, walkMinutesToStation: 5 },
  { id: 'st-hak-onsen', cityId: 'hakone', name: 'Hakone Onsen Lodge', pricePerNightInr: 7_400, rating: 4.6, walkMinutesToStation: 14 },
]);

export const ACTIVITIES: readonly Activity[] = deepFreeze([
  { id: 'ac-tok-teamlab', cityId: 'tokyo', name: 'teamLab Planets', priceInr: 2_400, durationMinutes: 180, tags: Object.freeze(['culture'] as const) },
  { id: 'ac-tok-tsukiji', cityId: 'tokyo', name: 'Tsukiji Outer Market walk', priceInr: 1_900, durationMinutes: 150, tags: Object.freeze(['food'] as const) },
  { id: 'ac-tok-shibuya', cityId: 'tokyo', name: 'Shibuya night crossing tour', priceInr: 1_200, durationMinutes: 120, tags: Object.freeze(['nightlife'] as const) },
  { id: 'ac-tok-akihabara', cityId: 'tokyo', name: 'Akihabara electronics run', priceInr: 900, durationMinutes: 120, tags: Object.freeze(['shopping'] as const) },
  { id: 'ac-kyo-fushimi', cityId: 'kyoto', name: 'Fushimi Inari torii climb', priceInr: 0, durationMinutes: 180, tags: Object.freeze(['culture', 'nature'] as const) },
  { id: 'ac-kyo-bamboo', cityId: 'kyoto', name: 'Arashiyama bamboo grove', priceInr: 700, durationMinutes: 150, tags: Object.freeze(['nature'] as const) },
  { id: 'ac-kyo-tea', cityId: 'kyoto', name: 'Private tea ceremony', priceInr: 3_100, durationMinutes: 90, tags: Object.freeze(['culture'] as const) },
  { id: 'ac-kyo-nishiki', cityId: 'kyoto', name: 'Nishiki Market tasting', priceInr: 1_500, durationMinutes: 120, tags: Object.freeze(['food'] as const) },
  { id: 'ac-osa-dotonbori', cityId: 'osaka', name: 'Dotonbori street food crawl', priceInr: 1_800, durationMinutes: 150, tags: Object.freeze(['food', 'nightlife'] as const) },
  { id: 'ac-osa-castle', cityId: 'osaka', name: 'Osaka Castle grounds', priceInr: 800, durationMinutes: 120, tags: Object.freeze(['culture'] as const) },
  { id: 'ac-nar-deer', cityId: 'nara', name: 'Nara deer park day trip', priceInr: 1_400, durationMinutes: 240, tags: Object.freeze(['nature'] as const) },
  { id: 'ac-hak-onsen', cityId: 'hakone', name: 'Hakone onsen and ropeway', priceInr: 5_200, durationMinutes: 300, tags: Object.freeze(['nature'] as const) },
]);
