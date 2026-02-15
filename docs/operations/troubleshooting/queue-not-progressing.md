# Troubleshooting: Queue Not Progressing

- **Owner:** Task Factory maintainers
- **Last reviewed:** 2026-02-15

## Symptoms

- Tasks remain in `ready` and never move to `executing`
- Queue appears enabled, but no task starts
- Executing slot appears permanently occupied

## Detection signals

- `GET /api/workspaces/:workspaceId/queue/status`
- `GET /api/workspaces/:workspaceId/automation`
- `GET /api/workspaces/:workspaceId/tasks?scope=active`
- Server logs containing `[QueueManager]` entries

## Common causes

1. `readyToExecuting` automation is disabled
2. Executing WIP limit reached (`executingLimit`) with no free slot
3. Candidate task is still planning (`planningStatus=running` with no plan) and is skipped
4. Task is stuck in `executing` after failure and needs manual intervention
5. Queue manager not running after restart for a workspace expected to auto-run

## Investigation steps

```bash
export BASE_URL=http://127.0.0.1:3000
export WORKSPACE_ID=<workspace-id>
```

1. Check queue status:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/status"
```

2. Check effective automation settings and limits:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation"
```

3. Inspect active tasks and phases:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/tasks?scope=active"
```

4. Inspect active execution sessions:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/executions"
```

## Resolution steps

1. Enable queue auto-dispatch when disabled:

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/start"
```

2. If automation flags are incorrect, patch explicitly:

```bash
curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation" \
  -H "Content-Type: application/json" \
  -d '{"readyToExecuting": true}'
```

3. If an `executing` task is hung, stop it and move/requeue as needed.
4. If tasks in `ready` still have planning in progress, wait for planning completion or resolve planning errors first.
5. Restart server if queue manager state appears stale after config/status correction.

## Prevention / Follow-up

- Keep `executingLimit` realistic (default `1` unless parallelism is intentional)
- Avoid moving tasks to `ready` before planning is complete
- Review repeated queue stalls and capture recurring patterns in release retrospectives

## References

- [Factory Runtime Operations](../runbooks/factory-runtime-operations.md)
- [Runtime Flows](../../architecture/runtime-flows.md)
- [REST API Reference](../../api/rest-api-reference.md)
