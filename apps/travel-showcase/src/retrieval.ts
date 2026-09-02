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
    const removalIntent = classifyItemRemoval(context.goal);
    const explicitItemRemoval = removalIntent === 'singular';
    const successfulTools = new Set(context.history.filter(({ ok }) => ok).map(({ tool }) => tool));
    const eligible = rankEligibleTools(context).filter((name) => {
      if (removalIntent === 'unsupported' && name.endsWith('_itinerary_item')) return false;
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
  if (classifyItemRemoval(goal) === 'singular') {
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

  const wantsActivity = mentions(/\b(activit|culture|experience)\w*\b/);
  const explicitStay = mentions(/\b(stay|hotel|accommodation|lodging)\w*\b/);
  const explicitFlight = mentions(/\b(flight|fly|airfare|outbound|return|red[- ]?eye)\w*\b/);
  const planningVerb = mentions(/\b(build|prepare|plan)\b/);
  const explicitDomainCount = [wantsActivity, explicitStay, explicitFlight].filter(Boolean).length;
  const fullTripPlan = planningVerb
    && mentions(/\b(?:build|prepare|plan)\b(?:(?!\b(?:activit|culture|experience|flight|fly|airfare|outbound|return|red[- ]?eye|stay|hotel|accommodation|lodging)\w*\b).){0,48}\b(?:holiday|itinerary|journey|tour|trip|vacation)\b/);
  const multiDomainPlan = planningVerb && explicitDomainCount > 1;
  const wantsStay = fullTripPlan || explicitStay;
  const wantsFlight = fullTripPlan || explicitFlight;
  const wantsBudget = mentions(/\b(budget|cap|cost|price|spend|left)\w*\b/);

  if ((fullTripPlan || multiDomainPlan) && wantsFlight && wantsStay) {
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

function classifyItemRemoval(goal: string): 'none' | 'singular' | 'unsupported' {
  const normalized = goal.toLowerCase();
  if (/\bclose\s+(?:(?:my|our|the|this)\s+)?account\b/.test(normalized)) return 'unsupported';
  const clauses = normalized.split(/(?:[.!?;]|\bbut\b|\bthen\b)/);
  let singular = false;
  let unsupported = false;
  for (const clause of clauses) {
    const command = clause.trim().replace(
      /^(?:(?:please,?\s+)|(?:(?:can|could|will|would)\s+you\s+(?:please\s+)?)|(?:i\s+(?:need|want)\s+(?:you\s+)?to\s+(?:please\s+)?)|(?:i(?:['’]d|\s+would)\s+like\s+(?:you\s+)?to\s+)|(?:help\s+me\s+(?:to\s+)?))?(?:just\s+)?/,
      '',
    );
    const match = /^(?:remove|delete|drop)\b\s+(.+)$/.exec(command);
    if (match === null) continue;
    const target = match[1];
    if (target === undefined) continue;
    if (/^(?:all|both|every|multiple|no|not|nothing|several|two|three|0|[2-9]|\d{2,})\b/.test(target)) {
      unsupported = true;
      continue;
    }
    if (/^(?:(?:my|our|the|this)\s+)?(?:(?:all|entire|whole)\s+)?(?:account|itinerary|trip)\b(?!\s+item\b)/.test(target)) {
      unsupported = true;
      continue;
    }
    if (/\b(?:items|flights|stays|hotels|accommodations|lodgings|activities|experiences)\b/.test(target)) {
      unsupported = true;
      continue;
    }
    const singularTargets = target.match(/\b(?:itinerary\s+item|trip\s+item|item|flight|stay|hotel|accommodation|lodging|activity|experience)\b/g) ?? [];
    if (singularTargets.length === 1) singular = true;
    else unsupported = true;
  }
  if (unsupported) return 'unsupported';
  return singular ? 'singular' : 'none';
}

function uniqueNames(names: readonly string[]): string[] {
  return [...new Set(names)];
}
