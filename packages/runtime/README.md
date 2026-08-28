# `@webmcp-loom/runtime`

A bounded, model-neutral agent loop plus a bridge to the evolving WebMCP browser API.

## What is implemented

- dynamic tool discovery for every model step and immediately before execution;
- exact JSON model decisions and deterministic input validation;
- a fail-closed, bounded subset of JSON Schema;
- visible approval handoff for every tool not explicitly marked read-only;
- no automatic retry after ambiguous write failures;
- cancellation, step limits, bounded outputs/errors/history and isolated event observers;
- optimistic state-revision checks around model, approval and read execution;
- canonical WebMCP registration and in-page discovery/execution adapters.

The package has no runtime dependencies. It is private while its contracts are being proven by the showcase and benchmark tracks.

## Basic use

```ts
import {
  createStaticToolProvider,
  runAgentRuntime,
  type RuntimeModel,
  type RuntimeTool,
} from '@webmcp-loom/runtime';

const tools: RuntimeTool[] = [{
  name: 'inspect_item',
  title: 'Inspect item',
  description: 'Read one item by identifier.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: ({ id }) => ({ id, ready: true }),
}];

const model: RuntimeModel = {
  generate: async ({ prompt, responseSchema, signal }) => {
    return callYourModel({ prompt, responseSchema, signal });
  },
};

const result = await runAgentRuntime({
  goal: 'Inspect item fixture-1.',
  model,
  toolProvider: createStaticToolProvider(tools),
});
```

The model must return exactly one of:

```json
{"type":"tool_call","tool":"inspect_item","input":{"id":"fixture-1"}}
```

```json
{"type":"final","message":"The item is ready."}
```

## Write and state safety

`readOnlyHint` is a security boundary. Missing or false means write-capable and causes an approval pause. When an approval callback is supplied, it receives a detached snapshot; mutating that object cannot alter the validated call.

`getStateRevision` provides optimistic stale-state detection. The captured value is also passed to local executors as `expectedStateRevision`. A state-owning write executor must enforce that value atomically—such as with compare-and-swap—if concurrent edits are possible. Preflight revision checks alone cannot make an async write atomic.

WebMCP's standard `executeTool()` options currently carry cancellation but not a custom revision token. A WebMCP-exposed state-changing tool must therefore put its expected revision in its own validated input contract and enforce it inside the page-owned executor.

## WebMCP bridge

```ts
import {
  createWebMcpToolProvider,
  installDocumentRuntimeTools,
} from '@webmcp-loom/runtime';

await installDocumentRuntimeTools(tools);

const result = await runAgentRuntime({
  goal,
  model,
  toolProvider: createWebMcpToolProvider(document.modelContext, {
    fromOrigins: [location.origin],
    trustedReadOnlyOrigins: [location.origin],
  }),
});
```

The bridge follows the current draft shapes for `document.modelContext`, `registerTool()`, `getTools()` and `executeTool()`. WebMCP is still evolving, so browser-specific access stays behind this adapter and unsupported environments return `null` from `installDocumentRuntimeTools()`.

WebMCP tool metadata cannot prove what an executor actually does. The provider therefore treats every discovered tool as write-capable by default, even when it declares `readOnlyHint: true`. Add an origin to `trustedReadOnlyOrigins` only when that origin and its tool implementations are under the application's security control. `fromOrigins` limits discovery but does not grant this trust by itself.

Primary references:

- [official WebMCP draft specification](https://github.com/webmachinelearning/webmcp/blob/main/index.bs)
- [official WebMCP explainer](https://github.com/webmachinelearning/webmcp/blob/main/README.md)

## Supported schema subset

The runtime supports object/array/string/number/integer/boolean/null types; properties, required and additional properties; array item/count bounds; string length bounds; numeric bounds; and enum/const. Unsupported keywords such as composition or references fail closed instead of being partially interpreted.

## Verification

From the repository root:

```bash
npm run verify
```

This runs repository checks, lint, strict typechecking, unit/integration tests, the production package build, a smoke flow against built JavaScript and a high-severity dependency audit.
