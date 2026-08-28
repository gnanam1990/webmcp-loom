# WebMCP Loom

**Weave one semantic WebMCP tool surface across external agents and a first-class collaborative agent inside the application.**

WebMCP made websites usable by agents. WebMCP Loom makes them agent-native for people.

## Status

This repository is in the team-foundation stage. The product direction, ownership boundaries, review workflow, and Day 1–6+ plan are defined. Implementation branches begin from protected `main` only after this bootstrap receives explicit merge approval and is merged.

The earlier [Latchwork runtime foundation](https://github.com/gnanam1990/latchwork/pull/7) is evidence and a source implementation to review before porting. It is not yet code in this repository.

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

The runtime remains model-neutral. The application remains the visible output. Write-capable tools require visible human approval; booking, payment, account, credential, deletion, and irreversible actions are outside autonomous execution.

## Bootstrap verification

```bash
bash scripts/verify-repo.sh
```

Implementation PRs will replace this documentation-only gate with lint, typecheck, unit/integration tests, production build, and dependency audit.

## Contribution flow

All substantive changes use a focused branch and pull request. An implementation PR may be opened only after the complete local test/build gate and a running-app visual check pass. Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting.

## License

MIT
