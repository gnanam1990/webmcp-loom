# WebMCP Loom

**Weave one semantic WebMCP tool surface across external agents and a first-class collaborative agent inside the application.**

WebMCP made websites usable by agents. WebMCP Loom makes them agent-native for people.

## Status

The runtime and collaborative travel foundations are merged: bounded multi-step execution, deterministic validation, approval and stale-state boundaries, cancellation, a model-neutral contract, WebMCP adapters, a shared-state Japan planner, visible approvals, responsive UI, tests and built-package smoke fixtures.

The travel application now creates one canonical tool array for both its in-app runtime and document WebMCP registration. External WebMCP writes update the same subscribed store the visible board reads, so the two entry points cannot drift onto separate state.

The earlier [Latchwork runtime foundation](https://github.com/gnanam1990/latchwork/pull/7) remains source evidence; WebMCP Loom's implementation is independently structured and revalidated here.

## Team ownership

| Owner | Primary responsibility |
| --- | --- |
| Gnanasekaran | Runtime Core, WebMCP bridge, safety/policy, final integration |
| Anandh | local models, prompting, tool retrieval, benchmarks and measured results |
| Vasanth | collaborative travel app, domain tools, UI/UX and deployment readiness |

See [the complete team work split](docs/team-work-split.md), [product direction](docs/product-direction.md), and [mandatory verification standard](docs/verification-standard.md).

## Planned architecture

```text
packages/runtime/          reusable bounded agent loop and WebMCP bridge
packages/model-adapters/   local and optional cloud inference adapters
apps/travel-showcase/      collaborative Japan travel reference application
benchmarks/                deterministic tasks, runner, results and failure taxonomy
docs/                      architecture, decisions, integration and demo evidence
```

The runtime remains model-neutral. The application remains the visible output. Write-capable tools require visible human approval; booking, payment, account, credential, deletion, and irreversible actions are outside autonomous execution. See the [runtime package guide](packages/runtime/README.md) for its implemented boundary and API.

## Verification

```bash
npm run verify
```

The gate covers repository checks, lint, strict typechecking, unit/integration tests, production build, built-package local smoke execution and dependency audit. The browser smoke fixture in `examples/runtime-smoke/` provides a visual check of the built package before runtime PRs are opened.

## Contribution flow

All substantive changes use a focused branch and pull request. An implementation PR may be opened only after the complete local test/build gate and a running-app visual check pass. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting.

## License

MIT
