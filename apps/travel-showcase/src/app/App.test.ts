import { describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { formatDay, projectApprovalBudget, traceAnnouncement } from './App.js';
import type { SessionSnapshot } from './session.js';

describe('travel application presentation helpers', () => {
  it('preserves Japan calendar dates independently of the viewer timezone', () => {
    expect(formatDay('2026-11-05')).toBe('Thu 5 Nov');
  });

  it('projects the price delta and resulting budget before approval', async () => {
    const session = createSession();
    let projection: ReturnType<typeof projectApprovalBudget> = null;
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      if (snapshot.status === 'awaiting_approval' && projection === null) {
        projection = projectApprovalBudget(snapshot);
        session.deny();
      }
    });

    await session.run('Prepare the trip.');
    expect(projection).toEqual({
      deltaInr: 38_500,
      committedInr: 38_500,
      remainingInr: 111_500,
      overBudget: false,
    });
  });

  it('does not project a catalog price when the requested kind and reference disagree', async () => {
    const session = createSession();
    let evaluated = false;
    let projection: ReturnType<typeof projectApprovalBudget> = null;
    session.subscribe(() => {
      const snapshot = session.getSnapshot();
      if (snapshot.status !== 'awaiting_approval' || evaluated) return;
      const request = snapshot.pendingApproval;
      if (request === null) throw new Error('Expected a pending approval request.');
      const mismatched: SessionSnapshot = {
        ...snapshot,
        pendingApproval: {
          ...request,
          input: { ...request.input, kind: 'activity' },
        },
      };
      evaluated = true;
      projection = projectApprovalBudget(mismatched);
      session.deny();
    });

    await session.run('Prepare the trip.');
    expect(evaluated).toBe(true);
    expect(projection).toBeNull();
  });

  it('announces trace state and detail changes to assistive technology', () => {
    expect(traceAnnouncement({
      step: 3,
      toolName: 'add_itinerary_item',
      label: 'Add Sakura Hotel',
      state: 'awaiting_approval',
      detail: 'Waiting for your approval.',
    })).toBe('Step 3: Add Sakura Hotel — waiting for you — Waiting for your approval.');
  });
});
