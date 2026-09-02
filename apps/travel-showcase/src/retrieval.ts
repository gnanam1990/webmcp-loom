import { createDeterministicToolSelector } from '@webmcp-loom/model-adapters/retrieval';
import type {
  RuntimeToolSelector,
  RuntimeToolSelectorContext,
} from '@webmcp-loom/runtime';

/** Bound into benchmark metadata before any retrieval-assisted model claim. */
export const TRAVEL_RETRIEVAL_PROFILE = Object.freeze({
  id: 'travel-deterministic-v1',
  maxTools: 4,
} as const);

const TRAVEL_SYNONYM_GROUPS = [
  ['trip', 'itinerary', 'plan'],
  ['stay', 'hotel', 'accommodation', 'lodging'],
  ['flight', 'fly', 'airfare', 'outbound', 'return'],
  ['activity', 'experience', 'culture'],
  ['move', 'reschedule', 'shift'],
  ['remove', 'delete', 'drop'],
  ['stage', 'add', 'include'],
  ['budget', 'price', 'cost', 'spend', 'cap'],
  ['destination', 'city'],
  ['inspect', 'read', 'show', 'list', 'get'],
  ['search', 'find', 'look'],
] as const;

/** The page-owned retrieval profile used by the in-app travel collaborator. */
export function createTravelToolSelector(): RuntimeToolSelector {
  const rankEligibleTools = createDeterministicToolSelector({
    maxTools: 20,
    synonymGroups: TRAVEL_SYNONYM_GROUPS,
  });
  return (context) => {
    const explicitItemRemoval = hasExplicitItemRemoval(context.goal);
    const successfulTools = new Set(context.history.filter(({ ok }) => ok).map(({ tool }) => tool));
    const eligible = rankEligibleTools(context).filter((name) => {
      if (name === 'add_itinerary_item') {
        return ['search_activities', 'search_flights', 'search_stays']
          .some((source) => successfulTools.has(source));
      }
      if (name === 'remove_itinerary_item') {
        return explicitItemRemoval && successfulTools.has('get_itinerary');
      }
      if (name === 'move_itinerary_item') {
        return successfulTools.has('get_itinerary');
      }
      return true;
    });
    const eligibleNames = new Set(eligible);
    return uniqueNames([
      ...travelPriorities(context),
      ...eligible,
    ]).filter((name) => eligibleNames.has(name)).slice(0, TRAVEL_RETRIEVAL_PROFILE.maxTools);
  };
}

