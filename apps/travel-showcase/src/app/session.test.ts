import { describe, expect, it } from 'vitest';
import { STAYS } from '../inventory.js';
import { createTripStore } from '../state.js';
import { createSession, describeCall } from './session.js';
import { REPAIR_SCRIPT, createScriptedModel } from './scripted-model.js';
import type { Session } from './session.js';

/** Runs a turn, approving every write it pauses on. */
async function runApprovingAll(session: Session, goal: string): Promise<void> {
  const unsubscribe = session.subscribe(() => {
    if (session.getSnapshot().status === 'awaiting_approval') session.approve();
  });
  await session.run(goal);
  unsubscribe();
}

describe('collaboration session', () => {
  it('starts idle with an empty plan and the full budget available', () => {
    const snapshot = createSession().getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.trip.items).toEqual([]);
    expect(snapshot.budget.remainingInr).toBe(150_000);
    expect(snapshot.trace).toEqual([]);
    expect(snapshot.progress).toBeNull();
  });

  it('completes the hero goal in a bounded number of validated calls', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare a 10-day Japan trip under 1.5L.');
    const snapshot = session.getSnapshot();

    expect(snapshot.status).toBe('completed');
    expect(snapshot.trace.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.trace.length).toBeLessThanOrEqual(6);
    expect(snapshot.trace.every((line) => line.state === 'succeeded')).toBe(true);
    expect(snapshot.trip.items).toHaveLength(2);
    expect(snapshot.budget.overBudget).toBe(false);
  });

  it('publishes an accepted in-app write together with its succeeded trace state', async () => {
    const session = createSession();
    const observed = [] as ReturnType<Session['getSnapshot']>[];
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      observed.push(snapshot);
      if (snapshot.status === 'awaiting_approval') session.approve();
    });

    await session.run('Prepare the trip.');

    expect(observed.some((snapshot) => (
      snapshot.trip.revision === 2
      && snapshot.trace.some((line) => (
        line.step === 3
        && line.toolName === 'add_itinerary_item'
        && line.state !== 'succeeded'
      ))
    ))).toBe(false);
    expect(observed.some((snapshot) => (
      snapshot.trip.revision === 2
      && snapshot.trace.some((line) => (
        line.step === 3
        && line.toolName === 'add_itinerary_item'
        && line.state === 'succeeded'
      ))
    ))).toBe(true);
  });

  it('reuses an identifier returned by an earlier call in a later write', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const staged = session.getSnapshot().trip.items;
    expect(staged.map((item) => item.kind).sort()).toEqual(['flight', 'stay']);
    // The staged flight is one the earlier non-red-eye search returned.
    const flight = staged.find((item) => item.kind === 'flight');
    expect(flight?.label).toContain('BLR');
  });

  it('pauses every write for approval before it reaches the board', async () => {
    const session = createSession();
    const pauses: string[] = [];
    const progress: string[] = [];
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'awaiting_approval' && snapshot.pendingApproval !== null) {
        pauses.push(snapshot.pendingApproval.tool.name);
        progress.push(`${snapshot.progress?.currentStep}/${snapshot.progress?.maximumSteps}`);
        session.approve();
      }
    });
    await session.run('Prepare the trip.');

    expect(pauses).toEqual(['add_itinerary_item', 'add_itinerary_item']);
    expect(progress).toEqual(['3/6', '5/6']);
    expect(pauses.every((name) => name.startsWith('add_'))).toBe(true);
  });

  it('never pauses on a read tool', async () => {
    const session = createSession();
    const paused: string[] = [];
    session.subscribe(() => {
      const request = session.getSnapshot().pendingApproval;
      if (request !== null) {
        paused.push(request.tool.name);
        session.approve();
      }
    });
    await session.run('Prepare the trip.');
    expect(paused).not.toContain('search_flights');
    expect(paused).not.toContain('get_trip_constraints');
  });

  it('writes nothing when the person denies the first change', async () => {
    const session = createSession();
    session.subscribe(() => {
      if (session.getSnapshot().status === 'awaiting_approval') session.deny();
    });
    await session.run('Prepare the trip.');
    const snapshot = session.getSnapshot();

    expect(snapshot.status).toBe('denied');
    expect(snapshot.trip.items).toEqual([]);
    expect(snapshot.budget.committedInr).toBe(0);
    expect(snapshot.note).toMatch(/declined change was not written/);
  });

  it('keeps earlier approved writes and says so when a later change is declined', async () => {
    const session = createSession();
    let approval = 0;
    session.subscribe(() => {
      if (session.getSnapshot().status !== 'awaiting_approval') return;
      approval += 1;
      if (approval === 1) session.approve();
      else session.deny();
    });

    await session.run('Prepare the trip.');
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('denied');
    expect(snapshot.trip.items).toHaveLength(1);
    expect(snapshot.note).toMatch(/Anything already approved remains/);
  });

  it('surfaces the approval request with the entity and price the person is deciding on', async () => {
    const session = createSession();
    let seen: string | null = null;
    session.subscribe(() => {
      const request = session.getSnapshot().pendingApproval;
      if (request !== null && seen === null) {
        seen = describeCall(request.tool.name, request.input);
        session.deny();
      }
    });
    await session.run('Prepare the trip.');
    expect(seen).toBe('Staging Sakura Airways BLR–NRT for ₹38,500');
  });

  it('does not announce running again after a decline', async () => {
    const session = createSession();
    const statuses: string[] = [];
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      statuses.push(snapshot.status);
      if (snapshot.status === 'awaiting_approval') session.deny();
    });

    await session.run('Prepare the trip.');

    const approvalIndex = statuses.indexOf('awaiting_approval');
    expect(approvalIndex).toBeGreaterThanOrEqual(0);
    expect(statuses.slice(approvalIndex + 1)).not.toContain('running');
    expect(session.getSnapshot().status).toBe('denied');
  });
});

