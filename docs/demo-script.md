# Three-minute WebMCP Loom demo script

This script demonstrates the merged runtime and fixture behavior. It does not
claim a production deployment or a selected local model.

## 0:00–0:25 — The promise

Open the task-board fixture and say: “This page defines its semantic tools once.
The same surface is registered for external WebMCP agents and rediscovered by
the in-page runtime.” Show the two registered tools: `get_task_board` and
`stage_task`.

## 0:25–0:55 — Read before write

Click **Run to approval handoff**. Point to the trace: the runtime refreshes
tools, reads the board, validates the requested write, and stops at
`approval_required`. Confirm the board is still empty.

## 0:55–1:25 — Human control

Click **Approve and stage task**. Show that the same tool surface now stages one
reversible item and that the trace records the successful write. Emphasize that
approval is visible and the fixture has no booking, payment, deletion, account,
or credential capability.

## 1:25–1:55 — Shared-state recovery

Click **Demonstrate stale stop**. The page adds a human edit between the read
and the planned write. Point to `stale_state` in the trace and confirm the
agent's second write did not execute.

## 1:55–2:20 — External/in-page parity

Show the browser's WebMCP tool list and the in-page trace together. Explain:
“There is no second in-app schema or executor. The page-owned state is the
source of truth for both entry points.”

## 2:20–2:45 — Runtime guarantees

Summarize the bounded loop: dynamic tool refresh, deterministic JSON/schema
validation, visible approval, revision checks, cancellation, bounded history,
and no automatic retry after an ambiguous write failure.

## 2:45–3:00 — Honest next evidence

Close with: “The runtime proof and second fixture are complete on the reviewed
head. Local-model selection and benchmark reporting remain separate evidence
tracks; we will publish them only with reproducible results.”

## Capture checklist

- Record the browser URL, commit SHA, viewport, and tool list.
- Capture one frame each for approval required, completed write, and stale stop.
- Run the repository verification command on the demonstrated head.
- Label any local-model or deployment statement as planned unless a reproducible
  result or separate approved deployment exists.
