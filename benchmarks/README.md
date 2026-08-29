# Benchmarks

This directory owns deterministic evidence for model adapters and prompting.
It does not redefine runtime safety or tool executors.

## Current foundation

- `schema.ts` defines task, result, metric and failure records.
- `smoke-tasks.ts` defines the first ten deterministic Day 1 tasks.
- `failure-taxonomy.md` keeps model, adapter, tool and runtime defects
  separately attributable.
- `model-matrix.md` records candidate local models and the gates that must pass
  before a showcase model is selected.

The runner, local adapter and retrieval baseline are Day 2 work. They must
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

Until the repository deliberately adds this directory to its root project
references, run its checks explicitly:

```bash
npx tsc -p benchmarks --pretty false
npx vitest run benchmarks/schema.test.ts
```
