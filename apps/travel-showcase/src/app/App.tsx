import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ACTIVITIES, FLIGHTS, STAYS } from '../inventory.js';
import { createSession } from './session.js';
import type { SessionSnapshot, TraceLine } from './session.js';
import type { ItineraryItem, TripState } from '../types.js';

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (value: number): string => `₹${INR.format(value)}`;

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Tokyo',
});
export const formatDay = (iso: string): string => DAY.format(new Date(`${iso}T00:00:00Z`));

const HERO_GOAL = 'Prepare a 10-day Japan trip under ₹1.5L. Keep Tokyo and Kyoto, avoid red-eye flights, and do not book anything.';
const REPAIR_GOAL = 'Rework everything around that and keep the same budget.';

const BUSY: readonly SessionSnapshot['status'][] = ['running', 'awaiting_approval'];

export function App(): React.JSX.Element {
  const session = useMemo(() => createSession(), []);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [goal, setGoal] = useState(HERO_GOAL);
  const runButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const approvalSeen = useRef(false);

  const busy = BUSY.includes(snapshot.status);
  const planned = snapshot.trip.items.length > 0;

  useEffect(() => {
    if (snapshot.pendingApproval !== null) approvalSeen.current = true;
    if (approvalSeen.current && snapshot.pendingApproval === null && !busy) {
      runButton.current?.focus();
      approvalSeen.current = false;
    }
  }, [busy, snapshot.pendingApproval]);

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
          <button
            ref={runButton}
            type="submit"
            className="button button--primary"
            disabled={busy || !goal.trim()}
          >
            {busy && snapshot.progress !== null
              ? `Working · step ${snapshot.progress.currentStep} of ${snapshot.progress.maximumSteps}`
              : busy ? 'Working…' : 'Run agent'}
          </button>
          {busy && (
            <button ref={stopButton} type="button" className="button" onClick={session.cancel}>
              Stop
            </button>
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
          onCancel={session.cancel}
          returnFocusRef={stopButton}
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
              <h3 className="day__date">{formatDay(date)}</h3>
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
                      aria-label={busy
                        ? `Remove ${item.label} unavailable while the agent is working`
                        : `Remove ${item.label}`}
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
    <section className="panel budget-panel" aria-labelledby="budget-heading">
      <h2 id="budget-heading">Budget</h2>
      <p className="budget__figure">
        <span className={budget.overBudget ? 'is-over' : ''}>{money(budget.committedInr)}</span>
        <span className="budget__cap"> of {money(budget.budgetInr)}</span>
      </p>
      <div className="meter" role="img" aria-label={`${used}% of budget committed`}>
        <div
          className={`meter__fill ${budget.overBudget ? 'is-over' : ''}`}
          style={{ transform: `scaleX(${used / 100})` }}
        />
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
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Budget updated: {money(budget.committedInr)} committed;{' '}
        {budget.overBudget
          ? `${money(Math.abs(budget.remainingInr))} over budget`
          : `${money(budget.remainingInr)} remaining`}.
      </p>
    </section>
  );
}

function Trace({ lines }: { lines: readonly TraceLine[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const latest = lines.at(-1);
  if (latest === undefined) return <></>;
  return (
    <section className="panel trace-panel" aria-labelledby="trace-heading">
      <div className="trace__head">
        <h2 id="trace-heading">Agent actions</h2>
        <button
          type="button"
          className="trace__toggle"
          aria-expanded={expanded}
          aria-controls="trace-content"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Hide' : 'Show'} trace
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Step {latest.step}: {latest.label}.
      </p>
      <div id="trace-content" className={`trace__content ${expanded ? 'is-expanded' : ''}`}>
        <ol className="trace">
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
      </div>
    </section>
  );
}

function stateWord(state: TraceLine['state']): string {
  if (state === 'running') return 'working';
  if (state === 'awaiting_approval') return 'waiting for you';
  if (state === 'succeeded') return 'done';
  return 'stopped';
}

export interface ProjectedBudget {
  deltaInr: number;
  committedInr: number;
  remainingInr: number;
  overBudget: boolean;
}

export function projectApprovalBudget(snapshot: SessionSnapshot): ProjectedBudget | null {
  const request = snapshot.pendingApproval;
  if (request === null) return null;

  let deltaInr: number | null = null;
  if (request.tool.name === 'add_itinerary_item') {
    const refId = request.input.refId;
    const flight = FLIGHTS.find((entry) => entry.id === refId);
    const stay = STAYS.find((entry) => entry.id === refId);
    const activity = ACTIVITIES.find((entry) => entry.id === refId);
    if (flight !== undefined) deltaInr = flight.priceInr;
    if (stay !== undefined && typeof request.input.nights === 'number') {
      deltaInr = stay.pricePerNightInr * request.input.nights;
    }
    if (activity !== undefined) deltaInr = activity.priceInr;
  } else if (request.tool.name === 'remove_itinerary_item') {
    const item = snapshot.trip.items.find((entry) => entry.id === request.input.itemId);
    if (item !== undefined) deltaInr = -item.priceInr;
  } else if (request.tool.name === 'move_itinerary_item') {
    deltaInr = 0;
  }
  if (deltaInr === null) return null;

  const committedInr = snapshot.budget.committedInr + deltaInr;
  const remainingInr = snapshot.budget.budgetInr - committedInr;
  return { deltaInr, committedInr, remainingInr, overBudget: remainingInr < 0 };
}

function signedMoney(value: number): string {
  if (value === 0) return money(0);
  return `${value > 0 ? '+' : '−'}${money(Math.abs(value))}`;
}

function Approval({ snapshot, onApprove, onDeny, onCancel, returnFocusRef }: {
  snapshot: SessionSnapshot;
  onApprove: () => void;
  onDeny: () => void;
  onCancel: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element | null {
  const request = snapshot.pendingApproval;
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const projection = projectApprovalBudget(snapshot);

  useEffect(() => {
    if (request === null) return undefined;
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const first = dialog.current?.querySelector<HTMLElement>('button:not([disabled])');
    first?.focus();
    return () => {
      const previous = previousFocus.current;
      const previousCanReceiveFocus = previous !== null
        && previous.isConnected
        && !previous.hasAttribute('disabled')
        && previous !== document.body;
      (previousCanReceiveFocus ? previous : returnFocusRef.current)?.focus();
    };
  }, [request, returnFocusRef]);

  if (request === null) return null;

  const line = snapshot.trace.find((entry) => entry.step === request.step);

  return (
    <div className="scrim" role="presentation">
      <div
        className="approval"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="approval-heading"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDeny();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable === undefined || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (first === undefined || last === undefined) return;
          if (!dialog.current?.contains(document.activeElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id="approval-heading">Approve this change?</h2>
        <p className="approval__what">{line?.label ?? request.tool.title}</p>
        <dl className="approval__meta">
          <div><dt>Action</dt><dd>{request.tool.title}</dd></div>
          <div><dt>Plan revision</dt><dd>{String(request.stateRevision ?? '—')}</dd></div>
          {projection !== null && (
            <div><dt>Price change</dt><dd>{signedMoney(projection.deltaInr)}</dd></div>
          )}
        </dl>
        {projection !== null && (
          <p className={`approval__budget ${projection.overBudget ? 'is-over' : ''}`}>
            After approval: {money(projection.committedInr)} committed;{' '}
            {projection.overBudget
              ? `${money(Math.abs(projection.remainingInr))} over budget`
              : `${money(projection.remainingInr)} remaining`}.
          </p>
        )}
        <p className="approval__note">
          This stages the item on your board. It does not book or pay for anything.
        </p>
        <div className="approval__actions">
          <button type="button" className="button button--primary" onClick={onApprove}>
            Approve
          </button>
          <button type="button" className="button" onClick={onDeny}>Decline</button>
          <button type="button" className="button button--quiet" onClick={onCancel}>Stop run</button>
        </div>
      </div>
    </div>
  );
}
