# Runtime Flows

This document explains how planning, execution, and queue automation run at runtime.

## 1) Foreman planning flow (workspace-level)

Primary code paths:

- Client: `packages/client/src/hooks/usePlanningStreaming.ts`
- Server API: `packages/server/src/index.ts` (`/planning/*` routes)
- Session orchestration: `packages/server/src/planning-agent-service.ts`

### Flow

1. UI sends `POST /api/workspaces/:id/planning/message`.
2. `planning-agent-service` gets/creates a workspace planning session.
3. Service builds the Foreman system prompt (`buildPlanningSystemPrompt`) and prepends the state contract (`mode=foreman`).
4. Foreman-scoped extensions run through callback bridges:
   - `create_draft_task`, `create_artifact`
   - `manage_new_task`
   - `factory_control`
   - `ask_questions`
5. Pi SDK events are translated into WebSocket events (`planning:*`, `qa:request`, `shelf:updated`).
6. Client hook (`usePlanningStreaming`) merges persisted + live messages and updates chat/QA/shelf UI.

### Notes

- Planning session messages are persisted under `.pi/planning-messages.json`.
- `resetPlanningSession` archives old sessions and clears active state.

## 2) Task planning flow (task-level plan generation)

Primary code path: `packages/server/src/agent-execution-service.ts` (`planTask`).

### Flow

1. Triggered on task creation (when no plan exists) or manual regeneration.
2. Server marks `planningStatus = running` and logs a state transition.
3. Planning prompt enforces `task_planning` mode contract and guardrails (`timeoutMs`, `maxToolCalls`).
4. Agent investigates and must call `save_plan` exactly once.
5. `save_plan` callback persists:
   - normalized acceptance criteria
   - plan object
   - `planningStatus = completed`
6. Optional automation: if enabled, backlog task auto-promotes to `ready`, then requests a queue kick.
7. Failure path sets `planningStatus = error` and logs a transition.

## 3) Task execution flow

Primary code paths:

- Server API: `POST /tasks/:taskId/execute` in `packages/server/src/index.ts`
- Session orchestration: `packages/server/src/agent-execution-service.ts`

### Flow

1. API moves task to `executing` (if needed) and logs transition metadata.
2. `executeTask` opens/resumes a per-task Pi session (`sessionFile` backed).
3. Prompt includes:
   - acceptance criteria
   - instructions
   - task state contract (`mode=task_execution`)
4. Optional pre-hooks run (`runPreExecutionSkills`).
5. Agent streams text/thinking/tool events to WebSocket (`agent:*` events).
6. Completion split:
   - If agent **does not** call `task_complete` → task stays executing, status becomes `awaiting_input`.
   - If agent calls `task_complete` → server runs post-hooks + post-execution summary, then calls completion callback.
7. Completion callback moves task `executing → complete` and kicks queue for next work.

### Important behavior

- `task_complete` is a signal tool, not a phase move by itself; the server performs the actual state transition.
- Execution may be resumed across turns/sessions using persisted conversation files.

## 4) Queue manager coordination (ready→executing automation)

Primary code paths:

- `packages/server/src/queue-manager.ts`
- `packages/server/src/queue-kick-coordinator.ts`

### Coordinator model

- `queue-manager.ts` registers a workspace kick handler with `registerQueueKickHandler`.
- Other modules request work via `requestQueueKick(workspaceId)` without importing queue internals.

### Kick sources

- Manual task move to `ready`.
- Execution completion (capacity opens).
- Planning auto-promotion backlog→ready.
- Poll interval safety tick (30s).

### Queue processing rules

1. Skip if disabled or already processing.
2. Respect executing WIP limit from resolved workflow settings.
3. Recover orphaned executing tasks after restart:
   - resume if safe
   - or move back to ready when recently failed.
4. Pick next ready task using FIFO semantics over phase order.
5. Move selected task to `executing`, log transition, run `executeTask`.
6. On successful completion callback, move task to `complete`, broadcast, and kick again.

## Startup recovery

At server startup (`index.ts`):

- `initializeQueueManagers(...)` resumes queues that were enabled.
- `resumeInterruptedPlanningRuns()` restarts interrupted planning (`planningStatus=running`) and legacy unplanned backlog tasks with no saved plan.

## Related docs

- [System Architecture](./system-architecture.md)
- [State Contract (canonical)](./state-contract.md)
- [Getting Started](../setup/getting-started.md)
- [Developer Commands Reference](../contribution/developer-commands.md)