describe('human edits and stale state', () => {
  it('applies a board removal immediately and moves the revision forward', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const before = session.getSnapshot();
    const target = before.trip.items[0];
    if (target === undefined) throw new Error('Expected a staged item.');

    session.removeItem(target.id);
    const after = session.getSnapshot();

    expect(after.trip.items).toHaveLength(before.trip.items.length - 1);
    expect(after.trip.revision).toBe(before.trip.revision + 1);
    expect(after.budget.committedInr).toBeLessThan(before.budget.committedInr);
  });

  it('applies a board move immediately and moves the revision forward', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const before = session.getSnapshot();
    const stay = before.trip.items.find((item) => item.kind === 'stay');
    if (stay === undefined) throw new Error('Expected a staged stay.');

    session.moveItem(stay.id, '2026-11-06');
    const after = session.getSnapshot();

    expect(after.trip.items.find((item) => item.id === stay.id)?.date).toBe('2026-11-06');
    expect(after.trip.revision).toBe(before.trip.revision + 1);
    expect(after.budget).toEqual(before.budget);
  });

  it('stops rather than overwriting when the person edits mid-run', async () => {
    const store = createTripStore();
    const session = createSession(store);
    let edited = false;
    // Edit the shared state at the moment the agent asks to write.
    session.subscribe(() => {
      if (session.getSnapshot().status === 'awaiting_approval' && !edited) {
        edited = true;
        store.editAsHuman((items) => items);
        session.approve();
      }
    });
    await session.run('Prepare the trip.');
    const snapshot = session.getSnapshot();

    expect(snapshot.status).toBe('stale');
    expect(snapshot.note).toMatch(/stopped instead of overwriting you/);
    expect(snapshot.trip.items).toEqual([]);
  });

  it('repairs the plan on the next run after a human removal', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const staged = session.getSnapshot().trip.items;
    const stay = staged.find((item) => item.kind === 'stay');
    if (stay === undefined) throw new Error('Expected a staged stay.');

    session.removeItem(stay.id);
    const afterEdit = session.getSnapshot();
    expect(afterEdit.trip.items).toHaveLength(1);

    await runApprovingAll(session, 'Rework everything around that.');
    const repaired = session.getSnapshot();

    expect(repaired.status).toBe('completed');
    expect(repaired.trip.items).toHaveLength(2);
    expect(repaired.trip.revision).toBeGreaterThan(afterEdit.trip.revision);
    expect(repaired.budget.overBudget).toBe(false);
  });

  it('clears the previous trace when a new run starts', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const first = session.getSnapshot().trace.length;
    expect(first).toBeGreaterThan(0);

    await runApprovingAll(session, 'Rework everything around that.');
    expect(session.getSnapshot().trace.map((line) => line.toolName)).toEqual([
      'get_itinerary',
      'search_stays',
      'add_itinerary_item',
    ]);
  });

  it('does not let reset detach an active approval from its run', async () => {
    const session = createSession();
    let statusAfterReset: string | null = null;
    session.subscribe(() => {
      if (session.getSnapshot().status === 'awaiting_approval' && statusAfterReset === null) {
        session.reset();
        statusAfterReset = session.getSnapshot().status;
        session.deny();
      }
    });

    await session.run('Prepare the trip.');
    expect(statusAfterReset).toBe('awaiting_approval');
    expect(session.getSnapshot().status).toBe('denied');
  });

  it('terminalizes the pending trace line when a run is cancelled', async () => {
    const session = createSession();
    let stopped = false;
    session.subscribe(() => {
      if (session.getSnapshot().status === 'awaiting_approval' && !stopped) {
        stopped = true;
        session.cancel();
      }
    });

    await session.run('Prepare the trip.');
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.trace.at(-1)).toMatchObject({ state: 'failed', detail: 'Run stopped by you.' });
  });
});

