# Task Factory Documentation

## Scope

This is the canonical documentation index for Task Factory.
All subject docs live as flat markdown files directly under `docs/`.

## Use when

- You are onboarding to this repository
- You need architecture, runtime, API, or contribution references
- You want one-hop links to canonical docs (no nested README indirection)

## Quick start

1. Start with [Getting Started](./getting-started.md).
2. Review [Workflow and Queue](./workflow-and-queue.md) for task lifecycle behavior.
3. Use [CLI Reference](./cli-reference.md) and [Contribution Commands](./contribution-commands.md) for day-to-day commands.

## Reference

### Canonical subject pages

| Subject | Canonical page | Purpose |
|---|---|---|
| getting-started | [getting-started.md](./getting-started.md) | Local setup, first run, and repository map |
| cli-reference | [cli-reference.md](./cli-reference.md) | CLI usage, runtime flags, and environment variables |
| workflow-and-queue | [workflow-and-queue.md](./workflow-and-queue.md) | Pipeline phases, planning/execution behavior, and queue controls |
| system-architecture | [system-architecture.md](./system-architecture.md) | Runtime boundaries and ownership |
| runtime-flows | [runtime-flows.md](./runtime-flows.md) | End-to-end planning/execution/queue flow details |
| state-contract | [state-contract.md](./state-contract.md) | Canonical mode/phase/planning contract rules |
| api-rest-reference | [api-rest-reference.md](./api-rest-reference.md) | HTTP endpoint contracts |
| api-websocket-events | [api-websocket-events.md](./api-websocket-events.md) | WebSocket event contracts |
| operations-security-posture | [operations-security-posture.md](./operations-security-posture.md) | Security model and accepted-risk handling |
| contribution-commands | [contribution-commands.md](./contribution-commands.md) | Build/dev/test/release command reference |
| contribution-extensions-skills | [contribution-extensions-skills.md](./contribution-extensions-skills.md) | Extension and execution-skill customization |

## Examples

- New contributor path: [getting-started.md](./getting-started.md) -> [workflow-and-queue.md](./workflow-and-queue.md) -> [contribution-commands.md](./contribution-commands.md)
- Runtime/API path: [system-architecture.md](./system-architecture.md) -> [runtime-flows.md](./runtime-flows.md) -> [api-rest-reference.md](./api-rest-reference.md) and [api-websocket-events.md](./api-websocket-events.md)

## Notes

Per the current migration scope, troubleshooting docs, runbook/template docs, and a docs-style-guide page are intentionally excluded from this pass.

## Related docs

- [Repository README](../README.md)
