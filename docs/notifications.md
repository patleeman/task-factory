# Notifications (Daemon → Gateway)

## Scope

First-class notification pipeline for daemon/scheduler/task-runtime events routed to Telegram/Discord through a single gateway layer.

## Design

1. Producers emit generic `NotificationEvent` payloads (no provider-specific API calls).
2. Events are accepted at `POST /api/notifications/intake` and written to a durable queue (`~/.taskfactory/notifications-queue.json`).
3. Worker resolves global routes + workspace overrides.
4. Router enforces global allowlist (`notifications.allowlistedTargets`).
5. Delivery attempts are logged with retry/backoff and terminal failure capture.

## Configuration knobs

Global (`~/.taskfactory/settings.json`):

- `notifications.enabled`
- `notifications.sharedSecret`
- `notifications.allowlistedTargets`
- `notifications.routes[]`
- `notifications.maxRetries`
- `notifications.retryBackoffMs`

Workspace override (`<workspace>/.taskfactory/factory.json`):

- `notifications.enabled`
- `notifications.routes[]`

## Example: scheduled task completion alert

1. Add allowlist target: `discord:ops-scheduled`.
2. Add route:
   - `types: ["scheduled-task"]`
   - `severities: ["info"]`
   - `target: { provider: "discord", destination: "ops-scheduled" }`
3. Scheduler emits:

```json
{
  "source": "personal-agentd",
  "workspaceId": "workspace-1",
  "type": "scheduled-task",
  "severity": "info",
  "taskId": "cron-daily-summary",
  "message": "Scheduled task cron-daily-summary finished"
}
```

## Example: notify on TASK-* failures in one workspace

1. Add allowlist target: `telegram:alerts-main`.
2. Add workspace override route:
   - `workspaceId: "workspace-1"`
   - `taskIdPattern: "^TASK-"`
   - `types: ["task-lifecycle"]`
   - `severities: ["error"]`
   - `target: { provider: "telegram", destination: "alerts-main" }`
3. Queue manager emits failure events automatically when execution fails.
