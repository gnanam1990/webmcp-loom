# Benchmarks

This directory owns deterministic evidence for model adapters and prompting.
It does not redefine runtime safety or tool executors.

## Current foundation

- `schema.ts` defines task, result, metric and failure records.
- `smoke-tasks.ts` defines the first ten deterministic Day 1 tasks.
- `deployment-scenarios.ts` defines the deployment-parity outcome contract and
  validates runner observations against its required tools and outcomes.
- `failure-taxonomy.md` keeps model, adapter, tool and runtime defects
  separately attributable.
- `model-matrix.md` records candidate local models and the gates that must pass
  before a showcase model is selected.
- `webmcp-fixture.test.ts` proves discovery, approval and execution through the
  real runtime WebMCP bridge.

The executable deployment runner, local adapter and retrieval baseline are Day
2 work. The scenario assertions are foundation contracts, not evidence that a
deployment run has occurred. The runner must
consume these contracts and the runtime's public `RuntimeModel` contract; they
must not add a second execution or approval policy.

## Result reporting

Every recorded result contains the exact task id and fixture, model descriptor,
terminal runtime outcome, assertion results, normalized failure (if any), tool
trace, schema-valid rate, identifier-reuse rate and latency. Memory is required
whenever the selected backend can expose a reliable measurement.

The Day 4 selection report expands this suite to at least 30 tasks and includes
all repeated attempts, including failed and invalid runs.

## Foundation verification

The root verification command typechecks this directory. To repeat only its
focused checks:

```bash
npx tsc -p benchmarks --pretty false
npx vitest run benchmarks
```
