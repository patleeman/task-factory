# REST API Reference

This is the server-side HTTP reference used by the current client integration.

## Base conventions

- Base URL: `http://<host>:<port>/api`
- Default port: `3000`
- Content type: JSON (`application/json`) unless noted otherwise.
- Auth: none (local trusted environment model).
- IDs are opaque strings (`workspaceId`, `taskId`, `draftId`, etc.).

Canonical payload types live in `packages/shared/src/types.ts`.

---

## 1) Workspace endpoints

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| GET | `/api/workspaces` | List registered workspaces | `Workspace[]` | — |
| GET | `/api/workspaces/:workspaceId` | Fetch one workspace | `Workspace` | `404 { error: "Workspace not found" }` |
| POST | `/api/workspaces` | Create/register workspace | `Workspace` | `400 { error: "Path is required" }`, `500` |
| DELETE | `/api/workspaces/:workspaceId` | Delete workspace + stop active work | `{ success: true }` | `404`, `500` |
| GET | `/api/workspaces/attention` | Per-workspace awaiting-input counts | `WorkspaceAttentionSummary[]` | `500` |
| POST | `/api/workspaces/:workspaceId/archive/open-in-explorer` | Open `.pi/tasks` in system file explorer | `{ success: true, path: string }` | `404`, `500` |

---

