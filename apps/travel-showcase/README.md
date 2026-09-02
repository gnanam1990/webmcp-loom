# `@webmcp-loom/travel-showcase`

The deterministic Japan travel domain, collaborative application, shared state, and canonical WebMCP tool surface for the showcase.

## What is implemented

- typed trip, itinerary, budget, flight, stay, activity and destination entities;
- fixed inventory with no clock, network or randomness, so benchmark tasks and live demos see identical data;
- a shared store whose revision increments on every accepted write;
- compare-and-swap on agent writes, and revision-free human edits that preserve canonical domain invariants;
- ten tool definitions with schemas, read/write annotations and deterministic executors;
- a responsive itinerary, budget, trace and visible-approval interface;
- one application factory that hands the same store and tool array to the in-app runtime and document WebMCP registration;
- undo, a visible execution-backend indicator, and application-native highlights;
- an opt-in WebGPU/WebLLM backend loader with visible progress, clear failure and retry states;
- a versioned deterministic retrieval profile that limits each model prompt to at most four relevant tools;
- deterministic domain, collaboration, accessibility-helper and WebMCP integration tests.

## Shared state and revisions

One store backs both the human interface and the agent's tools. That is the point of the showcase: the two are not looking at copies of the same data.

Human edits go through `editAsHuman` and always apply. Agent writes go through `addItem`, `removeItem` or `moveItem`, each of which requires the revision the plan was built against and throws `TravelDomainError('stale_revision')` if the state has moved on.

```ts
import { createTravelTools, createTripStore } from '@webmcp-loom/travel-showcase';

const store = createTripStore();
const tools = createTravelTools(store);

// The person drags an item off the board. Revision moves 1 -> 2.
// Flights carry no city, so keep anything without one and drop Osaka.
store.editAsHuman((items) => items.filter((item) => !('cityId' in item) || item.cityId !== 'osaka'));

// An agent write still holding revision 1 is now rejected rather than applied.
store.addItem(1, { kind: 'activity', activityId: 'ac-osa-castle', date: '2026-11-12' });
```

Read tools return the current `revision` alongside their data, and write tools require it back as `expectedRevision`. That round trip is deliberate. WebMCP's `executeTool()` carries cancellation but no revision token, so a revision passed out-of-band by the in-app runtime would be invisible to an external agent calling the same tool. Carrying it in the validated input contract means both callers are held to the same check, enforced inside the page-owned executor.

When the in-app runtime also supplies its captured revision, the executor requires the two to agree.

The store publishes accepted commits to subscribers. That notification is what lets an external WebMCP write invalidate the session snapshot and immediately update the visible itinerary and budget. Rejected writes do not emit.

## WebMCP registration

The browser entry point calls `installDocumentRuntimeTools()` with the exact tool array used by the in-app session. In browsers that expose `document.modelContext`, all ten tools are registered and share the visible application state. Unsupported browsers keep the in-app experience working and return `null` from the registration adapter.

Registration is cancellation-bound to the page lifecycle. A deterministic integration test supplies a draft-compatible `document.modelContext`, verifies all ten registrations, executes an external write, and proves the session snapshot advances to the same revision.

## Tool surface

Seven read tools, three write tools.

| Tool | Read-only | Purpose |
| --- | --- | --- |
| `get_trip_constraints` | yes | Budget cap, dates, origin, must-keep cities, booking disabled |
| `get_itinerary` | yes | Staged items and the current revision |
| `get_budget_summary` | yes | Committed, remaining, over-cap flag, per-kind split |
| `list_destinations` | yes | Available cities and suggested nights |
| `search_flights` | yes | Filter by route, date, price, red-eye |
| `search_stays` | yes | Filter by city and nightly price |
| `search_activities` | yes | Filter by city, tag and price |
| `add_itinerary_item` | no | Stage a flight, stay or activity |
| `remove_itinerary_item` | no | Remove a staged item |
| `move_itinerary_item` | no | Move a staged item to another date |

Write tools carry `readOnlyHint: false`, so the runtime pauses each one for visible human approval.

## Deterministic retrieval

`travel-deterministic-v1` ranks the current goal and successful history against
the canonical ten-tool surface. Initial move/remove goals expose the itinerary
read before their writes; search-backed staging stays hidden until a returned
catalogue id and revision exist; and explicit read-only goals never advertise
a write. The profile then caps the model-visible surface at four tools.

This changes prompt size, not authority. All ten tools remain in the page-owned
registry, the runtime refreshes that registry before execution, and canonical
schema, approval and stale-state checks still apply. The profile id and version
are exported so a retrieval-assisted benchmark can bind the exact configuration
to its report. The first retained Qwen result predates the profile; the
subsequent 30-by-3 report binds it to every attempt and still records zero
complete task passes. Retrieval is therefore implemented and measured, but it
does not select that model.

Schemas stay inside the runtime's bounded JSON Schema subset. A test asserts this, because a keyword the runtime does not support fails closed at registration rather than degrading quietly.

## Browser-local model probe

The production build keeps the multi-megabyte WebLLM engine out of the normal
scripted path. To load one explicit model artifact, append its registered
WebLLM id to the preview URL:

```text
?localModel=Qwen3-0.6B-q4f16_1-MLC
```

This is a probe path, not a selected default. It requires WebGPU and downloads
the requested model assets through `@mlc-ai/web-llm`; the browser may cache
those assets for later loads. The interface reports loading progress, prevents
runs until the backend is ready, and offers a retry after a clear load failure.
It never falls back to a proprietary inference service.

Loading successfully proves only adapter and browser compatibility. Model
selection still requires the complete deterministic corpus, repeated attempts,
identifier-reuse and safety assertions, latency, memory and exact artifact
provenance described in `benchmarks/model-matrix.md`.

## Safety boundary

There is no booking, payment, credential, account or deletion capability, and none may be added. Staging changes the plan a person sees; it reserves nothing. A test asserts the absence of these capabilities across every tool name and title.

## Runtime types

The package imports `RuntimeTool`, executor context and JSON types directly from `@webmcp-loom/runtime`; there is no ambient or structural mirror to drift. TypeScript project references build the runtime declarations before checking or building the application, including from a clean checkout. Tool schemas are validated by the runtime's real `assertValidToolSchema()` implementation in the travel test suite.

## Verification

From the repository root:

```bash
npm run verify
```
