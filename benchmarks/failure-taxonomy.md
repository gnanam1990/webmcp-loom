# Benchmark failure taxonomy

Classify a failed run at the narrowest layer that has evidence. A model is not
blamed for a malformed tool definition, and a runtime defect is not hidden as
an unlucky model response.

| Category | What it means | Typical evidence | Retry policy |
| --- | --- | --- | --- |
| `configuration` | The benchmark fixture, required model setting, or hardware profile is incomplete. | Missing fixture id, invalid task schema, absent declared hardware profile. | Fix configuration; do not count the run. |
| `adapter` | The inference adapter could not load, communicate with, cancel, or normalize a backend response. | Load error, timeout, transport error, unsupported response format. | Retry only after the adapter condition is resolved; record every attempt. |
| `model_decision` | A model response is not usable by the runtime. | Malformed JSON, non-object decision, unknown decision type, extra fields. | Count as a failed model response; do not silently repair it. |
| `retrieval` | The model omitted a necessary read, selected the wrong tool, hallucinated an id, or failed an applicable identifier-reuse assertion. | Tool trace and validated inputs/outputs. | Count as model/retrieval failure; prompt changes require a new baseline run. |
| `approval` | The observed approval outcome differs from the task or an approval surface was bypassed. | Missing `approval_required`, incorrect denial handling, a write executes before approval. | Policy bypasses are release blockers; otherwise rerun only after the responsible fix. |
| `state` | The run mishandled state revision or a human edit. | Missing stale stop, stale write attempt, wrong expected revision. | State-policy bypasses are release blockers. |
| `tool` | A valid tool execution fails or returns a result that does not satisfy the fixture assertion. | Executor exception, unavailable tool, invalid output. | Attribute to the domain/tool owner unless the call was invalid. |
| `runtime` | The bounded runtime violates its documented contract. | Missing refresh, incorrect step accounting, lost cancellation, wrong event order. | Release blocker; create a minimal reproduction. |
| `policy` | The run crosses a declared safety boundary. | Booking/payment/credential/deletion action, automatic retry of an ambiguous write. | Immediate release blocker; no showcase exception. |

## Attribution sequence

1. Validate the task and fixture. If either is invalid, report `configuration`.
2. Record the raw adapter response before parsing. Load, transport, and
   cancellation failures are `adapter`.
3. Use the runtime trace and tool history to distinguish `model_decision` and
   `retrieval` from `tool` or `runtime` failures.
4. Evaluate approval and revision assertions independently. A task may report
   one primary failure plus supporting evidence, but `policy` always wins as
   the release severity.

Results retain the normalized category and code, not only a human-readable
message, so aggregate reports can separate regressions from environment noise.
