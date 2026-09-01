# Task-board WebMCP fixture

This is the runtime's second thin integration fixture. It deliberately uses a
small task board rather than the travel application, proving that the public
runtime and WebMCP bridge are not coupled to travel state or tool executors.

The page creates exactly one canonical tool array:

- `get_task_board` returns tasks and the current revision;
- `stage_task` is write-capable, needs visible approval, and compares the
  revision returned by the read against page-owned state.

The same array is registered with `document.modelContext` and rediscovered by
the in-page runtime through `createWebMcpToolProvider`. The page can show an
approval handoff, a user-approved staging run, a human edit, and a stale-state
stop. It never sends, books, pays for, deletes, or persists anything outside
the page.

## Run locally

```bash
npm run build --workspace @webmcp-loom/runtime
npx vite examples/taskboard-webmcp --host 127.0.0.1 --port 5175
```

Use a browser with the draft WebMCP `document.modelContext` API available. The
fixture reports an unsupported state instead of simulating registration when
that browser API is absent.

## Automated proof

```bash
npx vitest run examples/taskboard-webmcp/taskboard.test.js
npx vite build examples/taskboard-webmcp --outDir /tmp/webmcp-loom-taskboard-build
```

The test uses a memory WebMCP context only to exercise the public registration,
discovery and execution adapter in Node. The browser page itself always uses
the real document API.
