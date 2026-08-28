# Contributing

## Required workflow

1. Start from the latest clean `main` after prerequisite PRs merge.
2. Create one owner-scoped branch for one coherent change.
3. Add deterministic tests or evidence for every behavioral claim.
4. Complete the mandatory pre-PR local and visual gate below.
5. Commit with a descriptive conventional commit message.
6. Open a pull request and record exact local evidence and scope boundaries.
7. Self-review the exact head, then obtain at least one non-author review for implementation PRs.
8. Fix demonstrated findings, rerun the complete gate, and wait for required CI.
9. Merge only the reviewed unchanged head after explicit merge approval.

Direct substantive pushes to `main` are not allowed. The license-only root commit is the repository bootstrap exception.

## Mandatory pre-PR local and visual gate

Do not open an implementation PR until every applicable item passes on the exact commit that will be pushed:

1. Run the repository's complete verification command, including formatting/lint, typecheck, unit and integration tests, production build, and dependency/security audit.
2. Start the built application locally using its production-like preview command; a compiler-only result is not a runtime check.
3. Exercise every affected happy path plus relevant loading, empty, error, cancellation, approval, and recovery states.
4. Inspect the running result visually with the in-app browser. Use the user's computer/browser when behavior depends on native UI, browser extensions, permissions, an existing signed-in session, or another environment the in-app browser cannot represent.
5. Check desktop and mobile widths when UI is affected, keyboard interaction when relevant, and browser console/network failures.
6. Capture the local URL, commands, results, tested flows/viewports, visual evidence, and any explicit untested boundary for the PR description.

If any required command, build, local run, or visual check fails, fix it and repeat the entire gate before opening the PR. CI confirms the pushed head; it does not replace pre-PR local execution or visual inspection.

Documentation-only changes may mark runtime and visual checks not applicable, but the PR must explain why and must still run the repository documentation gate.

## Branch ownership

| Owner | Branch prefixes | Primary paths |
| --- | --- | --- |
| Gnanasekaran | `feat/runtime-*`, `fix/runtime-*` | `packages/runtime/`, integration architecture and release coordination |
| Anandh | `feat/model-*`, `bench/*` | `packages/model-adapters/`, `benchmarks/` and model evidence |
| Vasanth | `feat/travel-*`, `feat/ui-*` | `apps/travel-showcase/`, travel domain and visual experience |

Shared files—package manifests, lockfiles, public interfaces, root documentation, CI, and hosting configuration—must be declared in the PR and coordinated before modification.

## Review matrix

- Gnanasekaran reviews runtime safety, WebMCP parity, model/UI integration and release scope.
- Anandh reviews model contracts, prompts, retrieval, benchmark design and performance claims.
- Vasanth reviews application behavior, trace clarity, accessibility, responsive UX and demo quality.
- An author cannot count their own verdict as the required non-author implementation review.

Every review binds its verdict to the exact head SHA and distinguishes verified behavior from planned or untested behavior.

Before merge, a reviewer repeats the risk-relevant local run and visual flow on the unchanged reviewed head. A green CI result without a working local preview and visual confirmation is not a merge verdict for implementation changes.

## Safety invariants

- Model output is untrusted and schema-validated before tool execution.
- Dynamic tool availability is refreshed during a run.
- Non-read-only tools pause for visible human approval.
- Ambiguous write failures stop; they are never automatically retried.
- Human state edits invalidate stale model decisions.
- Booking, payment, credentials, deletion and irreversible actions are never autonomously executable.
- Public deployment requires a separate explicit release approval.
