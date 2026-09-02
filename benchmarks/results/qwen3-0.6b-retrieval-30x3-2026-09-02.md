# Qwen3 0.6B retrieval-assisted Ollama run - 2026-09-02

> **Verdict: ineligible.** Deterministic tool retrieval removed malformed
> decisions in this run, but it did not produce a single complete task pass.
> This artifact is failure evidence, not a local-model selection or deployment
> claim.

## Run identity

| Field | Value |
| --- | --- |
| Runner source | `05f05007e10d12a800d8a1a9cd386dbfdbc1808a` |
| Retrieval profile | `travel-deterministic-v1`, version 1, maximum 4 tools |
| Backend / model | local Ollama / `qwen3:0.6b` |
| Artifact digest | `7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435` |
| Family / parameters | Qwen3 / 751.63M |
| Quantization | `Q4_K_M` |
| Context length | 40,960 |
| Ollama version | `0.31.1` |
| Environment | arm64, Darwin 25.6.0 |

The launcher derived the source revision from the checked-out `HEAD`. The same
profile identity is retained at the top level, batch level and in all 90
attempts. The committed JSON is the unmodified runner output with SHA-256
`899a6d5f3d097c46c63d574135a9c8d732827437e4341e572730c14a8cdd76da`.

## Protocol and evidence boundary

- all 10 smoke tasks and all 20 extended travel tasks;
- three attempts per task, with all 90 attempts retained;
- deterministic fixtures and the real runtime, selector, tool and policy path;
- temperature `0`, seed `42`, and maximum 128 generated tokens;
- no cloud fallback, best-run filtering, manual result deletion, model download,
  hardware declaration or current-run memory sample.

Because hardware and memory evidence were not supplied, this is an exploratory
correctness comparison. Even a current memory sample could not rescue the
selection verdict: correctness, identifier reuse, approval and recovery gates
all fail independently.

## Results

| Gate | Required | Observed | Result |
| --- | ---: | ---: | --- |
| Complete task success | >=90% | 0/90 (0%) | Fail |
| Schema-valid decisions | >=98% | 90/90 (100%) | Pass |
| Identifier reuse | 100% | 0% | Fail |
| Safety, approval and recovery assertions | 100% | at least one failure | Fail |
| p95 end-to-end latency | declared target required | 1,171 ms | Exploratory only |
| Peak combined RSS | declared target required | not sampled | Not measured |

Mean end-to-end latency was 700.11 ms. Every attempt returned a syntactically
valid `completed` runtime outcome, but none satisfied all observable task
assertions. Runtime completion is therefore not counted as task success.

| Primary failure | Attempts |
| --- | ---: |
| `approval_missing` | 51 |
| `missing_read` | 36 |
| `denial_mishandled` | 3 |

## Comparison with the retained pre-retrieval run

| Metric | Pre-retrieval v1 | Retrieval-assisted v2 |
| --- | ---: | ---: |
| Complete task success | 0/90 | 0/90 |
| Schema-valid decisions | 87/90 (96.67%) | 90/90 (100%) |
| Identifier reuse | 0% | 0% |
| p95 latency | 1,451 ms | 1,171 ms |
| Mean latency | 847.62 ms | 700.11 ms |
| Malformed JSON failures | 3 | 0 |

The comparison supports only a narrow conclusion: the smaller prompt surface
improved decision-format reliability and observed latency for this run. It did
not improve complete task success, required reads, write approval behavior or
identifier reuse. `qwen3:0.6b` remains rejected for the showcase.
