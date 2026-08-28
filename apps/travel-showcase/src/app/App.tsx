import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createSession } from './session.js';
import type { SessionSnapshot, TraceLine } from './session.js';
import type { ItineraryItem, TripState } from '../types.js';

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (value: number): string => `₹${INR.format(value)}`;

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const day = (iso: string): string => DAY.format(new Date(`${iso}T00:00:00Z`));

const HERO_GOAL = 'Prepare a 10-day Japan trip under ₹1.5L. Keep Tokyo and Kyoto, avoid red-eye flights, and do not book anything.';
const REPAIR_GOAL = 'Rework everything around that and keep the same budget.';

const BUSY: readonly SessionSnapshot['status'][] = ['running', 'awaiting_approval'];

export function App(): React.JSX.Element {
  const session = useMemo(() => createSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [goal, setGoal] = useState(HERO_GOAL);

  const busy = BUSY.includes(snapshot.status);
  const planned = snapshot.trip.items.length > 0;

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    if (!busy && goal.trim()) void session.run(goal.trim());
  }, [busy, goal, session]);

  return (
    <div className="shell">
      <header className="shell__head">
        <p className="eyebrow">WebMCP Loom · collaborative showcase</p>
        <h1>Japan trip planner</h1>
        <p className="lede">
          The agent works through the same tools you do, and everything it stages lands on the
          board below. Nothing here books, pays for, or reserves anything.
        </p>
      </header>

      <form className="goal" onSubmit={submit}>
        <label className="goal__label" htmlFor="goal">What should the agent do?</label>
        <textarea
          id="goal"
          className="goal__input"
          value={goal}
          rows={2}
          onChange={(event) => setGoal(event.target.value)}
          disabled={busy}
        />
        <div className="goal__actions">
          <button type="submit" className="button button--primary" disabled={busy || !goal.trim()}>
            {busy ? 'Working…' : 'Run agent'}
          </button>
          {busy && (
            <button type="button" className="button" onClick={session.cancel}>Stop</button>
          )}
          {!busy && planned && (
            <button type="button" className="button" onClick={() => setGoal(REPAIR_GOAL)}>
              Use the rework goal
            </button>
          )}
        </div>
      </form>

      <StatusNote snapshot={snapshot} />

      <div className="columns">
        <Board trip={snapshot.trip} onRemove={session.removeItem} busy={busy} />
        <div className="side">
          <Budget snapshot={snapshot} />
          <Trace lines={snapshot.trace} />
        </div>
      </div>

      {snapshot.pendingApproval !== null && (
        <Approval
          snapshot={snapshot}
          onApprove={session.approve}
          onDeny={session.deny}
        />
      )}
    </div>
  );
}

function StatusNote({ snapshot }: { snapshot: SessionSnapshot }): React.JSX.Element | null {
  if (snapshot.note === null) return null;
  const tone = snapshot.status === 'completed' ? 'ok'
    : snapshot.status === 'stale' ? 'warn'
      : 'info';
  return (
    <p className={`note note--${tone}`} role="status">
      <strong className="note__label">
        {snapshot.status === 'stale' ? 'Run stopped' : snapshot.status === 'completed' ? 'Done' : 'Note'}
      </strong>
      {snapshot.note}
    </p>
  );
}

