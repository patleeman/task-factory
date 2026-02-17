# Workflow and Queue

## Scope

How tasks move through pipeline phases and how queue automation dispatches work.

## Use when

- You need to understand backlog → ready → executing → complete behavior
- You are tuning queue automation settings
- You are diagnosing why work is or is not being auto-dispatched

## Quick start

1. Create a task in `backlog`.
2. Let planning complete (or regenerate plan as needed).
3. Move task to `ready`.
4. Start queue processing (`/queue/start`) or execute manually.
5. Agent runs in `executing`; completion callback moves task to `complete`.

## Reference

### Pipeline phases

| Phase | Meaning |
|---|---|
| `backlog` | Task exists but is not yet executable work |
| `ready` | Task is approved for execution |
| `executing` | Agent is actively implementing |
| `complete` | Execution finished and ready for review/archive |
| `archived` | Removed from active queue views |

### Planning status lifecycle

| Status | Meaning |
|---|---|
| `none` | No active planning run |
| `running` | Planning agent is generating criteria + plan |
| `completed` | Plan saved (`save_plan`) |
| `error` | Planning failed or ended without plan save |

### Queue automation controls

| Setting | Effect |
|---|---|
| `backlogToReady` | Auto-promote backlog task to ready when planning completes |
| `readyToExecuting` | Auto-dispatch ready tasks into executing |
| `readyLimit` | Maximum ready tasks allowed |
| `executingLimit` | Maximum concurrent executing tasks |

### Queue kick sources

- Manual move to `ready`
- Execution completion
- Planning auto-promotion
- Queue poll safety tick

## Examples

```bash
export BASE_URL=http://127.0.0.1:3000
export WORKSPACE_ID=<workspace-id>

# Inspect queue status
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/status"

# Start queue processing
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/start"

# Disable auto-dispatch
curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation" \
  -H "Content-Type: application/json" \
  -d '{"readyToExecuting": false}'
```

## Related docs

- [Runtime Flows](./runtime-flows.md)
- [State Contract](./state-contract.md)
- [API REST Reference](./api-rest-reference.md)
