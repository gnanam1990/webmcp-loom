import { createTripStore } from '../state.js';
import { createTravelTools } from '../tools.js';
import { SCRIPTED_BACKEND, createSession } from './session.js';
import type { RuntimeTool } from '@webmcp-loom/runtime';
import type { TripStore } from '../state.js';
import type { BackendState, Session, SessionModelFactory } from './session.js';

export interface TravelApplicationOptions {
  backend?: BackendState;
  createModel?: SessionModelFactory;
}

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
export function createTravelApplication(
  store: TripStore = createTripStore(),
  options: TravelApplicationOptions = {},
): TravelApplication {
  const tools = Object.freeze(createTravelTools(store));
  return Object.freeze({
    store,
    tools,
    session: createSession(
      store,
      tools,
      options.backend ?? { status: 'ready', backend: SCRIPTED_BACKEND },
      options.createModel,
    ),
  });
}
