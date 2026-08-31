# Local-model baseline — 2026-08-28

> **Evidence status:** preliminary exploratory baseline, not selection-grade
> evidence. The engine build and decoding configuration were retained, but the
> hardware profile, operating system, model artifact digests, peak memory, and
> runner-produced assertion records were not. Repeat these probes through the
> benchmark runner before using them for selection.

This is preliminary evidence, not a showcase-model selection. It covers two
deterministic decision probes per candidate; the selection gate still requires
at least 30 tasks, three attempts per task, declared memory measurement, and a
fixed target-hardware budget.

## Method

- Engine: local `llama.cpp` server, build `b10107-c0bc8591e`.
- Configuration: CPU-only, 4,096-token context, temperature `0`, seed `42`,
  maximum completion `128` tokens.
- Format enforcement: the server received the runtime's exact two-variant
  agent-decision JSON Schema (`tool_call` or `final`) through its JSON Schema
  response mode.
- Judge: exact decision shape, exact allowed-tool choice, and exact input
  values. Object-key order is ignored; extra or missing input fields fail.
- Latency: wall-clock request time to a localhost server. It includes prompt
  evaluation and generation, but not model-load time or memory measurement.

## Probes

| Probe | Required decision |
| --- | --- |
| `read-constraints` | `get_trip_constraints` with input `{}`. |
| `reuse-non-red-eye-id` | `add_itinerary_item` with `expectedRevision: 1`, `kind: "flight"`, `refId: "fl-tokyo-day-02"`, and `date: "2026-11-02"`, after the history already contains that only non-red-eye flight. |

## Results

| Model artifact | `read-constraints` | `reuse-non-red-eye-id` | Judge verdict |
| --- | --- | --- | --- |
| Ternary Bonsai-1.7B Q2_0 | pass, 1,270 ms | fail, 3,964 ms | Valid output, but repeated `search_flights` instead of staging the returned id. |
| Bonsai-1.7B Q1_0 | pass, 2,762 ms | fail, 7,638 ms | Valid output, but prematurely finalized the multi-step task. |
| LFM2.5-1.2B-Instruct Q4_K_M | pass, 1,664 ms | fail, 5,041 ms | Valid output, but repeated `search_flights` instead of staging the returned id. |
| Qwen3.5-0.8B Q4_0 | fail, 835 ms | pass, 2,164 ms | Correct id reuse; for the zero-field tool it supplied the tool schema as the input. Its non-thinking template mode was required. |
| Gemma 3 1B IT Q4_K_M | pass, 2,354 ms | fail, 6,281 ms | Valid output, but repeated `search_flights` instead of consuming the returned id. |
| MiniCPM5-1B Q4_K_M | fail, 1,392 ms | fail, 3,266 ms | Finalized without reading constraints, then repeated `search_flights`. |
| G9v3-3B Q4_K_M | pass, 4,085 ms | pass, 10,682 ms | The only candidate to pass both decisions. |

## Raw judged decisions

### Ternary Bonsai-1.7B

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{}}
```

```json
{"type":"tool_call","tool":"search_flights","input":{"originCode":"BLR","destinationCode":"NRT","departureDate":"2026-11-02","excludeRedEye":true}}
```

### Bonsai-1.7B

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{}}
```

```json
{"type":"final","message":"Stage the best fitting option for a flight from BLR to Tokyo on 2026-11-02, excluding red-eye flights and selecting the most cost-effective and suitable option."}
```

### LFM2.5-1.2B-Instruct

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{}}
```

```json
{"type":"tool_call","tool":"search_flights","input":{"originCode":"BLR","destinationCode":"NRT","departureDate":"2026-11-02","excludeRedEye":true}}
```

### Qwen3.5-0.8B

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{"type":"object","properties":{},"additionalProperties":false}}
```

```json
{"type":"tool_call","tool":"add_itinerary_item","input":{"expectedRevision":1,"kind":"flight","refId":"fl-tokyo-day-02","date":"2026-11-02"}}
```

### Gemma 3 1B IT

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{}}
```

```json
{"type":"tool_call","tool":"search_flights","input":{"originCode":"BLR","destinationCode":"NRT","departureDate":"2026-11-02","excludeRedEye":true}}
```

### MiniCPM5-1B

```json
{"type":"final","message":"Inspect the trip constraints and tell me whether booking is available."}
```

```json
{"type":"tool_call","tool":"search_flights","input":{"originCode":"BLR","destinationCode":"NRT","departureDate":"2026-11-02","excludeRedEye":true}}
```

### G9v3-3B

```json
{"type":"tool_call","tool":"get_trip_constraints","input":{}}
```

```json
{"type":"tool_call","tool":"add_itinerary_item","input":{"expectedRevision":1,"kind":"flight","refId":"fl-tokyo-day-02","date":"2026-11-02"}}
```

## Judge conclusion

G9v3-3B remains the sole provisional leader. It is eligible for the next
benchmark round, not selected: one run of two probes per candidate cannot
establish reliability or memory fit. Among candidates that passed
`read-constraints` but failed `reuse-non-red-eye-id`, Ternary Bonsai-1.7B had
the lowest recorded reuse-probe latency. It still repeated a completed read
instead of consuming the result. LFM2.5-1.2B remains
a useful latency-oriented candidate, but its baseline ID-reuse failure means it
needs retrieval/prompt work before it can carry the showcase flow. The runner
must keep JSON Schema enforcement enabled: without it, LFM2.5 appended narrative
text after an otherwise correct JSON decision, which the runtime would correctly
reject.
