import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { money } from '../format.js';
import { ACTIVITIES, FLIGHTS, STAYS } from '../inventory.js';
import type { Session, SessionSnapshot, TraceLine } from './session.js';
import type { ItineraryItem, TripState } from '../types.js';

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

/**
 * Whether the page could hand this tool surface to an external WebMCP agent.
 * `unsupported` is not a failure: the in-app experience is unaffected, but the
 * absence should be visible rather than silent.
 */
export type WebMcpStatus = 'registered' | 'unsupported' | 'failed';

/** How long a change stays marked before the cue fades on its own. */
const HIGHLIGHT_MILLISECONDS = 2_600;

export function App({ session, webmcp = 'unsupported' }: {
  session: Session;
  webmcp?: WebMcpStatus;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [goal, setGoal] = useState(HERO_GOAL);
  const [litToken, setLitToken] = useState<number | null>(null);
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

  // A highlight is a "this just changed" cue, so it clears itself. Keying the
  // timer on the token restarts decay even when the same item changes twice.
  const highlightToken = snapshot.highlight?.token ?? null;
  useEffect(() => {
    if (highlightToken === null) return undefined;
    setLitToken(highlightToken);
    const timer = setTimeout(() => setLitToken(null), HIGHLIGHT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [highlightToken]);

  const lit = litToken !== null && litToken === highlightToken ? snapshot.highlight : null;

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
          <Undo undoable={snapshot.undoable} onUndo={session.undo} />
        </div>
        <Backend state={snapshot.backend} webmcp={webmcp} />
      </form>

      <StatusNote snapshot={snapshot} />

      <div className="columns">
        <Board
          trip={snapshot.trip}
          onMove={session.moveItem}
          onRemove={session.removeItem}
          litItemIds={lit?.itemIds ?? []}
        />
        <div className="side">
          <Budget snapshot={snapshot} lit={lit?.budget === true} />
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

/**
 * Undo names what it will reverse, so the control is legible without the
 * surrounding context. When a run makes it unavailable it says why rather than
 * greying out silently — a disabled control with no reason reads as a bug.
 */
function Undo({ undoable, onUndo }: {
  undoable: SessionSnapshot['undoable'];
  onUndo: () => void;
}): React.JSX.Element | null {
  if (undoable === null) return null;
  const blocked = undoable.blockedReason !== null;
  return (
    <button
      type="button"
      className="button"
      onClick={onUndo}
      disabled={blocked}
      title={undoable.blockedReason ?? undefined}
      aria-describedby={blocked ? 'undo-reason' : undefined}
    >
      Undo {undoable.label}
      {blocked && <span id="undo-reason" className="visually-hidden">{undoable.blockedReason}</span>}
    </button>
  );
}

/**
 * Makes model-neutrality visible instead of merely claimed, and reports whether
 * the same tool surface is reachable by an external agent.
 *
 * Deliberately never says "offline": local inference means the reasoning runs
 * on the device, while the trip tools still talk to the application exactly as
 * the normal interface does.
 */
function Backend({ state, webmcp }: {
  state: SessionSnapshot['backend'];
  webmcp: WebMcpStatus;
}): React.JSX.Element {
  const webmcpLabel = webmcp === 'registered'
    ? 'Tools registered with WebMCP'
    : webmcp === 'failed'
      ? 'WebMCP registration failed'
      : 'WebMCP unavailable in this browser';

  return (
    <p className="backend" aria-live="polite">
      <span className={`backend__dot backend__dot--${state.status}`} aria-hidden="true" />
      <span className="backend__label">{state.backend.label}</span>
      <span className="backend__state">
        {state.status === 'ready' ? 'ready'
          : state.status === 'loading' ? 'loading…'
            : `unavailable — ${state.error}`}
      </span>
      <span className="backend__sep" aria-hidden="true">·</span>
      <span className={`backend__webmcp is-${webmcp}`}>{webmcpLabel}</span>
    </p>
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

function Board({ trip, onMove, onRemove, litItemIds }: {
  trip: TripState;
  onMove: (itemId: string, toDate: string) => void;
  onRemove: (itemId: string) => void;
  litItemIds: readonly string[];
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
                  <li
                    key={item.id}
                    className={`card card--${item.kind}${litItemIds.includes(item.id) ? ' is-lit' : ''}`}
                  >
                    <span className="card__kind">{item.kind}</span>
                    <span className="card__label">{item.label}</span>
                    <span className="card__price">{money(item.priceInr)}</span>
                    <div className="card__actions">
                      <MoveControl
                        item={item}
                        startDate={trip.constraints.startDate}
                        endDate={trip.constraints.endDate}
                        onMove={onMove}
                      />
                      <button
                        type="button"
                        className="card__remove"
                        onClick={() => onRemove(item.id)}
                        title={`Remove ${item.label}`}
                        aria-label={`Remove ${item.label}`}
                      >
                        Remove
                      </button>
                    </div>
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

function MoveControl({ item, startDate, endDate, onMove }: {
  item: ItineraryItem;
  startDate: string;
  endDate: string;
  onMove: (itemId: string, toDate: string) => void;
}): React.JSX.Element {
  const [toDate, setToDate] = useState(item.date);
  useEffect(() => setToDate(item.date), [item.date]);

  const fixed = item.kind === 'flight';
  const lastStartDate = item.kind === 'stay'
    ? shiftIsoDate(endDate, -item.nights)
    : endDate;
  const reason = fixed ? 'Flight dates follow the published timetable' : undefined;

  return (
    <span className="card__move">
      <label className="sr-only" htmlFor={`move-${item.id}`}>Move {item.label} to date</label>
      <select
        id={`move-${item.id}`}
        value={toDate}
        onChange={(event) => setToDate(event.target.value)}
        disabled={fixed}
        title={reason}
      >
        {isoDates(startDate, lastStartDate).map((date) => (
          <option key={date} value={date}>{formatDay(date)}</option>
        ))}
      </select>
      <button
        type="button"
        className="card__move-button"
        onClick={() => onMove(item.id, toDate)}
        disabled={fixed || toDate === item.date}
        title={reason ?? `Move ${item.label} to ${formatDay(toDate)}`}
        aria-label={reason ?? `Move ${item.label} to ${formatDay(toDate)}`}
      >
        {fixed ? 'Fixed date' : 'Move'}
      </button>
    </span>
  );
}

function isoDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = shiftIsoDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function Budget({ snapshot, lit }: { snapshot: SessionSnapshot; lit: boolean }): React.JSX.Element {
  const { budget } = snapshot;
  const used = Math.min(100, Math.round((budget.committedInr / budget.budgetInr) * 100));
  return (
    <section className={`panel budget-panel${lit ? ' is-lit' : ''}`} aria-labelledby="budget-heading">
      <h2 id="budget-heading">Budget</h2>
      <p className="budget__figure">
        <span className={budget.overBudget ? 'is-over' : ''}>{money(budget.committedInr)}</span>
        <span className="budget__cap"> of {money(budget.budgetInr)}</span>
      </p>
      <div
        className="meter"
        role="img"
        aria-label={budgetMeterLabel(snapshot.budget)}
      >
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

export function budgetMeterLabel(budget: SessionSnapshot['budget']): string {
  if (budget.overBudget) {
    return `${money(budget.committedInr)} committed; ${money(Math.abs(budget.remainingInr))} over budget`;
  }
  const used = Math.min(100, Math.round((budget.committedInr / budget.budgetInr) * 100));
  return `${used}% of budget committed`;
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
        {traceAnnouncement(latest)}
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

export function traceAnnouncement(line: TraceLine): string {
  const detail = line.detail === undefined ? '.' : ` — ${line.detail}`;
  return `Step ${line.step}: ${line.label} — ${stateWord(line.state)}${detail}`;
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
    const kind = request.input.kind;
    const refId = request.input.refId;
    if (kind === 'flight') {
      const flight = FLIGHTS.find((entry) => entry.id === refId);
      if (flight !== undefined) deltaInr = flight.priceInr;
    } else if (kind === 'stay') {
      const stay = STAYS.find((entry) => entry.id === refId);
      if (stay !== undefined && typeof request.input.nights === 'number') {
        deltaInr = stay.pricePerNightInr * request.input.nights;
      }
    } else if (kind === 'activity') {
      const activity = ACTIVITIES.find((entry) => entry.id === refId);
      if (activity !== undefined) deltaInr = activity.priceInr;
    }
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
