# Runtime limitations and safety boundary

WebMCP Loom is a bounded, model-neutral in-page runtime. It is intentionally not
an autonomous browser operator or an authorization system for arbitrary sites.

## Browser API maturity

`document.modelContext`, `registerTool()`, `getTools()`, and `executeTool()`
follow the current WebMCP draft. Browser behavior can change. The adapter keeps
draft-specific behavior in one package boundary, and unsupported environments
must visibly report that WebMCP is unavailable.

## Authorization boundary

The runtime requests visible approval for any tool not marked read-only in its
trusted local registry. A remote WebMCP tool's `readOnlyHint` is not trusted by
default. Direct platform execution of a page's registered tool is outside the
in-page runtime's approval callback, so every page-owned executor must validate
its own input and enforce its own domain authorization.

## State boundary

The runtime detects revision changes before and around a tool call. That check
does not make an external write atomic. WebMCP execution options carry
cancellation but no custom revision field, so a state-changing WebMCP tool must
accept an expected revision in its schema and compare-and-swap it in the
page-owned domain layer.

## Execution boundary

The runtime requires one JSON decision per step and supports a deliberately
bounded JSON Schema subset. Unsupported schema features fail closed. It bounds
goal, tool surface, model decision, input, result, error, revision, and step
sizes. It does not retry ambiguous write failures.

## Retrieval boundary

The deterministic selector narrows only the tools and response schema shown to
the model. It is lexical and workflow-aware, not semantic proof that a tool can
satisfy the goal. It cannot grant authority, skip canonical validation, or make
untrusted tool output into instructions. A write that requires a returned id
or revision remains hidden until successful prior history supplies that
evidence, but the executor still owns the final domain check.

## Product boundary

The reference fixtures stage reversible local state only. They do not expose
booking, payment, credential, account, deletion, or irreversible actions to
autonomous execution. Public deployment, a production model selection, cloud
adapter parity, and benchmark conclusions each require their own evidence and
approval; none follows merely from a passing fixture.

## Evidence boundary

A green local test or CI run proves only the exercised environment and current
head. Browser visual checks, exact-head review, and a separate deployment
approval remain required for a release.

The first committed Qwen3 0.6B result predates `travel-deterministic-v1`. A
second complete 30-by-3 run records the profile id, exact source revision and
model artifact on every attempt. It reaches 100% schema-valid decisions but
zero complete task passes and zero identifier reuse, so Qwen3 0.6B remains
ineligible. That comparison has no current-run memory sample and does not
serialize its decoding defaults; even with those gaps closed, its correctness,
approval and recovery failures independently block selection.
