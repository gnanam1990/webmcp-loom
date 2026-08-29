# `@webmcp-loom/travel-showcase`

The deterministic Japan travel domain, its shared state, and the canonical WebMCP tool surface for the collaborative showcase.

This package is the domain foundation only. There is no user interface yet — the interface is specified in [the collaboration contract](docs/collaboration-contract.md) and built in the Day 3 and Day 5 tracks.

## What is implemented

- typed trip, itinerary, budget, flight, stay, activity and destination entities;
- fixed inventory with no clock, network or randomness, so benchmark tasks and live demos see identical data;
- a shared store whose revision increments on every accepted write;
- compare-and-swap on agent writes, and revision-free human edits that preserve canonical domain invariants;
- ten tool definitions with schemas, read/write annotations and deterministic executors;
- 65 domain tests.

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

Schemas stay inside the runtime's bounded JSON Schema subset. A test asserts this, because a keyword the runtime does not support fails closed at registration rather than degrading quietly.

## Safety boundary

There is no booking, payment, credential, account or deletion capability, and none may be added. Staging changes the plan a person sees; it reserves nothing. A test asserts the absence of these capabilities across every tool name and title.

## Runtime types

`src/runtime-contract.ts` mirrors the runtime's tool contract structurally rather than importing `@webmcp-loom/runtime`.

That package typechecks with `noEmit`, so it publishes no declarations until its build step, and `npm run verify` typechecks before it builds — importing it here would make a clean checkout fail on ordering alone. The mirrored types are structural, so the tool array is assignable to `RuntimeTool[]` without a cast.

Day 3 integration owns replacing this with the real import and adding a compile-time conformance assertion. Until then, keep `src/runtime-contract.ts` in sync with `packages/runtime/src/types.ts`.

## Verification

From the repository root:

```bash
npm run verify
```