function travelPriorities(context: RuntimeToolSelectorContext): readonly string[] {
  const goal = context.goal.toLowerCase();
  const successful = context.history.filter(({ ok }) => ok);
  const last = successful.at(-1)?.tool;
  const has = (toolName: string): boolean => successful.some(({ tool }) => tool === toolName);
  const staged = (kind: string): boolean => successful.some((entry) => (
    entry.tool === 'add_itinerary_item' && entry.input.kind === kind
  ));
  const mentions = (pattern: RegExp): boolean => pattern.test(goal);

  if (mentions(/\b(move|reschedule|shift)\b/)) {
    return has('get_itinerary')
      ? ['move_itinerary_item', 'get_itinerary']
      : ['get_itinerary'];
  }
  if (hasExplicitItemRemoval(goal)) {
    return has('get_itinerary')
      ? ['remove_itinerary_item', 'get_itinerary']
      : ['get_itinerary'];
  }

  const wantsCurrentItinerary = mentions(/(?:\bcurrent\s+(?:itinerary|trip)\b|\bwhat\s+is\s+planned\b|\blook\s+at\s+what\s+is\s+planned\b)/);
  if (wantsCurrentItinerary && !has('get_itinerary')) {
    return ['get_itinerary', 'get_budget_summary', 'search_activities', 'search_stays'];
  }

  const isRepair = mentions(/\b(rework|repair|replace|swap|cheaper)\b/);
  if (isRepair) {
    if (!has('get_itinerary')) return ['get_itinerary', 'get_budget_summary'];
    if (!has('search_stays')) return ['search_stays', 'get_budget_summary', 'get_itinerary'];
    if (last === 'search_stays') return ['add_itinerary_item', 'search_stays', 'get_itinerary'];
  }

  const scopedPlan = mentions(/\b(?:build|prepare|plan)\s+(?:(?:a|an|my|our|the|this)\s+)?(?:activit|experience|flight|hotel|stay)\w*\b/);
  const wantsPlan = !scopedPlan
    && mentions(/\b(?:build|prepare|plan)\b.{0,48}\b(?:holiday|itinerary|journey|tour|trip|vacation)\b/);
  const wantsActivity = mentions(/\b(activit|culture|experience)\w*\b/);
  const wantsStay = wantsPlan || mentions(/\b(stay|hotel|accommodation|lodging)\w*\b/);
  const wantsFlight = wantsPlan || mentions(/\b(flight|fly|airfare|outbound|return|red[- ]?eye)\w*\b/);
  const wantsBudget = mentions(/\b(budget|cap|cost|price|spend|left)\w*\b/);

  if (wantsPlan && wantsFlight && wantsStay) {
    if (!has('get_trip_constraints')) {
      return ['get_trip_constraints', 'search_flights', 'search_stays', 'list_destinations'];
    }
    if (!has('search_flights')) return ['search_flights', 'search_stays', 'get_trip_constraints'];
    if (last === 'search_flights') return ['add_itinerary_item', 'search_stays', 'search_flights'];
    if (!staged('flight')) return ['add_itinerary_item', 'search_flights', 'search_stays'];
    if (!has('search_stays')) return ['search_stays', 'get_budget_summary', 'add_itinerary_item'];
    if (last === 'search_stays' || !staged('stay')) {
      return ['add_itinerary_item', 'search_stays', 'get_budget_summary'];
    }
  }

  if (wantsBudget && !has('get_budget_summary') && (wantsActivity || !wantsFlight)) {
    return ['get_budget_summary', ...(wantsActivity ? ['search_activities'] : [])];
  }
  if (wantsFlight) {
    const needsConstraints = mentions(/\b(trip origin|budget|cap|dates?)\b/);
    if (needsConstraints && !has('get_trip_constraints')) {
      return ['get_trip_constraints', 'search_flights'];
    }
    if (!has('search_flights')) return ['search_flights', 'get_trip_constraints'];
    if (last === 'search_flights') return ['add_itinerary_item', 'search_flights'];
  }
  if (wantsStay || isRepair) {
    if (!has('search_stays')) return ['search_stays', 'get_budget_summary'];
    if (last === 'search_stays') return ['add_itinerary_item', 'search_stays'];
  }
  if (wantsActivity) {
    if (!has('search_activities')) return ['search_activities', 'get_budget_summary'];
    if (last === 'search_activities') return ['add_itinerary_item', 'search_activities'];
  }
  if (mentions(/\b(constraint|booking|origin|date)\w*\b/)) return ['get_trip_constraints'];
  if (mentions(/\b(destination|cities|city)\w*\b/)) return ['list_destinations'];
  return [];
}

function hasExplicitItemRemoval(goal: string): boolean {
  const normalized = goal.toLowerCase();
  if (!/\b(remove|delete|drop)\b/.test(normalized)) return false;
  if (/\bclose\s+(?:(?:my|our|the|this)\s+)?account\b/.test(normalized)) return false;
  if (/\b(?:remove|delete|drop)\s+(?:(?:my|our|the|this)\s+)?(?:(?:all|entire|whole)\s+)?(?:account|itinerary|trip)\b/.test(normalized)) {
    return false;
  }
  return /\b(item|flight|stay|hotel|accommodation|lodging|activity|experience)\w*\b/.test(normalized);
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}
