# Contributing

## Required workflow

1. Start from the latest clean `main` after prerequisite PRs merge.
2. Create one owner-scoped branch for one coherent change.
3. Add deterministic tests or evidence for every behavioral claim.
4. Run the complete repository verification command locally.
5. Commit with a descriptive conventional commit message.
6. Open a pull request and record exact local evidence and scope boundaries.
7. Self-review the exact head, then obtain at least one non-author review for implementation PRs.
8. Fix demonstrated findings, rerun the complete gate, and wait for required CI.
9. Merge only the reviewed unchanged head after explicit merge approval.

Direct substantive pushes to `main` are not allowed. The license-only root commit is the repository bootstrap exception.

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

## Safety invariants

- Model output is untrusted and schema-validated before tool execution.
- Dynamic tool availability is refreshed during a run.
- Non-read-only tools pause for visible human approval.
- Ambiguous write failures stop; they are never automatically retried.
- Human state edits invalidate stale model decisions.
- Booking, payment, credentials, deletion and irreversible actions are never autonomously executable.
- Public deployment requires a separate explicit release approval.
