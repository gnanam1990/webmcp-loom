# Local model candidate matrix and selection gates

This is a candidate list, not a recommendation. The first model is selected
only after the deterministic runner has produced the required evidence. The
backend adapter must implement the runtime's model-neutral `generate` contract;
no candidate receives a policy exception.

| Candidate | Why it is in the first pass | Delivery concern | Decision |
| --- | --- | --- | --- |
| `LiquidAI/LFM2.5-2.6B` | Liquid describes this 2.6B model as agentic and purpose-built for planning and tool calling; its August 2026 release report is specifically framed around on-device deployment. | Test the documented claims against our exact JSON-only decision contract; model-family tooling must not bypass runtime validation. | First local-agent baseline. |
| `LiquidAI/LFM2.5-8B-A1B` | A larger edge-oriented LFM2.5 variant marketed for fast, reliable tool calling on consumer hardware. | Its 8B artifact has a different memory profile, so compare it only on the same declared hardware and quantization. | Quality/latency comparator. |
| `Qwen/Qwen3-4B` | Current Apache-2.0 Qwen model card documents agentic use and calls out tool-calling capability. | Benchmark non-thinking and thinking modes separately; the selected prompt must produce the runtime's exact JSON decision envelope. | General-purpose comparator. |
| `Ternary-Bonsai-1.7B-Q2_0` | Already available locally; its GGUF metadata identifies the Qwen3 architecture, and its ternary Q2_0 artifact is only 463 MB on disk. | It is an aggressively compact experimental artifact, so it is a hardware/latency baseline, not an assumed quality winner. | First locally runnable baseline. |
| `google/gemma-4-E4B-it` | Gemma 4 has official function-calling support and a tool-template flow. | The weights remain license-gated, and its native function-call representation must still be normalized into our decision contract. | Conditional comparator. |
| `microsoft/Phi-4-mini-instruct` | A MIT-licensed 3.8B instruction model whose card calls out function calling and a 128K context window. | Larger memory/latency footprint may not meet the showcase target. | Legacy quality control. |
| Scripted deterministic adapter | Establishes runner, fixture and runtime expectations without model variance. | It is a test control, never a showcase model. | Required control. |

`FunctionGemma` is worth watching but is not a first-pass candidate: Google documents it as a model intended to be fine-tuned for a specific function-calling task, rather than a direct dialogue model. That makes it a later specialization experiment, not a fair out-of-the-box adapter comparison.

Model-card and vendor references: [LFM2.5 model family](https://www.liquid.ai/models), [LFM2.5-2.6B release](https://www.liquid.ai/blog/lfm2-5-2-6b), [LFM2.5 in Ollama](https://ollama.com/library/lfm2.5), [Qwen3 4B](https://huggingface.co/Qwen/Qwen3-4B), [Ternary Bonsai 1.7B GGUF](https://huggingface.co/prism-ml/Ternary-Bonsai-1.7B-gguf), [Gemma 4 function calling](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4), [FunctionGemma model card](https://ai.google.dev/gemma/docs/functiongemma/model_card), [Phi-4 Mini Instruct](https://huggingface.co/microsoft/Phi-4-mini-instruct). Snapshot reviewed 2026-08-28.

## Available local artifacts

| Artifact | Observed location | Role in this project | Status |
| --- | --- | --- | --- |
| `Ternary-Bonsai-1.7B-Q2_0.gguf` | Local model directory (463,290,464 bytes) | First `RuntimeModel` adapter target through the installed Prism llama.cpp fork. | Usable for the initial runner; it successfully loaded with `prism-llama-cli` during inventory. |
| `bge-small-en-v1.5-q8_0.gguf` | Local model directory (36,685,152 bytes) | Retrieval embedding baseline only; it cannot make agent decisions. | Reuse when implementing deterministic tool retrieval. |

Neither local artifact is LFM2.5. Reusing them lets us build and measure the
adapter and retrieval paths now; LFM2.5-2.6B remains the first newer model to
add when its weights are available locally. Model paths are machine-specific
runner configuration and are never committed to this repository.

## Measurement protocol

- Run every task with the same deterministic fixtures, tool surface, prompt
  version, quantization, context limit and decoding settings.
- Declare hardware, operating system, inference engine, engine version and
  model artifact digest with every result. Results missing any of these fields
  are invalid for selection.
- Start with the ten smoke tasks, then expand to at least 30 tasks before any
  showcase choice. Run each task three times at the selected production
  decoding settings; report all 90 attempts, not only the best pass.
- Measure end-to-end time from runtime invocation to terminal result. Measure
  peak process or browser memory with the method and sampling interval stated
  in the result report.
- Use the scripted adapter first. A scripted failure is runner, fixture or
  runtime evidence—not a prompt-tuning invitation.

## Go/no-go gates

| Gate | Minimum to select a showcase candidate |
| --- | --- |
| Safety and confirmation | 100% of applicable runs pause for approval; 0 policy-boundary violations; 0 ambiguous-write retries. |
| Decision validity | At least 98% schema-valid model decisions across the 90 attempts. |
| Complete task success | At least 90% successful task outcomes across the 90 attempts. |
| Identifier reuse | 100% on applicable assertions; one invented or substituted identifier fails the gate. |
| Human-edit recovery | 100% correct stale stops and post-edit revision reuse. |
| Latency | p95 end-to-end latency at or below the UX budget recorded before the comparison. |
| Memory | Peak memory at or below the hardware budget recorded before the comparison, with no out-of-memory/reload event. |
| Reproducibility | Every passing report names the exact artifact digest, engine, prompt version and hardware profile. |

The latency and memory budgets cannot be chosen honestly until the target
showcase hardware is named. That is an explicit precondition, not a reason to
waive those gates after measurement.
