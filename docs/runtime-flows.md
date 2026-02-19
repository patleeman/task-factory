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
| 6 | Client hydrates pending Q&A from persisted messages plus `GET /qa/pending` fallback (for workspace resume/off-screen gaps); on successful `POST /qa/respond` or `POST /qa/abort`, it clears active Q&A locally immediately while later WS events reconcile idempotently |

### 2) Task planning flow

| Step | Summary |
|---|---|
| 1 | `planTask` marks `planningStatus=running` |
| 2 | Optional pre-planning skills run (fail-fast on first error) |
| 3 | Planning run enforces `task_planning` contract |
| 4 | Agent investigates and must call `save_plan` once |
| 5 | Server persists criteria + plan, sets `planningStatus=completed` |
| 6 | Optional auto-promotion moves task `backlog -> ready` |

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

Delete safety: `DELETE /api/workspaces/:workspaceId/tasks/:taskId` stops any active planning/execution session for the task before deleting files, and late completion/persistence callbacks no-op when the task no longer exists.

### 4) Queue manager flow

| Step | Summary |
|---|---|
| 1 | Skip if queue disabled or already processing |
| 2 | Respect executing WIP limit |
| 3 | Recover orphaned executing tasks after restart |
| 4 | Pick next ready task (FIFO semantics) |
| 5 | Move to `executing` and run `executeTask` |
| 6 | On completion, move to `complete` and kick queue again |

### Execution reliability telemetry and alerting

Execution emits structured reliability signals as `system-event` activity entries with `metadata.kind = "execution-reliability"`.

Key metadata fields:

- `signal`: `turn_start`, `first_token`, `turn_end`, `turn_stall_recovered`, `provider_retry_start`, `provider_retry_end`, `compaction_end`
- `eventType`: `turn`, `provider_retry`, `compaction`
- `sessionId`, `turnId`, `turnNumber`
- Outcome/timing fields: `outcome`, `durationMs`, `timeToFirstTokenMs`
- Failure context fields: `stallPhase`, `timeoutMs`, `toolName`, `toolCallId`, `errorMessage`, `attempt`, `maxAttempts` (retry-start), `delayMs`

#### Query path

Use existing activity APIs (`/api/workspaces/:workspaceId/activity` or `/api/workspaces/:workspaceId/tasks/:taskId/activity`) and filter on metadata.

```bash
# Example: fetch latest reliability events for a workspace
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/activity?limit=500" \
  | jq '.[]
    | select(.type=="system-event")
    | select(.metadata.kind=="execution-reliability")
    | {taskId, signal: .metadata.signal, outcome: .metadata.outcome, sessionId: .metadata.sessionId, turnId: .metadata.turnId}'
```

#### Alert thresholds

1. **Stall ratio**
   - Numerator: count of `signal=turn_stall_recovered`
   - Denominator: count of `signal=turn_start`
   - Window: trailing 15 minutes
   - Thresholds:
     - Warning: `stall_ratio >= 0.02` with at least 25 turns in the window
     - Critical: `stall_ratio >= 0.05` with at least 25 turns in the window

2. **Repeated provider failures**
   - Signal: `signal=provider_retry_end` with `outcome=failed`
   - Window: trailing 10 minutes
   - Thresholds:
     - Warning: `>= 3` failed retry-end signals per workspace
     - Critical: `>= 5` failed retry-end signals per workspace

3. **Compaction instability (optional but recommended)**
   - Signal: `signal=compaction_end` with `outcome=failed`
   - Window: trailing 15 minutes
   - Thresholds:
     - Warning: `>= 3` failures
     - Critical: `>= 6` failures

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

Direct shortcut (backlog task with acceptance criteria, planning not actively running):
backlog
  -> executing  (skips ready; requires non-empty acceptance criteria)
  -> complete
```

## Related docs

- [Workflow and Queue](./workflow-and-queue.md)
- [State Contract](./state-contract.md)
- [System Architecture](./system-architecture.md)