## 2) Task endpoints

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| GET | `/api/workspaces/:workspaceId/tasks?scope=all|active|archived` | List tasks by scope (`active` excludes archived tasks) | `Task[]` | `400` invalid scope, `404` workspace |
| POST | `/api/workspaces/:workspaceId/tasks` | Create task | `Task` | `404`, `500` |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId` | Fetch one task | `Task` | `404` workspace/task, `500` |
| PATCH | `/api/workspaces/:workspaceId/tasks/:taskId` | Update task fields | `Task` | `404`, `500` |
| DELETE | `/api/workspaces/:workspaceId/tasks/:taskId` | Delete task | `{ success: true }` | `404`, `500` |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/move` | Move task between phases | `Task` | `400` invalid transition/WIP breach, `404`, `500` |
| POST | `/api/workspaces/:workspaceId/tasks/reorder` | Reorder tasks in phase | `{ success: true, count: number }` | `400` missing payload, `404`, `500` |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/plan/regenerate` | Start async plan regeneration | `{ success: true }` | `404`, `409` plan exists/running |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/acceptance-criteria/regenerate` | Regenerate criteria | `{ acceptanceCriteria: string[] }` | `404`, `500` |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/execute` | Start task execution session | `{ sessionId: string, status: string }` | `404`, `409` planning running, `500` |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/stop` | Stop active execution | `{ stopped: boolean }` | `200` even if already stopped |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/steer` | Interrupt current execution with instruction | `{ ok: boolean }` | `400` missing content |
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/follow-up` | Queue next-turn instruction | `{ ok: boolean }` | `400` missing content |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/execution` | Fetch active execution state | `{ sessionId, status, startTime, endTime?, output[] }` | `404` no active execution |

### Activity endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workspaces/:workspaceId/activity?limit=100` | Workspace timeline |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/activity?limit=50` | Task timeline |
| POST | `/api/workspaces/:workspaceId/activity` | Append chat entry (`{ taskId, content, role, metadata? }`) |

Notes:

- Session-control routes (`stop`, `steer`, `follow-up`, `execution`) are keyed to active execution sessions by `taskId`; they do not currently validate persisted task existence before responding.

---

## 3) Planning + QA endpoints

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| POST | `/api/workspaces/:workspaceId/planning/message` | Send planning turn (supports `attachmentIds`) | `{ ok: true }` | `400` when content+attachments both empty, `404`, `500` |
| GET | `/api/workspaces/:workspaceId/planning/messages` | Planning history | `PlanningMessage[]` | `404` |
| GET | `/api/workspaces/:workspaceId/planning/status` | Current planning status | `{ status: PlanningAgentStatus }` | `404` |
| POST | `/api/workspaces/:workspaceId/planning/stop` | Stop active planning turn | `{ stopped: boolean }` | `404`, `500` |
| POST | `/api/workspaces/:workspaceId/planning/reset` | Reset planning session | `{ ok: true, sessionId: string }` | `404`, `500` |
| GET | `/api/workspaces/:workspaceId/qa/pending` | Poll pending disambiguation request | `{ request: QARequest \| null }` | `404` |
| POST | `/api/workspaces/:workspaceId/qa/respond` | Submit Q&A answers | `{ ok: true }` | `400` missing fields, `404` request not found |
| POST | `/api/workspaces/:workspaceId/qa/abort` | Abort Q&A request | `{ ok: true }` | `400` missing `requestId`, `404` request not found |

### Planning task-form bridge

| Method | Path | Purpose | Response |
|---|---|---|---|
| POST | `/api/workspaces/:workspaceId/task-form/open` | Register form state/callback bridge | `{ ok: true }` |
| PATCH | `/api/workspaces/:workspaceId/task-form` | Sync incremental form updates | `{ ok: true }` |
| POST | `/api/workspaces/:workspaceId/task-form/close` | Unregister form bridge | `{ ok: true }` |

---

## 4) Automation + queue endpoints

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| GET | `/api/workspaces/:workspaceId/automation` | Read resolved workflow automation settings | `WorkspaceWorkflowSettingsResponse` | `404`, `500` |
| PATCH | `/api/workspaces/:workspaceId/automation` | Update workspace overrides (`readyLimit`, `executingLimit`, `backlogToReady`, `readyToExecuting`) | `WorkspaceWorkflowSettingsResponse` | `400` invalid patch, `404`, `500` |
| GET | `/api/workspaces/:workspaceId/queue/status` | Queue manager status | `QueueStatus` | `404` |
| POST | `/api/workspaces/:workspaceId/queue/start` | Enable queue processing | `QueueStatus` | `404` |
| POST | `/api/workspaces/:workspaceId/queue/stop` | Disable queue processing | `QueueStatus` | `404` |

`WorkspaceWorkflowSettingsResponse` includes:

- `settings` (legacy automation alias)
- `effective` (resolved workflow settings)
- `overrides` (workspace-only overrides)
- `globalDefaults`
- `queueStatus`

---

## 5) Shelf + idea backlog endpoints

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| GET | `/api/workspaces/:workspaceId/shelf` | Read shelf contents | `Shelf` | `404` |
| PATCH | `/api/workspaces/:workspaceId/shelf/drafts/:draftId` | Update draft task | `Shelf` | `404` draft/workspace |
| DELETE | `/api/workspaces/:workspaceId/shelf/items/:itemId` | Remove one shelf item | `Shelf` | `404` workspace |
| DELETE | `/api/workspaces/:workspaceId/shelf` | Clear shelf | `Shelf` | `404` workspace |
| POST | `/api/workspaces/:workspaceId/shelf/drafts/:draftId/push` | Promote one draft to a real task | `Task` | `404` draft/workspace, `500` |
| POST | `/api/workspaces/:workspaceId/shelf/push-all` | Promote all drafts | `{ tasks: Task[], count: number }` | `404` workspace |

### Workspace idea backlog

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| GET | `/api/workspaces/:workspaceId/idea-backlog` | Read backlog scratch list | `IdeaBacklog` | `404` |
| POST | `/api/workspaces/:workspaceId/idea-backlog/items` | Add idea (`{ text }`) | `IdeaBacklog` | `400` empty text, `404` |
| DELETE | `/api/workspaces/:workspaceId/idea-backlog/items/:ideaId` | Remove idea | `IdeaBacklog` | `404` workspace |
| POST | `/api/workspaces/:workspaceId/idea-backlog/reorder` | Reorder (`{ ideaIds: string[] }`) | `IdeaBacklog` | `400` invalid/missing IDs, `404` |

---

## 6) Attachment endpoints

### Task attachments

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| POST | `/api/workspaces/:workspaceId/tasks/:taskId/attachments` | Upload files (`multipart/form-data`, field name `files`, max 10 files, 20MB each) | `Attachment[]` | `400` no files, `404` workspace/task |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/attachments` | List task attachments | `Attachment[]` | `404` workspace/task |
| GET | `/api/workspaces/:workspaceId/tasks/:taskId/attachments/:storedName` | Download file content | Binary file response | `404` not found |
| DELETE | `/api/workspaces/:workspaceId/tasks/:taskId/attachments/:attachmentId` | Delete attachment | `{ success: true }` | `404` workspace/task/attachment |

