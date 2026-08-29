/**
 * The collaboration session.
 *
 * Owns the trip store, the tool surface and the runtime invocation, and turns
 * `AgentEvent`s into trace lines that name real application entities. Holds no
 * DOM references, so the whole collaboration loop — run, approve, deny, human
 * edit, stale rejection — is testable without rendering anything.
 *
 * Approval is a promise the session holds open. The runtime pauses inside
 * `approve` until the person decides, so an approved run continues in place
 * rather than restarting from a fresh call.
 */

import { runAgentRuntime } from '@webmcp-loom/runtime';
import { ACTIVITIES, DESTINATIONS, FLIGHTS, STAYS } from '../inventory.js';
import { createTripStore } from '../state.js';
import { createTravelTools } from '../tools.js';
import { HERO_SCRIPT, REPAIR_SCRIPT, createScriptedModel } from './scripted-model.js';
import type {
  AgentApprovalRequest,
  AgentEvent,
  JsonObject,
  RuntimeTool,
} from '@webmcp-loom/runtime';
import type { TripStore } from '../state.js';
import type { BudgetSummary, ItineraryItem, TripState } from '../types.js';

export type SessionStatus =
  | 'awaiting_approval'
  | 'cancelled'
  | 'completed'
  | 'denied'
  | 'failed'
  | 'idle'
  | 'running'
  | 'stale'
  | 'step_limit';

export type TraceLineState = 'awaiting_approval' | 'failed' | 'running' | 'succeeded';

export interface TraceLine {
  step: number;
  toolName: string;
  /** Human phrasing that names the entity, not the tool. */
  label: string;
  state: TraceLineState;
  detail?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  trip: TripState;
  budget: BudgetSummary;
  trace: readonly TraceLine[];
  pendingApproval: AgentApprovalRequest | null;
  progress: { currentStep: number; maximumSteps: number } | null;
  /** Final message, denial note, or the reason a run stopped. */
  note: string | null;
}

export interface Session {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  run(goal: string): Promise<void>;
  approve(): void;
  deny(): void;
  cancel(): void;
  /** A human edit from the board. Applies unconditionally and moves the revision. */
  removeItem(itemId: string): void;
  reset(): void;
}

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const MAX_AGENT_STEPS = 6;

function money(value: number): string {
  return `₹${INR.format(value)}`;
}

function cityName(cityId: unknown): string {
  const found = DESTINATIONS.find((entry) => entry.id === cityId);
  return found?.name ?? String(cityId);
}

