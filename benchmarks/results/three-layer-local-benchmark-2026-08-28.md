# Three-layer local benchmark — 2026-08-28

> **Evidence status:** exploratory architecture probe, not a recorded
> `BenchmarkResult` and not valid for model selection. The run did not retain
> exact task ids/fixtures, per-run tool traces and assertions, latency,
> schema-valid/identifier-reuse rates, hardware/OS, engine build, artifact
> digests, or the exact G9v3 run window. Repeat it through the benchmark runner
> before using these observations in a selection decision.

## Architecture under test

1. A deterministic fixture retriever exposes only the applicable next tool.
2. The runtime generates a response schema from that exact tool surface.
3. The local model fills the validated call arguments or returns `final` when
   no tool is applicable.

The suite has five deterministic scenarios: live read, filtered-flight staging,
stay staging, itinerary-item move, and a final response after a completed move.
Every model uses temperature `0`, seed `42`, local llama.cpp, and the built
runtime prompt/schema.

## Results

| Model | Passed | Result |
| --- | ---: | --- |
| LFM2.5-1.2B Q4_K_M | 4 / 5 | Read, stay, move, and justified-final scenarios passed. For a flight, it selected the right id/revision/date but the wrong permitted `kind`. |
| Qwen3.5-0.8B Q4_0 | 3 / 5 | Stay, move, and justified-final scenarios passed. It prematurely finalized the live read and added a harmless-but-unwanted `nights: 0` to the flight. |
| G9v3-3B Q4_K_M | inconclusive | The server did not return a complete harness result in the run window. |

For comparison, the broader five-tool prompt without retrieval left both LFM2.5
and Qwen at 2 / 5 on the same categories. The architecture therefore improves
the two tested small models materially, but it does not yet meet a release gate.

## Next refinement

The retriever knows a filtered result's entity type. It should be able to add a
temporary response-schema restriction such as `kind: "flight"` for a selected
flight candidate, while the runtime continues to validate the final input
against the canonical travel-tool schema. That resolves LFM2.5's remaining
flight mismatch without granting the model extra authority.