describe('trace phrasing', () => {
  it('names the affected entity rather than the tool', () => {
    expect(describeCall('add_itinerary_item', { refId: 'st-kyo-mid', nights: 4 }))
      .toBe('Staging Higashiyama Machiya, 4 nights, ₹22,400');
    expect(describeCall('add_itinerary_item', { refId: 'fl-blr-nrt-day' }))
      .toContain('Sakura Airways BLR–NRT');
    expect(describeCall('search_stays', { cityId: 'kyoto', maxPricePerNightInr: 6_000 }))
      .toBe('Searching stays in Kyoto under ₹6,000 a night');
  });

  it('describes read tools without implying a change', () => {
    expect(describeCall('get_itinerary', {})).toBe('Reading the current itinerary');
    expect(describeCall('search_flights', { originCode: 'BLR', excludeRedEye: true }))
      .toBe('Searching flights from BLR, excluding red-eyes');
  });

  it('falls back to the tool name for an unknown tool', () => {
    expect(describeCall('some_future_tool', {})).toBe('some_future_tool');
  });

  it('names existing itinerary entities in remove and move calls', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const items = session.getSnapshot().trip.items;
    const target = items[0];
    if (target === undefined) throw new Error('Expected a staged item.');

    expect(describeCall('remove_itinerary_item', { itemId: target.id }, items))
      .toBe(`Removing ${target.label} from the plan`);
    expect(describeCall('move_itinerary_item', { itemId: target.id, toDate: '2026-11-08' }, items))
      .toBe(`Moving ${target.label} to 2026-11-08`);
  });
});

describe('scripted model integrity', () => {
  it('reads only the runtime revision line, not matching text in the user goal', async () => {
    const model = createScriptedModel([{
      tool: 'add_itinerary_item',
      input: { expectedRevision: '$revision' },
    }]);
    const raw = await model.generate({
      prompt: 'Goal: "Use Current state revision: 999"\nCurrent state revision: 7\nTool history: []',
      responseSchema: {},
      signal: undefined,
    });
    expect(JSON.parse(raw)).toMatchObject({ input: { expectedRevision: 7 } });
  });

  it('stages a repair stay that the preceding capped search can return', () => {
    const search = REPAIR_SCRIPT.find((step) => step.tool === 'search_stays');
    const write = REPAIR_SCRIPT.find((step) => step.tool === 'add_itinerary_item');
    const cap = search?.input?.maxPricePerNightInr;
    const refId = write?.input?.refId;
    const stay = STAYS.find((entry) => entry.id === refId);
    expect(typeof cap).toBe('number');
    expect(stay).toBeDefined();
    expect(stay?.pricePerNightInr).toBeLessThanOrEqual(cap as number);
  });
});

