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
        seen = request.tool.title;
        session.deny();
      }
    });
    await session.run('Prepare the trip.');
    expect(seen).toBe('Stage an itinerary item');
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