### Planning attachments

| Method | Path | Purpose | Success response | Common errors |
|---|---|---|---|---|
| POST | `/api/workspaces/:workspaceId/planning/attachments` | Upload files for planning context (`multipart/form-data`) | `Attachment[]` | `400` no files, `404` workspace |
| GET | `/api/workspaces/:workspaceId/planning/attachments/:storedName` | Download planning attachment | Binary file response | `404` workspace/file |

---

## Common error/status behavior

| Status | Typical causes | Body shape |
|---|---|---|
| `400 Bad Request` | Validation failures (invalid scope, missing required fields, malformed automation patch, illegal move) | `{ "error": string }` (move can also include `{ "wipBreach": true }`) |
| `404 Not Found` | Unknown workspace/task/draft/attachment, no active execution, missing QA request | `{ "error": string }` |
| `409 Conflict` | Plan regen conflicts; execution blocked while planning still running | `{ "error": string }` |
| `500 Internal Server Error` | Unexpected runtime/service failures | `{ "error": string }` |

Notes:

- `POST /tasks/:taskId/stop` intentionally returns `200` with `{ stopped: boolean }` for idempotent stopping.
- Many mutating endpoints also emit WebSocket updates (`task:*`, `activity:entry`, `queue:status`, `shelf:updated`, etc.).

---

## Runtime-validated examples

The examples below were smoke-checked against `packages/server/src/index.ts` on **2026-02-15**.

### Example: create workspace

```http
POST /api/workspaces
Content-Type: application/json

{ "path": "/tmp/my-workspace", "name": "Docs Smoke" }
```

```json
{
  "id": "8a3ea9cc-310f-42dd-8fe0-92a1a027a309",
  "path": "/tmp/my-workspace",
  "name": "Docs Smoke",
  "config": {
    "taskLocations": [".pi/tasks"],
    "defaultTaskLocation": ".pi/tasks",
    "wipLimits": {},
    "gitIntegration": {
      "enabled": true,
      "defaultBranch": "main",
      "branchPrefix": "feat/"
    }
  },
  "createdAt": "2026-02-15T22:12:26.294Z",
  "updatedAt": "2026-02-15T22:12:26.294Z"
}
```

### Example: automation patch response

```http
PATCH /api/workspaces/:workspaceId/automation
Content-Type: application/json

{ "readyToExecuting": false, "readyLimit": 3 }
```

```json
{
  "settings": {
    "backlogToReady": false,
    "readyToExecuting": false
  },
  "effective": {
    "readyLimit": 3,
    "executingLimit": 1,
    "backlogToReady": false,
    "readyToExecuting": false
  },
  "overrides": {
    "readyLimit": 3,
    "readyToExecuting": false
  },
  "globalDefaults": {
    "readyLimit": 25,
    "executingLimit": 1,
    "backlogToReady": false,
    "readyToExecuting": true
  },
  "queueStatus": {
    "workspaceId": "8a3ea9cc-310f-42dd-8fe0-92a1a027a309",
    "enabled": false,
    "currentTaskId": null,
    "tasksInReady": 1,
    "tasksInExecuting": 0
  }
}
```

### Example: task-scope validation error

```http
GET /api/workspaces/:workspaceId/tasks?scope=nope
```

```json
{ "error": "scope must be one of: all, active, archived" }
```

### Example: attachment upload response

```http
POST /api/workspaces/:workspaceId/tasks/:taskId/attachments
Content-Type: multipart/form-data
```

```json
[
  {
    "id": "fb66f094",
    "filename": "notes.txt",
    "storedName": "fb66f094.txt",
    "mimeType": "text/plain",
    "size": 17,
    "createdAt": "2026-02-15T22:13:42.168Z"
  }
]
```

### Example: planning validation error

```http
POST /api/workspaces/:workspaceId/planning/message
Content-Type: application/json

{}
```

```json
{ "error": "Content is required" }
```

### Validation sources

- Manual smoke checks: workspace/task/automation/planning/shelf/attachments + WebSocket side-effects.
- Automated tests: `workflow-settings-service.test.ts`, `task-attachment-service.test.ts`, `planning-reset.test.ts`.