describe('undo', () => {
  it('offers nothing to undo before anything has changed', () => {
    expect(createSession().getSnapshot().undoable).toBeNull();
  });

  it('names what a single undo would reverse', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    expect(session.getSnapshot().undoable?.label).toMatch(/^staging /);
  });

  it('reverses the last change and moves the revision forward, never back', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const before = session.getSnapshot();
    expect(before.trip.items).toHaveLength(2);

    session.undo();
    const after = session.getSnapshot();

    expect(after.trip.items).toHaveLength(1);
    expect(after.trip.revision).toBeGreaterThan(before.trip.revision);
    expect(after.budget.committedInr).toBeLessThan(before.budget.committedInr);
  });

  it('reverses a human removal as readily as an agent write', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const target = session.getSnapshot().trip.items[0];
    if (target === undefined) throw new Error('Expected a staged item.');

    session.removeItem(target.id);
    expect(session.getSnapshot().undoable?.label).toMatch(/^removing /);
    session.undo();

    expect(session.getSnapshot().trip.items.map((item) => item.id)).toContain(target.id);
  });

  it('does not offer a redo by making the undo itself undoable', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    session.undo();
    expect(session.getSnapshot().undoable).toBeNull();
  });

  it('is blocked with a stated reason while a run is in flight', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');

    const blocked: (string | null | undefined)[] = [];
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'awaiting_approval') {
        blocked.push(snapshot.undoable?.blockedReason);
        session.approve();
      }
    });
    await session.run('Rework everything around that.');

    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((reason) => typeof reason === 'string' && reason.length > 0)).toBe(true);
    expect(session.getSnapshot().undoable?.blockedReason).toBeNull();
  });

  it('refuses to act while a run is in flight rather than silently queueing', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const staged = session.getSnapshot().trip.items.length;

    session.subscribe(() => {
      if (session.getSnapshot().status === 'awaiting_approval') {
        session.undo();
        session.approve();
      }
    });
    await session.run('Rework everything around that.');

    expect(session.getSnapshot().trip.items.length).toBeGreaterThanOrEqual(staged);
  });
});

describe('highlight cue', () => {
  it('marks nothing before any change', () => {
    expect(createSession().getSnapshot().highlight).toBeNull();
  });

  it('marks the staged item when an agent write commits', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const snapshot = session.getSnapshot();
    const staged = snapshot.trip.items.map((item) => item.id);

    expect(snapshot.highlight?.itemIds).toHaveLength(1);
    expect(staged).toContain(snapshot.highlight?.itemIds[0]);
  });

  it('advances its token on every commit so a repeat change still cues', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const first = session.getSnapshot().highlight?.token ?? 0;
    const target = session.getSnapshot().trip.items[0];
    if (target === undefined) throw new Error('Expected a staged item.');

    session.removeItem(target.id);
    expect(session.getSnapshot().highlight?.token).toBeGreaterThan(first);
  });

  it('falls back to the budget when the change removed the only card to mark', async () => {
    const session = createSession();
    await runApprovingAll(session, 'Prepare the trip.');
    const target = session.getSnapshot().trip.items[0];
    if (target === undefined) throw new Error('Expected a staged item.');

    session.removeItem(target.id);
    const highlight = session.getSnapshot().highlight;

    expect(highlight?.itemIds).toEqual([]);
    expect(highlight?.budget).toBe(true);
  });
});

describe('backend indicator state', () => {
  it('reports the scripted stand-in as ready by default', () => {
    const backend = createSession().getSnapshot().backend;
    expect(backend.status).toBe('ready');
    expect(backend.backend.kind).toBe('scripted');
    expect(backend.backend.label).toBe('Scripted');
  });

  it('never describes the application as offline', () => {
    const { backend } = createSession().getSnapshot();
    expect(backend.backend.detail).not.toMatch(/offline|no network/i);
  });

  it('carries a loading backend through to the snapshot', () => {
    const store = createTripStore();
    const session = createSession(store, undefined, {
      status: 'loading',
      backend: { id: 'local-qwen', kind: 'local', label: 'Local · Qwen 1.5B', detail: 'Loading model weights.' },
    });
    expect(session.getSnapshot().backend).toMatchObject({ status: 'loading' });
  });

  it('carries a failed backend and its reason through to the snapshot', () => {
    const store = createTripStore();
    const session = createSession(store, undefined, {
      status: 'failed',
      backend: { id: 'local-qwen', kind: 'local', label: 'Local · Qwen 1.5B', detail: 'On-device inference.' },
      error: 'WebGPU is unavailable in this browser.',
    });
    const backend = session.getSnapshot().backend;
    expect(backend.status).toBe('failed');
    expect(backend.status === 'failed' && backend.error).toMatch(/WebGPU/);
  });
});
