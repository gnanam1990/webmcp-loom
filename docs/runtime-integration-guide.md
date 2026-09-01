# Runtime integration guide

This guide shows how to connect a page-owned capability surface to both the
browser's WebMCP API and WebMCP Loom's in-page runtime. It describes the APIs
merged on `main`; it is not a claim that every model adapter or benchmark track
is complete.

## 1. Define one page-owned tool surface

Create one `RuntimeTool[]` array. The tool metadata and executor must come from
the same domain owner; do not define a second, slightly different array for
document registration or the in-app agent.

```ts
function assertExactKeys(input: unknown, allowed: readonly string[]): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new Error('Tool input does not match its schema.');
  }
}

function assertStageInput(input: unknown): asserts input is {
  expectedRevision: number;
  title: string;
} {
  assertExactKeys(input, ['expectedRevision', 'title']);
  const value = input as Record<string, unknown>;
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 1
    || typeof value.title !== 'string'
    || value.title.length < 1
    || value.title.length > 80) {
    throw new Error('Tool input does not match its schema.');
  }
}

const tools: RuntimeTool[] = [
  {
    name: 'get_board',
    title: 'Get board',
    description: 'Read the staged items and their revision.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: (input) => {
      assertExactKeys(input, []);
      return board.snapshot();
    },
  },
  {
    name: 'stage_item',
    title: 'Stage item',
    description: 'Stage an item at the revision returned by get_board.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRevision: { type: 'integer', minimum: 1 },
        title: { type: 'string', minLength: 1, maxLength: 80 },
      },
      required: ['expectedRevision', 'title'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: (input) => {
      assertStageInput(input);
      return board.stage(input.expectedRevision, input.title);
    },
  },
];
```

The executor repeats its input-shape and domain checks. A direct WebMCP call
does not pass through the in-page runtime's schema validation. For writes,
`expectedRevision` is part of the tool's public input contract and the domain
must enforce it atomically.

## 2. Register and clean up document tools

Register the exact same array with `document.modelContext`. Unsupported browsers
return `null`; show an unsupported state and do not simulate a registration.

```ts
const lifecycle = new document.defaultView.AbortController();
let registration = null;

document.defaultView.addEventListener('pagehide', (event) => {
  if (event.persisted) return; // Keep registrations alive across BFCache.
  lifecycle.abort();
  registration?.dispose();
});

registration = await installDocumentRuntimeTools(tools, {
  signal: lifecycle.signal,
});
```

The pending-registration cancellation is important: a terminal navigation must
not leave a registration completing after the page has gone away. A lifecycle
helper may replace this explicit pattern only after it is merged and documented
as part of the public package API.

## 3. Rediscover the surface for the in-page runtime

The in-page agent discovers tools through the browser adapter instead of
importing the application's state or executors directly.

```ts
const toolProvider = createWebMcpToolProvider(document.modelContext, {
  fromOrigins: [document.location.origin],
  trustedReadOnlyOrigins: [document.location.origin],
});

const result = await runAgentRuntime({
  goal: 'Read the board and stage the requested item.',
  model,
  toolProvider,
  getStateRevision: () => board.snapshot().revision,
  approve: showVisibleApproval,
  onEvent: appendTrace,
});
```

`fromOrigins` narrows discovery; it does **not** mark another origin as safe to
run without approval. The runtime treats WebMCP tools as write-capable unless
their origin appears in `trustedReadOnlyOrigins` and that implementation is
under the page owner's control.

## 4. Render runtime outcomes explicitly

Render `approval_required`, `denied`, `write_failed`, `stale_state`,
`cancelled`, `step_limit`, and `completed` as separate UI states. Store the
event trace with the visible state so people can see the selected tool and the
point at which a run stopped.

Do not turn an approval-required result into an implicit approval. A later
approved retry must use current state and must not reuse a stale write.

## 5. Minimum integration proof

Before opening a runtime integration PR, prove all of the following against the
built package:

1. the browser shows the registered WebMCP tools;
2. a write stops at visible approval and makes no state change;
3. an approved write uses the same page state seen by a person;
4. a human edit invalidates an already planned write;
5. terminal page cleanup cancels or disposes registration, while BFCache does
   not; and
6. direct executor calls reject malformed input and unknown properties.

The task-board fixture under `examples/taskboard-webmcp/` is the portable
reference proof. The travel showcase remains the collaboration-focused proof.
