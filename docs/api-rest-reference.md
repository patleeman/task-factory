# API REST Reference

## Scope

HTTP API reference for the current Task Factory server runtime.

## Use when

- You are integrating external tooling with Task Factory
- You need request/response contracts for client work
- You are validating automation, planning, queue, or attachment behavior

## Quick start

```bash
export BASE_URL=${BASE_URL:-http://127.0.0.1:3000}

# Health check
curl -s "$BASE_URL/api/health"
```

Conventions:

- Base path: `/api`
- Content type: JSON unless noted
- Auth: local trusted environment model (no server-side auth)
- Shared canonical types: `packages/shared/src/types.ts`

## Reference

### Workspace endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces` | List workspaces |
| GET | `/api/workspaces/:workspaceId` | Get one workspace |
| POST | `/api/workspaces` | Create/register workspace |
| DELETE | `/api/workspaces/:workspaceId` | Delete workspace |
| GET | `/api/workspaces/attention` | Workspace awaiting-input counts |
| POST | `/api/workspaces/:workspaceId/archive/open-in-explorer` | Open task archive folder in file explorer |
| GET | `/api/workspaces/:workspaceId/pi-config` | Read workspace Pi config (skill enablement overrides) |
| POST | `/api/workspaces/:workspaceId/pi-config` | Save workspace Pi config |
| GET | `/api/workspaces/:workspaceId/skills/discovered` | List all workspace-discovered `SKILL.md` skills (unfiltered) |
| GET | `/api/workspaces/:workspaceId/skills` | List enabled workspace skills after applying saved toggles |

### Task endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/tasks?scope=all|active|archived` | List tasks |
| GET | `/api/workspaces/:workspaceId/tasks/archived/count` | Archived count only |
| POST | `/api/workspaces/:workspaceId/tasks` | Create task |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId` | Get task |
| PATCH | `/api/workspaces/:workspaceId/tasks/:taskId` | Update task fields |
| DELETE | `/api/workspaces/:workspaceId/tasks/:taskId` | Delete task (stops active planning/execution session first, then removes task files) |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/move` | Move phase |
| POST | `/api/workspaces/:workspaceId/tasks/reorder` | Reorder tasks in a phase |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/plan/regenerate` | Regenerate task plan |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/acceptance-criteria/regenerate` | Regenerate criteria |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/execute` | Start execution |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/stop` | Stop execution |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/steer` | Interrupt with instruction |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/follow-up` | Queue next-turn instruction |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/execution` | Active execution state |

### Activity endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/activity?limit=100` | Workspace timeline |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/activity?limit=50` | Task timeline |
| POST | `/api/workspaces/:workspaceId/activity` | Add timeline/chat entry |

Execution reliability telemetry is exposed through these same activity endpoints as `system-event` entries with `metadata.kind = "execution-reliability"`.
Use `metadata.signal` + `metadata.outcome` + `metadata.sessionId`/`turnId` to build reliability dashboards and alerts.

### Planning + QA endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workspaces/:workspaceId/planning/message` | Send planning turn |
| GET | `/api/workspaces/:workspaceId/planning/messages` | Planning history |
| GET | `/api/workspaces/:workspaceId/planning/status` | Planning status |
| POST | `/api/workspaces/:workspaceId/planning/stop` | Stop active planning turn |
| POST | `/api/workspaces/:workspaceId/planning/reset` | Reset planning session |
| GET | `/api/workspaces/:workspaceId/qa/pending` | Pending Q&A request |
| POST | `/api/workspaces/:workspaceId/qa/respond` | Submit Q&A answer set |
| POST | `/api/workspaces/:workspaceId/qa/abort` | Abort Q&A request |

### Task form bridge endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workspaces/:workspaceId/task-form/open` | Register task-form bridge |
| PATCH | `/api/workspaces/:workspaceId/task-form` | Sync form updates |
| POST | `/api/workspaces/:workspaceId/task-form/close` | Unregister bridge |

