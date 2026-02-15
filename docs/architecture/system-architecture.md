# System Architecture

This document describes the stable architectural boundaries in Task Factory.

## Scope

Task Factory is a monorepo with four core layers:

| Layer | Primary paths | Responsibilities |
|---|---|---|
| Client UI | `packages/client/src` | Route-level UX, local view state, HTTP calls, WebSocket subscriptions, and rendering live planning/execution streams. |
| Server runtime | `packages/server/src` | Owns task/workspace persistence, API + WebSocket contracts, planning/execution orchestration, queue automation, and lifecycle enforcement. |
| Shared contracts | `packages/shared/src/types.ts` | Canonical TypeScript types for tasks, events, workflow settings, and helper functions used by both client and server. |
| Extension layer | `extensions/*.ts` | Pi tool definitions that bridge agent tool calls (for example `save_plan`, `task_complete`, `manage_new_task`) into server-owned callbacks. |

## Boundary responsibilities

### 1) Client (`packages/client`)

- Uses `api.ts` for HTTP operations.
- Maintains one workspace-scoped WebSocket (`useWebSocket`) and fan-outs events to feature hooks.
- Converts transport events into UI state:
  - `usePlanningStreaming` for Foreman streams + QA prompts + shelf updates.
  - `useAgentStreaming` for task execution streams.
- Does **not** implement lifecycle rules; it reflects server decisions.

### 2) Server (`packages/server`)

- `index.ts` is the composition root:
  - HTTP routes
  - WebSocket broker (`broadcastToWorkspace`)
  - startup recovery (queue + interrupted planning)
- `task-service.ts` is the file-backed task source of truth (`.pi/tasks/<task-id>/task.yaml`).
- `agent-execution-service.ts` owns task planning runs, execution sessions, hook execution, and completion handling.
- `planning-agent-service.ts` owns Foreman conversational planning sessions per workspace.
- `queue-manager.ts` owns automated ready→executing dispatch and execution chaining.
- `state-contract.ts` + `state-transition.ts` define and log lifecycle mode/phase contracts.

### 3) Shared types (`packages/shared`)

- Defines canonical task/workspace/event schema (`Task`, `TaskFrontmatter`, `ServerEvent`, `QueueStatus`, etc.).
- Exposes workflow helpers used by both sides (for example `resolveWorkspaceWorkflowSettings`).
- Prevents contract drift between client and server by centralizing transport and state types.

### 4) Extension layer (`extensions`)

Extensions are tool adapters, not business-logic owners:

- Server registers callbacks in global registries before agent turns (for example `globalThis.__piFactoryPlanCallbacks`).
- Extension tools resolve those callbacks and return typed tool results.
- Lifecycle decisions stay server-side (for example `task_complete` signal handling, plan persistence, queue kicks).

This keeps runtime policy in server code while still exposing ergonomic tools to agents.

## Persistence model at a glance

Primary persisted state lives under workspace `.pi/` directories:

- Tasks: `.pi/tasks/<task-id>/task.yaml`
- Planning messages: `.pi/planning-messages.json`
- Planning session archives: `.pi/planning-sessions/*.json`
- Legacy shelf staging: `.pi/shelf.json` (used by shelf API paths; inline Foreman session outputs are session-scoped)
- Workspace shared context: `.pi/workspace-context.md`

Global Task Factory settings and workspace registry live under `~/.taskfactory/`.

## Related docs

- [Runtime Flows](./runtime-flows.md)
- [State Contract (canonical)](./state-contract.md)
- [Getting Started](../setup/getting-started.md)
- [Developer Commands Reference](../contribution/developer-commands.md)
