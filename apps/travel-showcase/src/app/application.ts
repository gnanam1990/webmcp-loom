import { createTripStore } from '../state.js';
import { createTravelTools } from '../tools.js';
import { createSession } from './session.js';
import type { RuntimeTool } from '@webmcp-loom/runtime';
import type { TripStore } from '../state.js';
import type { Session } from './session.js';

export interface TravelApplication {
  readonly session: Session;
  readonly store: TripStore;
  readonly tools: readonly RuntimeTool[];
}

/**
 * Creates one store and one canonical tool array for both the in-app runtime
 * and document WebMCP registration. Keeping this wiring in one factory makes
 * it impossible for the two agent entry points to drift onto separate state.
 */
export function createTravelApplication(store: TripStore = createTripStore()): TravelApplication {
  const tools = Object.freeze(createTravelTools(store));
  return Object.freeze({
    store,
    tools,
    session: createSession(store, tools),
  });
}
