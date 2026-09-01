# Benchmarks

This directory owns deterministic evidence for model adapters and prompting.
It does not redefine runtime safety or tool executors.

## Current foundation

- `schema.ts` defines task, result, metric and failure records.
- `fixtures.ts` materialises each declared fixture id into a real store, built
  through the domain write path so a starting state cannot describe a trip the
  domain would reject.
- `oracles.ts` holds one reference solution per task, and `oracles.test.ts`
  executes each against the real tool surface. This proves the reference call
  sequence and its declared constraints are executable before a model is asked
  to solve it: without it an unsatisfiable fixture is indistinguishable from a
  model failure, and the taxonomy would record a `model_decision` fault for a
  defect in the task.
- `smoke-tasks.ts` defines the first ten deterministic Day 1 tasks.
- `travel-tasks.ts` extends that coverage with goals the tool surface cannot
  satisfy, and workflows deep enough to need four or five calls. Each task is
  there because it tests something the smoke suite does not; volume alone would
  inflate a pass rate without measuring more.
- `deployment-scenarios.ts` defines the deployment-parity outcome contract and
  validates runner observations against its required tools and outcomes.
- `failure-taxonomy.md` keeps model, adapter, tool and runtime defects
  separately attributable.
- `model-matrix.md` records candidate local models and the gates that must pass
  before a showcase model is selected.
- `webmcp-fixture.test.ts` proves discovery, approval and execution through the
  real runtime WebMCP bridge.

`runner.ts` is the deterministic single-task runner. It executes a supplied
`RuntimeModel` through the public runtime contract and the real travel tools,
then records tool traces, observable assertions, runtime outcome and metrics.
It deliberately does not add a second execution or approval policy.

`batch.ts` runs each supplied task a fixed number of times with an explicitly
configured model factory. It retains every attempt and calculates decision-
weighted schema validity, complete-task pass rate and mean latency; it never
downloads a model, selects a candidate or discards failed attempts.

## Result reporting

Every recorded result contains the exact task id and fixture, model descriptor,
terminal runtime outcome, assertion results, normalized failure (if any), tool
trace, schema-valid rate, identifier-reuse rate and latency. Memory is required
whenever the selected backend can expose a reliable measurement.

The Day 4 selection report expands this suite to at least 30 tasks and includes
all repeated attempts, including failed and invalid runs.

## Local Ollama batch

`local-ollama.ts` binds a batch to the Ollama server version and exact artifact
digest before it starts. It never downloads a model or silently uses a cloud
candidate. The script retains every attempt and prints a JSON report; write it
only when an explicit new output path is supplied (it will not overwrite one).

After `npm run build`, run a small local smoke probe like this:

```bash
WEBMCP_OLLAMA_MODEL=qwen3:0.6b \
WEBMCP_BENCHMARK_ATTEMPTS=1 \
WEBMCP_BENCHMARK_TASK_IDS=smoke-read-constraints \
npm run benchmark:ollama
```

That probe is explicitly exploratory. A report is selection-eligible only if
it runs all 30 tasks three times and supplies both JSON objects below:

```text
WEBMCP_BENCHMARK_HARDWARE_JSON={"name":"...","architecture":"...","operatingSystem":"...","latencyBudgetMs":...,"memoryBudgetBytes":...}
WEBMCP_BENCHMARK_MEMORY_JSON={"method":"...","peakMemoryBytes":...,"samplingIntervalMs":...}
```

The memory method must observe the model-serving process or browser runtime,
not merely the caller shell. Missing, over-budget or invalid measurements remain
selection blockers in the report.

## Foundation verification

The root verification command typechecks this directory. To repeat only its
focused checks:

```bash
npx tsc -p benchmarks --pretty false
npx vitest run benchmarks
```
