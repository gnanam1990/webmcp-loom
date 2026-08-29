import { describe, expect, it } from 'vitest';
import { createSession } from './session.js';
import { formatDay, projectApprovalBudget } from './App.js';

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
});
