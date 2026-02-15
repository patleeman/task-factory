# Runbook: Factory Runtime Operations

- **Owner:** Task Factory maintainers
- **Severity / Priority:** P1–P3 operational support
- **Last reviewed:** 2026-02-15

## Purpose

Operate Task Factory with predictable runtime behavior, safe host exposure, reliable logs, and controlled queue/factory execution.

## Preconditions

- Node.js 20+ installed
- Built artifacts available for production run (`npm run build`)
- Workspace ID available for API checks
- Operator understands this is a trusted-local model (see [security posture](../security-posture.md))

## Runtime configuration reference

| Variable | Default | Why it matters |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket listener port |
| `HOST` | `127.0.0.1` | Bind host; keeps APIs local-only by default |
| `DEBUG` | _(unset)_ | Enables debug-level log entries when set |
| `PI_FACTORY_SERVER_LOG_PATH` | `~/.taskfactory/logs/server.jsonl` | File sink path for structured JSON logs |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket ping cadence used to detect dead clients |

> If `HOST` is non-loopback (for example `0.0.0.0`), Task Factory logs a startup warning because APIs are unauthenticated and may be reachable from other machines.

## Procedure

### 1) Start the server

Production-style run:

```bash
npm run build
npm start
```

CLI run:

```bash
pifactory --no-open
# or
PORT=3100 HOST=127.0.0.1 pifactory --no-open
```

### 2) Verify bind host and service health

Set the API base URL (adjust if using non-default host/port), then check health:

```bash
export BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
curl -s "$BASE_URL/api/health"
```

Expected: JSON with `"status": "ok"`.

If you intentionally set a non-loopback host, confirm the startup warning is visible in logs:

- `Non-loopback bind host detected`

### 3) Verify logging is healthy

Tail structured logs:

```bash
tail -f ~/.taskfactory/logs/server.jsonl
```

If `PI_FACTORY_SERVER_LOG_PATH` points to an invalid file target, logger falls back to console-only logging and emits:

- `File log sink disabled; continuing with console-only logging.`

### 4) Inspect queue/factory status

Set remaining environment for queue API commands:

```bash
export WORKSPACE_ID=<workspace-id>
```

Check automation + queue state:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation"
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/status"
```

### 5) Start/stop queue execution controls

Start queue manager:

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/start"
```

Stop queue manager:

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/queue/stop"
```

Update automation flags/limits in one call:

```bash
curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation" \
  -H "Content-Type: application/json" \
  -d '{"backlogToReady": false, "readyToExecuting": true, "readyLimit": 25, "executingLimit": 1}'
```

Notes:

- `readyToExecuting` controls queue auto-dispatch (`ready -> executing`).
- `backlogToReady` controls auto-promotion after planning completion (`backlog -> ready`).
- Foreman can invoke the same controls via the `factory_control` tool (`status|start|stop`).

### 6) Pause all automation safely (incident mode)

1. Disable both automation flags:

```bash
curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation" \
  -H "Content-Type: application/json" \
  -d '{"backlogToReady": false, "readyToExecuting": false}'
```

2. Stop active executing sessions task-by-task if needed:

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/tasks/<task-id>/stop"
```

## Validation

- `GET /api/health` returns `status=ok`
- `GET /queue/status` reflects expected `enabled` state
- `tasksInReady` / `tasksInExecuting` counts match UI pipeline
- WebSocket clients continue receiving `queue:status` and `task:moved` events during queue changes

## Rollback / Recovery

- Restore safe network binding: `HOST=127.0.0.1`
- Revert automation patch to last known-good settings
- Restart server process if queue/planning state appears stale
- If planning or queue remains inconsistent, follow troubleshooting guides:
  - [Planning Stuck](../troubleshooting/planning-stuck.md)
  - [Queue Not Progressing](../troubleshooting/queue-not-progressing.md)
  - [WebSocket Disconnects](../troubleshooting/websocket-disconnects.md)

## Escalation

Escalate to maintainers when:

- queue does not recover after stop/start and task/session cleanup
- repeated non-loopback exposure is required without compensating controls
- auth or provider failures block all agent execution across workspaces
