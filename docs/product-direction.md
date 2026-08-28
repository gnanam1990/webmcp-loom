# Product Direction

## Positioning

An agent-native runtime for WebMCP applications: define a site's semantic capabilities once, then use the same WebMCP surface for external agents and a first-class collaborative agent inside the application.

The runtime is the product. Local inference is one backend. The showcase application proves the runtime rather than becoming a chatbot demo.

## Showcase

The primary reference application is a deterministic collaborative travel planner.

Hero goal:

> Prepare my 10-day trip to Japan under ₹1.5L. Keep Tokyo and Kyoto, avoid red-eye flights, and do not book anything.

The agent must complete a 2–6 tool-call workflow, reuse intermediate identifiers, build the itinerary in the application, and respect the no-booking boundary. A person then removes or moves an itinerary item. The next agent run reads the changed WebMCP state and repairs the plan without stale overwrite.

The application—not a chat transcript—is the visible output.

## Required capability proof

- one canonical tool definition serves external WebMCP registration and the in-app runtime;
- dynamic tools are refreshed rather than assumed static;
- intermediate tool results are reused in later calls;
- model decisions and tool inputs fail closed under validation;
- write-capable actions pause for visible approval;
- action trace identifies the active tool and affected application entity;
- human edits and agent actions operate on the same state;
- stale decisions are rejected after state changes;
- local and cloud adapters obey the same runtime policy contract;
- a second thin fixture proves the runtime is not travel-specific.

## Evaluation

The benchmark must include at least 30 deterministic tasks covering:

- selection and filtering;
- intermediate identifier reuse;
- multi-step state changes;
- recovery after human edits;
- schema validity and unavailable tools;
- confirmation correctness;
- latency and memory;
- backend interchangeability.

Report complete-task success, schema-valid rate, identifier reuse, state recovery, confirmation correctness, latency, memory and failure categories. Do not select a showcase model from anecdotal outputs.

## Priority order

1. reliable WebMCP agent loop;
2. live shared-state collaboration;
3. excellent reference application;
4. local open-model proof;
5. model-backend abstraction;
6. reusable developer package;
7. benchmark evidence and polished documentation.

Automatic model routing, extra showcase applications and a large integration catalog are optional only after the required proof passes.

## Safety boundary

The showcase may search, inspect and stage itinerary changes. It does not expose booking, payment, credential, account, deletion or irreversible actions to autonomous execution. Public deployment is a separate approved release step.

## Source and status

This direction is derived from the final strategic revision in **WebMCP Agent-Native Runtime Winning PRD v3**, especially sections 49–58 (pages 15–19). The source DOCX remains outside this repository; this file records the implementation-relevant direction without claiming the planned features are already built here.
