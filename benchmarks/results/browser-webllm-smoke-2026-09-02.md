# Browser WebLLM smoke — 2026-09-02

> **Evidence status:** exploratory browser compatibility and failure probe, not
> selection-grade model evidence. The run did not execute the 30-task corpus
> three times, capture peak browser memory, retain an exact model artifact
> digest, or record a precise cold-load timer. No showcase model is selected.

## Tested implementation and environment

- Implementation commit: `73ccca6` on `feat/browser-webllm-loader`.
- Build gate: `npm run verify` passed with 399 tests, lint, strict typecheck,
  production build, built-runtime smoke and a high-severity dependency audit.
- Preview: production Vite build at `http://127.0.0.1:4183/`.
- Hardware: Mac mini, Apple M4, 16 GB memory.
- Operating system: macOS 26.6 (Darwin 25.6.0).
- Browser surface: Codex in-app browser with WebGPU available. The exact
  browser build was not retained, so browser-version comparison is blocked.
- Adapter: `@mlc-ai/web-llm` 0.2.84 through
  `createWebLlmRuntimeModel()`.
- Requested model id: `Qwen3-0.6B-q4f16_1-MLC`.
- Decoding: temperature `0`, seed `42`, maximum 128 output tokens, WebLLM JSON
  response schema, thinking requested off.

The first observed load entered the visible loading state and reached ready
between the 30-second and 60-second checks. The cache state was not independently
verified, so this is not a cold-load measurement. A later reload from the same
browser origin reached ready in under the 500 ms observation interval. Ten
travel WebMCP tools were registered and browser error/warning logs were empty.

## Transport finding

Before commit `73ccca6`, a direct raw-decision probe captured this response even
though thinking was disabled:

```text
<think>

</think>

{"type": "final", "message": "trip_constraints"}
```

The runtime correctly rejected the framing as malformed JSON. The WebLLM
adapter now removes only one leading whitespace-only `<think></think>` transport
block. Non-empty reasoning, code fences, trailing prose and malformed JSON are
still returned unchanged and fail the runtime's strict parser. The production
showcase now bundles the model adapter from source so a parallel workspace build
cannot silently package stale adapter output.

## Observed task outcomes

### Constraints-only goal

Goal:

```text
Read the trip constraints and tell me whether booking is available.
```

The corrected adapter produced schema-parseable decisions and the run reached a
terminal result. The trace showed `search_flights`, not
`get_trip_constraints`, and the final answer claimed booking status without the
required constraints read. This attempt fails tool selection and grounded
completion even though transport parsing succeeded.

### Hero goal

Goal:

```text
Prepare a 10-day Japan trip under ₹1.5L. Keep Tokyo and Kyoto, avoid red-eye
flights, and do not book anything.
```

The model emitted a final answer claiming that a plan had been prepared. It made
no visible tool call, the itinerary stayed empty at revision 1, and committed
spend stayed at ₹0. This attempt fails complete-task success and grounded state
change. No write or approval transition occurred.

## Gate verdict

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| Browser/WebGPU model load | Pass for this environment | Model reached `ready`; exact browser build and cold-load timing missing. |
| WebMCP registration during local mode | Pass for this run | Ten tools reported registered; no console errors. |
| Strict JSON transport | Pass after narrow adapter normalization | Empty transport wrapper removed; semantic decisions remain unmodified. |
| Complete task success | Fail | Both observed goals were semantically incorrect; hero state remained empty. |
| Correct tool selection | Fail | Constraints goal selected `search_flights`. |
| Multi-step reasoning and identifier reuse | Not demonstrated | Hero run made no visible calls. |
| Approval and human-edit recovery | Not exercised | No write was proposed. |
| Latency and memory budgets | Blocked | No precise p95 corpus latency or peak browser-memory measurement. |
| Reproducibility | Blocked | Exact model artifact digest and browser build were not retained. |

The loader is viable on the tested hardware, but this Qwen 0.6B browser artifact
is not eligible as the showcase default from these observations. The next model
evidence must use the deterministic 30-task corpus, retain all three attempts per
task, record exact artifact/browser provenance and peak browser memory, and
preserve failed attempts rather than tuning around them.
