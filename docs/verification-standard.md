# Verification Standard

## Rule

An implementation pull request is created only after the exact proposed head passes the complete local test/build gate and the built application is run and inspected visually. CI and code review repeat or extend that evidence; they do not substitute for it.

## Before opening a pull request

The author must:

1. run formatting/lint, typecheck, unit tests, integration tests, production build, and dependency/security audit through the repository's complete verification command;
2. start the production-like local preview and confirm the expected URL responds;
3. test every changed user flow and its relevant loading, empty, error, cancellation, approval, and recovery states;
4. inspect the application through the in-app browser, using the user's computer/browser when native UI, permissions, extensions, signed-in state, or environment-specific behavior requires it;
5. check affected desktop and mobile layouts, relevant keyboard behavior, and browser console/network failures;
6. retain concise screenshot or recording evidence and record exact commands, results, URL, flows, viewports, and untested boundaries in the PR.

Any failure resets the gate: fix the defect and rerun the complete sequence before opening the PR.

## During review

The author reviews the exact pushed head. A non-author reviewer then checks the diff and repeats the risk-relevant local run and visual flow on that same head. Findings are fixed with tests where applicable, and the full gate is rerun after every behavioral fix.

## Before merge

Merge is allowed only when:

- the reviewed head has not changed;
- the required CI checks are green;
- all review conversations are resolved;
- local test, production build, local preview, and visual evidence are recorded;
- the reviewer records a clear verdict tied to the head SHA;
- the user explicitly approves the merge.

Public deployment is a separate action and requires separate explicit approval.

## Documentation-only exception

For changes that cannot affect executable behavior or rendered application output, runtime/build/visual items may be marked not applicable with a concrete reason. The repository documentation verification and exact-diff review still apply.
