# Collaboration Contract

The smallest description of the collaborative slice that the Day 3 UI must implement. It is written before any visual work so the interface is built against a fixed contract rather than the contract being back-filled from whatever the UI happened to do.

Nothing here is implemented yet. This file specifies behaviour; `src/` implements the domain that behaviour runs on.

## Surfaces

Six regions, in reading order.

| Surface | Purpose | Reads | Writes |
| --- | --- | --- | --- |
| Goal input | One free-text goal, submitted to the runtime | — | starts a run |
| Itinerary board | Staged items grouped by trip date | `TripState.items` | human edit, undo |
| Budget panel | Cap, committed, remaining, per-kind split | `BudgetSummary` | — |
| Action trace | What the agent is doing, per step | `AgentEvent[]` | — |
| Approval card | Pending write awaiting a decision | `AgentApprovalRequest` | approve / deny |
| Backend indicator | Which inference backend is answering | active model adapter | — |

The itinerary board is the primary output. The trace is a supporting surface and must never become the place where the result is read — if the board and budget were hidden, the demo should lose its point.

Three of these behaviours — undo, the backend indicator, and the highlight treatment described below — are Day 5 scope rather than Day 3. They are specified here because they change the shape of the board and the trace, and retrofitting them into a finished UI is more expensive than allowing for them now.

## The hero flow

1. Person enters the goal: *"Prepare a 10-day Japan trip under ₹1.5L. Keep Tokyo and Kyoto, avoid red-eye flights, and do not book anything."*
2. Runtime starts. The trace shows each tool as it is called, naming the tool and the entity it touches — "searched stays in Kyoto", not "calling tool 3 of 6".
3. Read tools run without interruption. Each staged write pauses on an approval card.
4. The person approves. The item appears on the board and the budget updates in the same frame.
5. The run ends. The board shows a complete plan; nothing is booked.

## The collaboration turn

This is the part that distinguishes the project from a chatbot, so it gets an explicit contract.

1. The person removes an item directly on the board — no chat, no prompt.
2. `editAsHuman` commits the change and increments the revision.
3. The person enters a second goal: *"Rework everything around that and keep the same budget."*
4. The runtime reads current state, and every write it proposes carries the new revision.

If a human edit lands **during** a run, the in-flight decision is stale. The runtime returns `stale_state`, the UI says so plainly, and the run stops without writing. The person's edit always wins. A stale run is a normal outcome, not an error state — the copy must not read as a crash.

## Approval

Every non-read tool pauses. The card states the tool title, the affected entity by name, the price delta, and the resulting budget. It offers Approve and Deny, and nothing is pre-selected.

Denial ends the run with `denied`. It does not roll the plan back — nothing was written.

An ambiguous write failure is terminal. The UI reports what failed and stops. It never offers a retry button, because a retry cannot know whether the first attempt landed.

## Highlights

The agent's work has to be visible as a change to the application, not as a line of text claiming a change happened. When a write commits, the affected item is highlighted on the board.

The highlight marks the entity, never the whole board. Staging an activity in Kyoto highlights that card; it does not flash the itinerary. If a write changes the budget enough to cross the cap, the budget panel is highlighted too, because that is a second affected entity rather than decoration.

A highlight decays on its own after a few seconds. It is a "look here, this just changed" cue, not a selection state, and it must not accumulate — five staged items in one run leave five brief highlights in sequence, not five permanent badges.

Highlights never carry information that exists nowhere else. Someone who misses the animation entirely, or who has reduced motion enabled, must still be able to read the same fact from the board and the trace.

## Undo

Every human edit and every approved agent write is undoable. Nothing is booked, so there is no action whose consequences outlive the plan and nothing that undo cannot reach.

Undo is a human edit. It goes through `editAsHuman`, applies unconditionally, and increments the revision like any other. It does not restore an old revision number — revisions only ever move forward, and an undo that rewound the counter would make a stale agent decision look fresh again.

That has a consequence worth stating plainly: undoing during a run invalidates the run, exactly as any other human edit does. The UI must not present undo as a safe or neutral action mid-run. Either disable it while a run is in flight, or state that using it will stop the run.

Undo depth is a single step for the Day 5 scope. A person undoing an approval sees the item leave the board and the budget return to its previous total. Redo is out of scope — a person who wants the item back can ask the agent again, and pretending otherwise means keeping a second history the domain does not model.

## Execution backend indicator

The runtime is model-neutral, and §44 of the product direction makes that interchangeability a headline claim. A claim the user cannot see is not proven, so the active backend is always visible.

