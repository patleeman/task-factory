# Runtime Flows

## Scope

Runtime flow reference for Foreman planning, task planning, task execution, and queue coordination.

## Use when

- You need to trace how a request moves through the system
- You are debugging planning/execution lifecycle behavior
- You are modifying queue automation and want impact context

## Quick start

Follow one task through this order:

1. Foreman workspace planning (optional ideation)
2. Task planning (`save_plan` path)
3. Task execution (`task_complete` signal path)
4. Queue kick + next ready dispatch

## Reference

### 1) Foreman planning flow

| Step | Summary |
|---|---|
| 1 | UI sends `POST /api/workspaces/:id/planning/message` |
| 2 | Server gets/creates workspace planning session |
| 3 | Session runs in `foreman` mode contract |
| 4 | Foreman tools run via callbacks (`create_draft_task`, `factory_control`, etc.) |
| 5 | Server emits `planning:*`, `qa:request`, `shelf:updated` WS events |

### 2) Task planning flow

| Step | Summary |
|---|---|
| 1 | `planTask` marks `planningStatus=running` |
| 2 | Planning run enforces `task_planning` contract |
| 3 | Agent investigates and must call `save_plan` once |
| 4 | Server persists criteria + plan, sets `planningStatus=completed` |
| 5 | Optional auto-promotion moves task `backlog -> ready` |

### 3) Task execution flow

| Step | Summary |
|---|---|
| 1 | Execute API moves task to `executing` |
| 2 | Server resumes/opens task Pi session |
| 3 | Prompt includes acceptance criteria + `task_execution` contract |
| 4 | Optional pre-execution skills run |
| 5 | Agent streams text/thinking/tool events over WS |
| 6 | `task_complete` signal triggers completion callback and post hooks |
| 7 | Server moves task to `complete` and requests next queue kick |

### 4) Queue manager flow

| Step | Summary |
|---|---|
| 1 | Skip if queue disabled or already processing |
| 2 | Respect executing WIP limit |
| 3 | Recover orphaned executing tasks after restart |
| 4 | Pick next ready task (FIFO semantics) |
| 5 | Move to `executing` and run `executeTask` |
| 6 | On completion, move to `complete` and kick queue again |

### Startup recovery

At server startup, queue managers resume for enabled workspaces and interrupted planning runs are restarted.

## Examples

```text
Typical automated path:
backlog (planning running)
  -> backlog (planning completed)
  -> ready
  -> executing
  -> complete
```

## Related docs

- [Workflow and Queue](./workflow-and-queue.md)
- [State Contract](./state-contract.md)
- [System Architecture](./system-architecture.md)
