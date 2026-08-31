# Runtime-prompt v2 local rerun — 2026-08-28

> **Evidence status:** exploratory prompt probe, not selection-grade benchmark
> evidence. Hardware, operating system, exact llama.cpp build, artifact
> digests, peak memory, and runner-produced assertion records were not retained
> for this rerun. The latency observations below must be repeated with those
> fields before they can satisfy the measurement protocol.

This rerun evaluates the revised prompt emitted by the built runtime, rather
than a hand-written approximation. It is still a pre-integration benchmark: it
uses a deterministic three-tool fixture with the travel surface's relevant
schemas and outputs. The complete ten-tool domain is on its owner branch and
must merge before this becomes the application acceptance suite.

## Prompt changes

The runtime prompt now makes four requirements explicit, including immediately
before the model output:

- tool descriptions and schemas are capability metadata, not application facts;
- tool input may contain only `inputSchema.properties` keys, and a zero-property
  schema requires exactly `{}`;
- reuse identifiers and revisions from successful history instead of repeating
  a completed search; and
- emit a tool call, rather than a final answer, when an available tool can
  obtain a missing fact or apply the requested action.

## Method

- Prompt and schema: `buildAgentRuntimePrompt()` and
  `getAgentDecisionSchema()` from the built `@webmcp-loom/runtime` package.
- Fixture: `get_trip_constraints`, `search_flights`, and
  `add_itinerary_item`, with the same field shapes as the travel-domain
  contract.
- Model request: one user message containing the generated runtime prompt;
  JSON Schema response mode; temperature `0`; seed `42`; 128 maximum tokens.
- Judge: runtime parser plus exact tool and input comparison. This is a strict
  decision judge, not a natural-language quality score.
- Engine: CPU-only local llama.cpp, 4,096-token context. Latency is local API
  wall-clock time and excludes model load and memory measurement.

## Results

| Candidate | Live-read decision | Identifier-reuse decision | Verdict |
| --- | --- | --- | --- |
| LFM2.5-1.2B-Instruct Q4_K_M | pass, 4,144 ms | fail, 7,666 ms | Chose the read tool correctly; repeated `search_flights`. |
| Qwen3.5-0.8B Q4_0 | pass, 3,447 ms | pass, 4,819 ms | Only completed candidate to pass both decisions. |
| Gemma 3 1B IT Q4_K_M | fail, 8,452 ms | fail, 8,091 ms | Put an invented `properties` object into a zero-field input, then repeated the search. |
| MiniCPM5-1B Q4_K_M | fail, 4,658 ms | fail, 4,620 ms | Treated the schema as tool input, then repeated the search. |
| G9v3-3B Q4_K_M | pass, 12,162 ms | fail, 13,814 ms | Read correctly; repeated the search. |
| Ternary Bonsai-1.7B Q2_0 | no usable result | no usable result | Prism server remained healthy but emitted no usable decision in three attempts under the full runtime prompt. |
| Bonsai-1.7B Q1_0 | pass, 8,539 ms | fail, 10,447 ms | Read correctly; repeated the search. |

## Judge conclusion

The prompt change has a positive but model-specific effect: Qwen3.5-0.8B now
passes both strict decisions, including exact reuse of `fl-tokyo-day-02` and
revision `1`. It does not generalize to the other tested models, so it is not
evidence that the prompt is universally solved.

Qwen3.5-0.8B is a follow-up candidate for a reproducible runner round. It is
not a showcase selection: a real selection still needs the merged travel fixture,
the ten smoke tasks, thirty total deterministic tasks, repeated attempts,
approval/state-recovery checks, and memory measurements.
