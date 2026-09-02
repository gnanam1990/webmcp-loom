# Qwen3 0.6B local Ollama gate - 2026-09-02

> **Verdict: ineligible.** This run does not select a showcase model and does
> not prove browser-WebLLM behavior. It is a complete local Ollama run over the
> current 30-task deterministic corpus, retained for reproducible failure
> evidence.

## Run identity

| Field | Value |
| --- | --- |
| Runner head | `29ba6e412a1255ab6b6cd585d3454c3a947af08e` |
| Backend | local Ollama |
| Model | `qwen3:0.6b` |
| Artifact digest | `7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435` |
| Family / parameters | Qwen3 / 751.63M |
| Quantization | `Q4_K_M` |
| Context length | 40,960 |
| Ollama version | `0.31.1` |
| Hardware | Mac mini, Apple M4, 16 GB, arm64 |
| Operating system | macOS 26.6 / Darwin 25.6.0 |
| Declared latency budget | 20,000 ms p95 |
| Declared memory budget | 8 GiB combined serving RSS |

The runner defaults at this head were temperature `0`, seed `42`, and
`maxTokens=128`. Those decoding values are source-bound rather than duplicated
inside the v1 JSON report; that is a reproducibility limitation and must be
fixed before treating a future passing report as selection evidence.

## Protocol

- 30 tasks: all 10 smoke tasks plus all 20 extended travel tasks;
- 3 attempts per task, with all 90 attempts retained;
- deterministic fixtures and the real runtime/tool/policy path;
- latency measured end to end for every attempt;
- combined RSS of the Ollama server and direct child runner sampled every
  100 ms across the full attempt window;
- no model download, cloud fallback, best-run filtering, or manual result
  deletion.

The raw runner output did not yet contain the separately sampled memory value.
The measured report adds only the `memory` object and recomputes `selection`,
which removes the missing-memory blocker. A repository test proves that no
attempt, assertion, metric, provenance field, or other run output changed.
The per-sample RSS time series was not retained, so the committed files cannot
independently reconstruct the peak from every sample; they retain the sampling
method, interval and measured peak. That limitation must be removed before a
future otherwise-passing result is used as final selection evidence. It does
not rescue or weaken this run's ineligible verdict because this model passes
the memory budget and fails correctness and safety gates independently.

## Results

| Gate | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Complete task success | >=90% | 0/90 (0%) | Fail |
| Schema-valid decisions | >=98% | 87/90 (96.67%) | Fail |
| Identifier reuse | 100% | 0% | Fail |
| Safety, approval, and recovery assertions | 100% | at least one failure | Fail |
| p95 end-to-end latency | <=20,000 ms | 1,451 ms | Pass |
| Peak combined RSS | <=8 GiB | 1,611,481,088 bytes (~1.50 GiB) | Pass |

Mean end-to-end latency was 847.62 ms. Eighty-seven attempts returned a
syntactically valid `completed` runtime outcome but still failed the task's
observable assertions; three attempts ended in `runtime_error`. Runtime
completion is therefore not counted as task success.

### Primary failure classification

| Failure | Attempts |
| --- | ---: |
| `approval_missing` | 48 |
| `missing_read` | 36 |
| `denial_mishandled` | 3 |
| `malformed_json` | 3 |

The model commonly emitted an unsupported final answer without performing the
required reads or writes. It did not demonstrate reliable intermediate-ID
reuse, approval behavior, or human-edit recovery.

## Selection decision

`selection.eligible` is `false` with four blockers:

1. schema-valid decision rate below 98%;
2. complete-task pass rate below 90%;
3. identifier reuse below 100%;
4. at least one safety, approval, or state-recovery assertion failed.

Passing latency and memory budgets cannot override correctness or safety
failures. This artifact must not be cited as a selected default model, a
browser-local success, or deployment evidence.

## Retained artifacts

- `qwen3-0.6b-ollama-30x3-2026-09-02.raw.json` - untouched runner output;
  SHA-256 `d9b20302096dd8c2d50ca080f2b743a08086fc57e3d22dc0fc369d00ae95d63b`.
- `qwen3-0.6b-ollama-30x3-2026-09-02.json` - measured-memory report with
  recomputed selection; SHA-256
  `bc3d5f329844ddd2b8cf78c529739da136426699cdc186fe5ab0f5dfa1c52646`.
