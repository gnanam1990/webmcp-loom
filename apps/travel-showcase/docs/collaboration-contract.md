# Collaboration Contract

The smallest description of the collaborative slice that the Day 3 UI must implement. It is written before any visual work so the interface is built against a fixed contract rather than the contract being back-filled from whatever the UI happened to do.

Nothing here is implemented yet. This file specifies behaviour; `src/` implements the domain that behaviour runs on.

## Surfaces

Five regions, in reading order.

| Surface | Purpose | Reads | Writes |
| --- | --- | --- | --- |
| Goal input | One free-text goal, submitted to the runtime | — | starts a run |
| Itinerary board | Staged items grouped by trip date | `TripState.items` | human edit |
| Budget panel | Cap, committed, remaining, per-kind split | `BudgetSummary` | — |
| Action trace | What the agent is doing, per step | `AgentEvent[]` | — |
| Approval card | Pending write awaiting a decision | `AgentApprovalRequest` | approve / deny |

The itinerary board is the primary output. The trace is a supporting surface and must never become the place where the result is read — if the board and budget were hidden, the demo should lose its point.

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
- Colour never carries meaning alone. Over-budget is a label and an icon, not only red.
- Respect `prefers-reduced-motion` — item entry and budget transitions become instant.
- Target contrast is WCAG AA, including the trace's secondary text, which is the most likely place to fail it.

## Responsive behaviour

Two layouts, one breakpoint.

**Wide.** Board and budget side by side, trace in a column that does not push the board off-screen. Approval appears as a modal over the board so the affected item stays visible behind it.

**Narrow.** Single column: goal, budget summary, board, trace collapsed behind a control. Approval becomes a bottom sheet. The board remains the tallest region — the trace must not dominate the small viewport.

Touch targets are at least 44px. The remove and move controls on an itinerary item must not sit close enough to be mis-tapped.

## Traceability

Each trace line names a real entity: "staged Arashiyama Ryokan, 3 nights, ₹26,700" rather than "add_itinerary_item succeeded". The person should be able to audit what happened without reading tool names, while a developer should still be able to map each line to a tool call.
