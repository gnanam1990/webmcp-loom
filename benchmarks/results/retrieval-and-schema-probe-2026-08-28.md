# Small-model retrieval and schema probe — 2026-08-28

## Why this probe exists

Prompt-only tuning did not make the small models reliably multi-step. In a
five-scenario built-runtime suite, LFM2.5-1.2B passed the live read while
Qwen3.5-0.8B prematurely finalized it. Both passed the itinerary-item move,
but each failed other identifier-reuse or already-complete cases. That is
enough evidence to avoid treating a short two-case pass as a model-selection
result.

## Safety improvement: tool-specific decision schemas

The runtime now derives the model response schema from the tools available at
that exact decision. A model can therefore emit only:

- `final`; or
- one current tool name, with that tool's actual input schema.

This prevents an otherwise schema-valid envelope from inventing a tool that is
not currently available. Runtime validation remains the execution boundary;
the constrained response schema reduces invalid output before it reaches that
boundary.

## Retrieval probe

The real `search_flights` tool removes red-eye results when called with
`excludeRedEye: true`. The probe therefore supplied the only valid returned
flight, `fl-day`, then narrowed the next tool surface to the applicable write:
`add_itinerary_item`. Its tool-specific schema allowed only `kind: "flight"`
and required `expectedRevision`, `refId`, and `date`.

LFM2.5-1.2B Q4_K_M returned:

```json
{
  "type": "tool_call",
  "tool": "add_itinerary_item",
  "input": {
    "date": "2026-11-02",
    "expectedRevision": 1,
    "kind": "flight",
    "refId": "fl-day"
  }
}
```

The strict judge passed this decision.

## Conclusion

Small models should not receive the full static tool surface for every
decision. The Day 2 retrieval baseline should deterministically rank/filter
currently relevant tools and preserve validated result identifiers, while the
runtime supplies the matching per-tool response schema. This is a measured
reliability strategy, not a replacement for runtime validation or a claim that
LFM2.5 is already ready for the complete showcase.
