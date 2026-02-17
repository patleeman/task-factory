# System Architecture

## Scope

Stable architectural boundaries for Task Factory.

## Use when

- You are deciding where implementation changes belong
- You need a quick map of ownership across client/server/shared/extensions
- You are reviewing architectural impact of a feature

## Quick start

1. Identify the user-facing behavior.
2. Map it to the owning layer below.
3. Keep lifecycle policy in server code; keep extension logic as adapters.

## Reference

### Core layers

| Layer | Primary path | Responsibilities |
|---|---|---|
| Client UI | `packages/client/src` | Rendering, local UI state, HTTP calls, WS subscriptions |
| Server runtime | `packages/server/src` | Persistence, REST/WS contracts, planning/execution orchestration, queue automation |
| Shared contracts | `packages/shared/src` | Shared task/event/workflow TypeScript types |
| Extensions | `extensions/*.ts` | Pi tool adapters that bridge to server callbacks |

### Server ownership map

| Area | Primary files |
|---|---|
| Composition root + routes | `packages/server/src/index.ts` |
| Task persistence | `packages/server/src/task-service.ts` |
| Task planning/execution orchestration | `packages/server/src/agent-execution-service.ts` |
| Workspace Foreman planning | `packages/server/src/planning-agent-service.ts` |
| Queue automation | `packages/server/src/queue-manager.ts` |
| State contract + transitions | `packages/server/src/state-contract.ts`, `state-transition.ts` |

### Persistence model

| Path | Purpose |
|---|---|
| `.pi/tasks/<task-id>/task.yaml` | Canonical task state |
| `.pi/planning-messages.json` | Foreman planning chat history |
| `.pi/planning-sessions/*.json` | Archived planning sessions |
| `.pi/workspace-context.md` | Workspace-shared context |
| `~/.taskfactory/` | Global settings and workspace registry |

## Examples

| Change request | Start in |
|---|---|
| Add a new REST endpoint | `packages/server/src/index.ts` + service modules |
| Update a task/event type | `packages/shared/src/types.ts` |
| Add a UI panel | `packages/client/src/components` |
| Add a new tool for agents | `extensions/<tool>.ts` |

## Related docs

- [Runtime Flows](./runtime-flows.md)
- [State Contract](./state-contract.md)
- [Contribution Extensions + Skills](./contribution-extensions-skills.md)