function Board({ trip, onRemove, busy }: {
  trip: TripState;
  onRemove: (itemId: string) => void;
  busy: boolean;
}): React.JSX.Element {
  const byDate = new Map<string, ItineraryItem[]>();
  for (const item of [...trip.items].sort((left, right) => left.date.localeCompare(right.date))) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }

  return (
    <section className="board" aria-labelledby="board-heading">
      <div className="board__head">
        <h2 id="board-heading">Itinerary</h2>
        <span className="revision" title="Increments on every change, by you or the agent">
          revision {trip.revision}
        </span>
      </div>

      {byDate.size === 0 ? (
        <p className="empty">
          Nothing staged yet. Run the agent, and whatever it proposes will appear here for you to
          approve, keep, or remove.
        </p>
      ) : (
        <ol className="days">
          {[...byDate.entries()].map(([date, items]) => (
            <li key={date} className="day">
              <h3 className="day__date">{day(date)}</h3>
              <ul className="day__items">
                {items.map((item) => (
                  <li key={item.id} className={`card card--${item.kind}`}>
                    <span className="card__kind">{item.kind}</span>
                    <span className="card__label">{item.label}</span>
                    <span className="card__price">{money(item.priceInr)}</span>
                    <button
                      type="button"
                      className="card__remove"
                      onClick={() => onRemove(item.id)}
                      disabled={busy}
                      title={busy ? 'Wait for the run to finish' : `Remove ${item.label}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Budget({ snapshot }: { snapshot: SessionSnapshot }): React.JSX.Element {
  const { budget } = snapshot;
  const used = Math.min(100, Math.round((budget.committedInr / budget.budgetInr) * 100));
  return (
    <section className="panel" aria-labelledby="budget-heading">
      <h2 id="budget-heading">Budget</h2>
      <p className="budget__figure">
        <span className={budget.overBudget ? 'is-over' : ''}>{money(budget.committedInr)}</span>
        <span className="budget__cap"> of {money(budget.budgetInr)}</span>
      </p>
      <div className="meter" role="img" aria-label={`${used}% of budget committed`}>
        <div className={`meter__fill ${budget.overBudget ? 'is-over' : ''}`} style={{ width: `${used}%` }} />
      </div>
      <dl className="breakdown">
        {(['flight', 'stay', 'activity'] as const).map((kind) => (
          <div key={kind}>
            <dt>{kind}</dt>
            <dd>{money(budget.byKind[kind])}</dd>
          </div>
        ))}
      </dl>
      <p className={`budget__remaining ${budget.overBudget ? 'is-over' : ''}`}>
        {budget.overBudget
          ? `${money(Math.abs(budget.remainingInr))} over budget`
          : `${money(budget.remainingInr)} remaining`}
      </p>
    </section>
  );
}

function Trace({ lines }: { lines: readonly TraceLine[] }): React.JSX.Element {
  return (
    <section className="panel" aria-labelledby="trace-heading">
      <h2 id="trace-heading">Agent actions</h2>
      {lines.length === 0 ? (
        <p className="empty empty--small">No run yet.</p>
      ) : (
        <ol className="trace" aria-live="polite">
          {lines.map((line) => (
            <li key={`${line.step}-${line.toolName}`} className={`trace__line is-${line.state}`}>
              <span className="trace__mark" aria-hidden="true" />
              <span className="trace__text">
                {line.label}
                <span className="trace__state"> — {stateWord(line.state)}</span>
                {line.detail !== undefined && <span className="trace__detail">{line.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function stateWord(state: TraceLine['state']): string {
  if (state === 'running') return 'working';
  if (state === 'awaiting_approval') return 'waiting for you';
  if (state === 'succeeded') return 'done';
  return 'stopped';
}

function Approval({ snapshot, onApprove, onDeny }: {
  snapshot: SessionSnapshot;
  onApprove: () => void;
  onDeny: () => void;
}): React.JSX.Element | null {
  const request = snapshot.pendingApproval;
  const dialog = useRef<HTMLDivElement>(null);
  if (request === null) return null;

  const line = snapshot.trace.find((entry) => entry.step === request.step);

  return (
    <div className="scrim" role="presentation" onKeyDown={(event) => {
      if (event.key === 'Escape') onDeny();
    }}>
      <div
        className="approval"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-heading"
        ref={dialog}
      >
        <h2 id="approval-heading">Approve this change?</h2>
        <p className="approval__what">{line?.label ?? request.tool.title}</p>
        <dl className="approval__meta">
          <div><dt>Action</dt><dd>{request.tool.title}</dd></div>
          <div><dt>Plan revision</dt><dd>{String(request.stateRevision ?? '—')}</dd></div>
        </dl>
        <p className="approval__note">
          This stages the item on your board. It does not book or pay for anything.
        </p>
        <div className="approval__actions">
          <button type="button" className="button button--primary" onClick={onApprove} autoFocus>
            Approve
          </button>
          <button type="button" className="button" onClick={onDeny}>Decline</button>
        </div>
      </div>
    </div>
  );
}