### Automation + queue endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/automation` | Read effective automation settings |
| PATCH | `/api/workspaces/:workspaceId/automation` | Update workflow overrides |
| GET | `/api/workspaces/:workspaceId/queue/status` | Queue status (includes optional `executionBreakers`) |
| POST | `/api/workspaces/:workspaceId/queue/start` | Enable queue (also clears open execution breakers as manual resume) |
| POST | `/api/workspaces/:workspaceId/queue/stop` | Disable queue |

### Pi migration + settings endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pi-migration/status` | Read one-time legacy `~/.pi` migration state (`pending`, `migrated`, `skipped`, `not_needed`) |
| POST | `/api/pi-migration/migrate` | Persist migration decision and copy selected categories (`auth`, `skills`, `extensions`) into `~/.taskfactory` |
| POST | `/api/pi-migration/skip` | Persist explicit skip decision so startup prompt is suppressed |
| GET | `/api/settings` | Read Task Factory global settings (`voiceInputHotkey`, `planningGuardrails`, `workflowDefaults`, `modelProfiles`, profile fallback arrays) |
| POST | `/api/settings` | Save Task Factory global settings (rejects malformed payloads with `400`; validates model profile fallback arrays) |
| GET | `/api/pi/settings` | Read Pi agent settings used by Task Factory |
| GET | `/api/pi/auth` | Read provider auth overview from `~/.taskfactory/agent/auth.json` |

### Shelf + idea backlog endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/shelf` | Read shelf data |
| PATCH | `/api/workspaces/:workspaceId/shelf/drafts/:draftId` | Update shelf draft |
| DELETE | `/api/workspaces/:workspaceId/shelf/items/:itemId` | Remove shelf item |
| DELETE | `/api/workspaces/:workspaceId/shelf` | Clear shelf |
| POST | `/api/workspaces/:workspaceId/shelf/drafts/:draftId/push` | Promote one draft to task |
| POST | `/api/workspaces/:workspaceId/shelf/push-all` | Promote all drafts |
| GET | `/api/workspaces/:workspaceId/idea-backlog` | Read idea backlog |
| POST | `/api/workspaces/:workspaceId/idea-backlog/items` | Add idea |
| PATCH | `/api/workspaces/:workspaceId/idea-backlog/items/:ideaId` | Update idea text |
| DELETE | `/api/workspaces/:workspaceId/idea-backlog/items/:ideaId` | Delete idea |
| POST | `/api/workspaces/:workspaceId/idea-backlog/reorder` | Reorder ideas |

### Attachment endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/attachments` | Upload task attachments (`multipart/form-data`) |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/attachments` | List task attachments |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/attachments/:storedName` | Download task attachment |
| DELETE | `/api/workspaces/:workspaceId/tasks/:taskId/attachments/:attachmentId` | Delete task attachment |
| POST | `/api/workspaces/:workspaceId/planning/attachments` | Upload planning attachments |
| GET | `/api/workspaces/:workspaceId/planning/attachments/:storedName` | Download planning attachment |

Notes:
- `GET /api/workspaces/:workspaceId/tasks/:taskId/attachments/:storedName` uses the attachment's stored MIME metadata when available, so uncommon extensions can still be served with the correct `Content-Type`.
- UI previews are intentionally conservative: inline thumbnails are only rendered for browser-safe image MIME types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`); other image-like files are shown as downloadable file attachments.

### Common error behavior

| Status | Typical causes |
|---|---|
| `400` | Validation failures or malformed payloads |
| `404` | Workspace/task/draft/attachment not found |
| `409` | Planning/execute conflicts |
| `500` | Unexpected runtime/service failure |

## Examples

### Create workspace

```http
POST /api/workspaces
Content-Type: application/json

{ "path": "/tmp/my-workspace", "name": "Docs Smoke" }
```

### Toggle queue auto-dispatch

```bash
curl -s -X PATCH "$BASE_URL/api/workspaces/$WORKSPACE_ID/automation" \
  -H "Content-Type: application/json" \
  -d '{"readyToExecuting": false}'
```

## Related docs

- [API WebSocket Events](./api-websocket-events.md)
- [Workflow and Queue](./workflow-and-queue.md)
- [State Contract](./state-contract.md)