The indicator names the backend in the same terms the person would choose it by — "Local · Qwen 1.5B" rather than "adapter: qwen-1_5b-q4". It sits near the goal input, because that is the moment a person decides what to ask for.

It reports three states: which backend is active, whether the model is still loading, and whether it failed. A local model that has not finished loading is not the same as a local model that is ready, and a run started against a loading backend must say so rather than appearing to hang.

Switching backends is not silent. If the application supports switching, the change is visible and takes effect on the next run, never mid-run — a run that swapped models halfway would make its own trace unreadable.

The indicator must not imply the whole application is offline. Local inference means the reasoning runs on the device; the trip tools still talk to the application exactly as the normal interface does. Copy that says "offline" or "no network" is wrong and must not ship.

## Boundary

The staged plan is a plan. There is no booking, payment, credential, account, or deletion capability anywhere in the tool surface, and none may be added to it. A test asserts this and should be treated as load-bearing.

Copy must not claim the trip is booked, held, or reserved. "Staged" and "planned" are the words.

## States

Every surface needs all four. They are acceptance criteria, not polish.

**Empty.** Board before the first run reads as an invitation, not a failure — the goal input is the only emphasised control. Budget shows the full cap as remaining. Trace is absent rather than an empty box.

**Loading.** The run is bounded to six steps, so progress is countable: show the current step against that maximum. The board stays visible and stays interactive for reading; it must not be replaced by a spinner. Streaming into the board is not permitted before approval — an unapproved write has not happened and must not be previewed as if it had.

**Error.** Four cases, distinct copy for each: model returned an unusable decision, a tool failed, the run hit the step limit, the state went stale. Never a generic "something went wrong". The stale case in particular reads as an explanation, not a fault.

**Cancelled.** The person can stop a run at any point. Work already approved and committed stays; nothing is unwound.

## Accessibility

The trace and budget update while the agent works, so live-region behaviour is the main risk.

- The trace is a live region announcing one line per step, polite. It does not announce every intermediate token.
- Budget changes are announced as a single summary after a write commits, not per keystroke of an animated counter.
- An approval card takes focus when it appears and traps focus until decided — it is a blocking decision and must behave like one. Escape denies rather than dismissing silently, so a cancelled dialog cannot be mistaken for an approval.
- Every itinerary item is reachable and removable by keyboard alone. Drag to move must have a keyboard equivalent; a move control that only works by pointer fails this contract.
- Colour never carries meaning alone. Over-budget is a label and an icon, not only red. The same applies to a highlight and to the backend indicator: a highlight that is only a colour wash, or an indicator that distinguishes local from cloud by hue, communicates nothing to a person who cannot see the difference.
- A highlight is a visual echo of something already announced in the trace, so it is not announced a second time. Announcing both produces a duplicate for screen reader users and adds nothing for anyone else.
- Undo is a control, not a gesture. It is reachable by keyboard, and its label says what will be undone — "Undo staging Arashiyama Ryokan", not "Undo". After it completes, the resulting change is announced once, like any other committed write.
- When undo is disabled during a run, it is disabled with a reason the assistive technology can read, not merely greyed out.
- The backend indicator's loading and failed states are announced politely when they change. A model that fails to load is announced, because a person waiting on it otherwise has no way to learn that waiting is pointless.
- Respect `prefers-reduced-motion` — item entry, budget transitions, and highlight decay become instant. A highlight with reduced motion still appears and still clears; it simply does not animate.
- Target contrast is WCAG AA, including the trace's secondary text, which is the most likely place to fail it.

## Responsive behaviour

Two layouts, one breakpoint.

**Wide.** Board and budget side by side, trace in a column that does not push the board off-screen. Approval appears as a modal over the board so the affected item stays visible behind it.

**Narrow.** Single column: goal, budget summary, board, trace collapsed behind a control. Approval becomes a bottom sheet. The board remains the tallest region — the trace must not dominate the small viewport.

Touch targets are at least 44px. The remove, move and undo controls on an itinerary item must not sit close enough to be mis-tapped. Undo is the most costly of the three to hit by accident, since it discards work, so it does not sit adjacent to the others.

The backend indicator stays visible in both layouts. It may shorten — "Local · Qwen 1.5B" to "Local" — but it never collapses into the trace or behind a menu, because a claim the person has to go looking for is not a visible claim. Its loading and failed states keep their full text at every width.

## Traceability

Each trace line names a real entity: "staged Arashiyama Ryokan, 3 nights, ₹26,700" rather than "add_itinerary_item succeeded". The person should be able to audit what happened without reading tool names, while a developer should still be able to map each line to a tool call.