function readString(input: JsonObject, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(input: JsonObject, key: string): number | undefined {
  const value = input[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Turns a validated tool call into a line a traveller can audit.
 *
 * The contract requires the trace to name the affected entity rather than the
 * tool, so a developer can still map a line to a call while a person reads it
 * as a description of what happened to their trip.
 */
export function describeCall(
  toolName: string,
  input: JsonObject,
  items: readonly ItineraryItem[] = [],
): string {
  switch (toolName) {
    case 'get_trip_constraints':
      return 'Reading the trip budget and constraints';
    case 'get_itinerary':
      return 'Reading the current itinerary';
    case 'get_budget_summary':
      return 'Checking the budget';
    case 'list_destinations':
      return 'Listing available destinations';
    case 'search_flights': {
      const origin = readString(input, 'originCode');
      const excluding = input.excludeRedEye === true ? ', excluding red-eyes' : '';
      return `Searching flights${origin === undefined ? '' : ` from ${origin}`}${excluding}`;
    }
    case 'search_stays': {
      const cap = readNumber(input, 'maxPricePerNightInr');
      const capText = cap === undefined ? '' : ` under ${money(cap)} a night`;
      return `Searching stays in ${cityName(input.cityId)}${capText}`;
    }
    case 'search_activities':
      return `Searching activities in ${cityName(input.cityId)}`;
    case 'add_itinerary_item': {
      const refId = readString(input, 'refId') ?? '';
      const nights = readNumber(input, 'nights');
      const flight = FLIGHTS.find((entry) => entry.id === refId);
      if (flight !== undefined) {
        return `Staging ${flight.carrier} ${flight.originCode}–${flight.destinationCode} for ${money(flight.priceInr)}`;
      }
      const stay = STAYS.find((entry) => entry.id === refId);
      if (stay !== undefined && nights !== undefined) {
        return `Staging ${stay.name}, ${nights} nights, ${money(stay.pricePerNightInr * nights)}`;
      }
      const activity = ACTIVITIES.find((entry) => entry.id === refId);
      if (activity !== undefined) {
        return `Staging ${activity.name} for ${money(activity.priceInr)}`;
      }
      return `Staging ${refId}`;
    }
    case 'remove_itinerary_item': {
      const itemId = readString(input, 'itemId');
      const item = items.find((entry) => entry.id === itemId);
      return `Removing ${item?.label ?? itemId ?? 'an item'} from the plan`;
    }
    case 'move_itinerary_item': {
      const itemId = readString(input, 'itemId');
      const item = items.find((entry) => entry.id === itemId);
      return `Moving ${item?.label ?? itemId ?? 'an item'} to ${readString(input, 'toDate') ?? 'another day'}`;
    }
    default:
      return toolName;
  }
}

/**
 * Picks the scripted plan for this turn.
 *
 * A real model reads the goal. The scripted stand-in cannot, so it branches on
 * whether a plan already exists: the first run builds, a later run repairs.
 * This is the one place the stand-in is obviously not a model, and it is
 * confined here so swapping in a real adapter deletes only this function.
 */
function scriptFor(trip: TripState): readonly typeof HERO_SCRIPT[number][] {
  return trip.items.length === 0 ? HERO_SCRIPT : REPAIR_SCRIPT;
}

export function createSession(
  store: TripStore = createTripStore(),
  tools: readonly RuntimeTool[] = createTravelTools(store),
): Session {
  const listeners = new Set<() => void>();

  let status: SessionStatus = 'idle';
  let trace: TraceLine[] = [];
  let note: string | null = null;
  let pending: { request: AgentApprovalRequest; settle: (approved: boolean) => void } | null = null;
  let controller: AbortController | null = null;
  let currentStep = 0;

  /**
   * Snapshots are cached and rebuilt only when something changed. React's
   * `useSyncExternalStore` compares snapshot identity, so returning a fresh
   * object on every read would re-render without end.
   */
  let cached: SessionSnapshot | null = null;

  const emit = (): void => {
    cached = null;
    for (const listener of listeners) listener();
  };
  store.subscribe(emit);

  const setLineState = (step: number, state: TraceLineState, detail?: string): void => {
    trace = trace.map((line) => (
      line.step === step
        ? { ...line, state, ...(detail === undefined ? {} : { detail }) }
        : line
    ));
  };

  const onEvent = (event: AgentEvent): void => {
    currentStep = event.step;
    switch (event.type) {
      case 'tool_call_validated':
        trace = [...trace, {
          step: event.step,
          toolName: event.toolName,
          label: describeCall(event.toolName, event.input, store.getState().items),
          state: 'running',
        }];
        break;
      case 'approval_required':
        setLineState(event.step, 'awaiting_approval');
        break;
      case 'tool_succeeded':
        setLineState(event.step, 'succeeded');
        break;
      case 'tool_failed':
        setLineState(event.step, 'failed', event.error);
        break;
      case 'denied':
        setLineState(event.step, 'failed', 'You declined this change.');
        break;
      case 'stale_state':
        setLineState(event.step, 'failed', 'The plan changed while the agent was working.');
        break;
      case 'cancelled':
        setLineState(event.step, 'failed', 'Run stopped by you.');
        break;
      default:
        break;
    }
    emit();
  };

  const finish = (next: SessionStatus, message: string | null): void => {
    status = next;
    note = message;
    pending = null;
    controller = null;
    emit();
  };

  return {
    getSnapshot: (): SessionSnapshot => {
      cached ??= {
        status,
        trip: store.getState(),
        budget: store.getBudgetSummary(),
        trace,
        pendingApproval: pending?.request ?? null,
        progress: status === 'running' || status === 'awaiting_approval'
          ? { currentStep, maximumSteps: MAX_AGENT_STEPS }
          : null,
        note,
      };
      return cached;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    run: async (goal: string): Promise<void> => {
      if (status === 'running' || status === 'awaiting_approval') return;
      trace = [];
      note = null;
      status = 'running';
      controller = new AbortController();
      currentStep = 1;
      emit();

      const model = createScriptedModel(scriptFor(store.getState()));

      try {
        const result = await runAgentRuntime({
          goal,
          model,
          toolProvider: { getTools: () => tools },
          getStateRevision: () => store.getState().revision,
          signal: controller.signal,
          maxSteps: MAX_AGENT_STEPS,
          onEvent,
          approve: (request) => new Promise<boolean>((resolve) => {
            pending = {
              request,
              settle: (approved) => {
                pending = null;
                resolve(approved);
              },
            };
            status = 'awaiting_approval';
            emit();
          }).then((approved) => {
            status = 'running';
            emit();
            return approved;
          }),
        });

        switch (result.status) {
          case 'completed':
            finish('completed', result.message);
            break;
          case 'denied':
            finish(
              'denied',
              'The declined change was not written. Anything already approved remains on the board.',
            );
            break;
          case 'stale_state':
            finish(
              'stale',
              `You changed the plan while the agent was working, so it stopped instead of overwriting you. It planned against revision ${result.expectedRevision}; the plan is now at ${result.currentRevision}. Run it again to work from the current plan.`,
            );
            break;
          case 'cancelled':
            finish('cancelled', 'Run stopped. Anything already approved is still on the board.');
            break;
          case 'step_limit':
            finish('step_limit', 'The agent reached its step limit before finishing.');
            break;
          case 'write_failed':
            finish('failed', `A change could not be completed: ${result.error}`);
            break;
          case 'approval_required':
            finish('failed', 'The run paused for approval without an approval handler.');
            break;
        }
      } catch (error) {
        finish('failed', error instanceof Error ? error.message : 'The run failed.');
      }
    },

    approve: () => pending?.settle(true),
    deny: () => pending?.settle(false),
    cancel: () => {
      controller?.abort();
      // Settle the held approval promise as well as aborting the runtime race,
      // so cancellation cannot leave the original promise and abort listener alive.
      pending?.settle(false);
    },

    removeItem: (itemId: string) => {
      store.editAsHuman((items) => items.filter((item) => item.id !== itemId));
    },

    reset: () => {
      if (status === 'running' || status === 'awaiting_approval') return;
      trace = [];
      note = null;
      status = 'idle';
      emit();
    },
  };
}
