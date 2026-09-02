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
import { money } from '../format.js';
import { readNumber, readString } from '../input.js';
import { ACTIVITIES, DESTINATIONS, FLIGHTS, STAYS } from '../inventory.js';
import { createTripStore } from '../state.js';
import { createTravelTools } from '../tools.js';
import { createTravelToolSelector } from '../retrieval.js';
import { HERO_SCRIPT, REPAIR_SCRIPT, createScriptedModel } from './scripted-model.js';
import type {
  AgentApprovalRequest,
  AgentEvent,
  JsonObject,
  RuntimeModel,
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

/** How the person would pick this backend, not how the code names it. */
export interface BackendDescriptor {
  id: string;
  label: string;
  kind: 'cloud' | 'local' | 'scripted';
  detail: string;
}

/**
 * Loading and failure are distinct from ready on purpose. A backend that has
 * not finished loading is not the same as one that is ready, and a run started
 * against a loading backend must say so rather than appearing to hang.
 */
export type BackendState =
  | { status: 'failed'; backend: BackendDescriptor; error: string }
  | { status: 'loading'; backend: BackendDescriptor; progress?: number }
  | { status: 'ready'; backend: BackendDescriptor };

export const SCRIPTED_BACKEND: BackendDescriptor = Object.freeze({
  id: 'scripted',
  kind: 'scripted',
  label: 'Scripted',
  detail: 'A deterministic stand-in rather than a language model. The runtime is model-neutral, so a local or cloud backend replaces it without changing this application.',
});

/**
 * What a single undo would reverse.
 *
 * `blockedReason` is non-null when undo is unavailable, so the interface can
 * explain why rather than presenting a control that silently does nothing.
 */
export interface UndoableChange {
  label: string;
  blockedReason: string | null;
}

/**
 * A short-lived cue marking what just changed.
 *
 * `token` increments on every commit so the interface can restart its decay
 * even when the same items change twice in a row. Highlights never carry
 * information that is not also readable from the board and the trace.
 */
export interface HighlightCue {
  itemIds: readonly string[];
  budget: boolean;
  token: number;
}

export interface SessionSnapshot {
  status: SessionStatus;
  trip: TripState;
  budget: BudgetSummary;
  trace: readonly TraceLine[];
  pendingApproval: AgentApprovalRequest | null;
  progress: { currentStep: number; maximumSteps: number } | null;
  backend: BackendState;
  undoable: UndoableChange | null;
  highlight: HighlightCue | null;
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
  /** Replaces only the model provider; store, tools and policy remain canonical. */
  configureBackend(backend: BackendState, createModel?: SessionModelFactory): void;
  /** A human edit from the board. Applies unconditionally and moves the revision. */
  removeItem(itemId: string): void;
  /** A keyboard- or pointer-originated board edit with the same authority. */
  moveItem(itemId: string, toDate: string): void;
  /**
   * Reverses the last committed change, as a human edit.
   *
   * Undo moves the revision forward rather than restoring an older one: a
   * rewound counter would make an already-stale agent decision look fresh
   * again, which is the exact guarantee the store exists to provide. Depth is
   * one step and there is no redo, because redo implies a second history the
   * domain does not model.
   */
  undo(): void;
  reset(): void;
}

/** Model construction stays outside the session so provider loading cannot bypass runtime policy. */
export type SessionModelFactory = (trip: TripState) => RuntimeModel;

export const MAX_AGENT_STEPS = 6;
const selectTravelTools = createTravelToolSelector();

function cityName(cityId: unknown): string {
  const found = DESTINATIONS.find((entry) => entry.id === cityId);
  return found?.name ?? String(cityId);
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

/** Names a committed change in the same terms the trace and the board use. */
function describeChange(
  added: readonly ItineraryItem[],
  removed: readonly ItineraryItem[],
  changed: readonly ItineraryItem[],
  moved: boolean,
): string {
  const first = added[0] ?? changed[0] ?? removed[0];
  const label = first?.label ?? 'the plan';
  const total = added.length + removed.length + changed.length;
  const extra = total > 1 ? ` and ${total - 1} other change${total > 2 ? 's' : ''}` : '';
  if (added.length > 0) return `staging ${label}${extra}`;
  if (changed.length > 0) return `${moved ? 'moving' : 'updating'} ${label}${extra}`;
  return `removing ${label}${extra}`;
}

/** Itinerary items are flat, validated records, so field equality is sufficient. */
function sameItem(left: ItineraryItem, right: ItineraryItem): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length
    && leftEntries.every(([key, value]) => Object.is(value, right[key as keyof ItineraryItem]));
}

export function createSession(
  store: TripStore = createTripStore(),
  tools: readonly RuntimeTool[] = createTravelTools(store),
  initialBackend: BackendState = { status: 'ready', backend: SCRIPTED_BACKEND },
  initialCreateModel: SessionModelFactory = (trip) => createScriptedModel(scriptFor(trip)),
): Session {
  const listeners = new Set<() => void>();

  let status: SessionStatus = 'idle';
  let trace: TraceLine[] = [];
  let note: string | null = null;
  let pending: { request: AgentApprovalRequest; settle: (approved: boolean) => void } | null = null;
  let controller: AbortController | null = null;
  let currentStep = 0;
  let backend = initialBackend;
  let createModel = initialCreateModel;

  let previousItems: readonly ItineraryItem[] = store.getState().items;
  let previousBudget = store.getBudgetSummary();
  let undoTarget: { label: string; items: readonly ItineraryItem[] } | null = null;
  let highlight: HighlightCue | null = null;
  let highlightToken = 0;
  let undoing = false;

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
/**
   * Every accepted commit reaches here — an approved in-app write, a human edit
   * from the board, and an external WebMCP write alike — so undo and the
   * highlight cue behave identically whichever agent caused the change.
   */
  store.subscribe((source) => {
    const current = store.getState().items;
    const byId = (entries: readonly ItineraryItem[]): Map<string, ItineraryItem> => (
      new Map(entries.map((item) => [item.id, item]))
    );
    const before = byId(previousItems);
    const after = byId(current);
    const previousIndex = new Map(previousItems.map((item, index) => [item.id, index]));
    const currentBudget = store.getBudgetSummary();

    const added = current.filter((item) => !before.has(item.id));
    const removed = previousItems.filter((item) => !after.has(item.id));
    // Removing or adding an item naturally shifts later indexes; that is not a
    // reorder of those surviving items. Only compare ordering when membership
    // stayed constant across the commit.
    const membershipChanged = added.length > 0 || removed.length > 0;
    const changed = current.filter((item, index) => {
      const original = before.get(item.id);
      return original !== undefined && (
        !sameItem(original, item) || (!membershipChanged && previousIndex.get(item.id) !== index)
      );
    });
    const moved = changed.some((item) => before.get(item.id)?.date !== item.date);
    const crossedBudgetCap = previousBudget.overBudget !== currentBudget.overBudget;

    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      // An undo is not itself undoable: depth is one step and redo is out of scope.
      undoTarget = undoing
        ? null
        : { label: describeChange(added, removed, changed, moved), items: previousItems };
      highlightToken += 1;
      highlight = {
        itemIds: [...added, ...changed].map((item) => item.id),
        // A removal has no surviving card to mark, so the budget carries the cue.
        budget: removed.length > 0 || crossedBudgetCap,
        token: highlightToken,
      };
    }

    previousItems = current;
    previousBudget = currentBudget;

    // The cue and the undo record are computed for every source above, but the
    // notification is not. The runtime's terminal tool event publishes an in-app
    // write together with its updated trace and emits then; emitting here too
    // would double-notify. External WebMCP and human writes have no such event,
    // so they must invalidate the snapshot immediately.
    if (source !== 'in_app_runtime') emit();
  });

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
        backend,
        undoable: undoTarget === null ? null : {
          label: undoTarget.label,
          blockedReason: status === 'running' || status === 'awaiting_approval'
            ? 'Undo is unavailable while the agent is working, because reversing the plan mid-run would stop it.'
            : null,
        },
        highlight,
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
      if (backend.status !== 'ready') {
        trace = [];
        status = 'failed';
        note = backend.status === 'loading'
          ? `${backend.backend.label} is still loading. Wait until it is ready before running the agent.`
          : `${backend.backend.label} is unavailable: ${backend.error}`;
        emit();
        return;
      }
      trace = [];
      note = null;
      status = 'running';
      controller = new AbortController();
      currentStep = 1;
      emit();

      const model = createModel(store.getState());

      try {
        const result = await runAgentRuntime({
          goal,
          model,
          toolProvider: { getTools: () => tools },
          getStateRevision: () => store.getState().revision,
          signal: controller.signal,
          maxSteps: MAX_AGENT_STEPS,
          ...(backend.backend.kind === 'scripted' ? {} : { toolSelector: selectTravelTools }),
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
            if (approved) {
              status = 'running';
              emit();
            }
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

    configureBackend: (nextBackend, nextCreateModel) => {
      if (status === 'running' || status === 'awaiting_approval') {
        throw new Error('Cannot replace the model backend while the agent is working.');
      }
      backend = nextBackend;
      if (nextCreateModel !== undefined) createModel = nextCreateModel;
      note = null;
      emit();
    },

    removeItem: (itemId: string) => {
      store.editAsHuman((items) => items.filter((item) => item.id !== itemId));
    },

    moveItem: (itemId: string, toDate: string) => {
      const revision = store.getState().revision;
      store.moveItem(revision, itemId, toDate);
      emit();
    },

    undo: () => {
      // Refused rather than queued: reversing the plan mid-run would invalidate
      // the decision the agent is currently acting on.
      if (status === 'running' || status === 'awaiting_approval') return;
      const target = undoTarget;
      if (target === null) return;
      undoing = true;
      try {
        store.editAsHuman(() => target.items);
      } finally {
        undoing = false;
      }
    },

    reset: () => {
      if (status === 'running' || status === 'awaiting_approval') return;
      trace = [];
      note = null;
      undoTarget = null;
      highlight = null;
      highlightToken = 0;
      status = 'idle';
      emit();
    },
  };
}
