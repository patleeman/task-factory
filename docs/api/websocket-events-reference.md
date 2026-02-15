# WebSocket Event Reference

This document describes the live event stream used by the client.

## Endpoint and session model

- URL: `ws://<host>:<port>/ws` (or `wss://` behind TLS)
- Transport: JSON message frames
- Scope model: client must subscribe to a workspace to receive workspace broadcasts
- Heartbeat: server sends ping every `WS_HEARTBEAT_INTERVAL_MS` (default `30000` ms); unresponsive sockets are terminated

On connect, the server immediately sends a bootstrap frame:

```json
{ "type": "agent:status", "agent": {} }
```

---

## Client → server events

Defined in `ClientEvent` (`packages/shared/src/types.ts`).

| Event type | Payload | Runtime behavior |
|---|---|---|
| `subscribe` | `{ type: "subscribe", workspaceId }` | **Handled**. Adds socket to workspace subscription set. |
| `unsubscribe` | `{ type: "unsubscribe", workspaceId }` | **Handled**. Removes socket from workspace subscription set. |
| `activity:send` | `{ type: "activity:send", taskId, content, role }` | **Handled**. Persists chat entry and broadcasts `activity:entry` to workspace subscribers. |
| `task:move` | `{ type: "task:move", taskId, toPhase }` | **Currently ignored** by `handleClientEvent` (no-op). |
| `task:claim` | `{ type: "task:claim", taskId, agentId }` | **Currently ignored** (no-op). |
| `agent:heartbeat` | `{ type: "agent:heartbeat", agentId }` | **Currently ignored** (no-op). |

Additional behavior:

- Invalid JSON frames are logged server-side and dropped.
- Unknown event types are ignored (no error frame sent).

---

## Server → client events

Defined in `ServerEvent` + `PlanningEvent` (`packages/shared/src/types.ts`).

### A) Task/workspace/activity events

| Event type | Payload summary | Typical source |
|---|---|---|
| `task:created` | `{ task }` | Task create APIs, shelf push flows |
| `task:updated` | `{ task, changes }` | Task patches, summary updates, attachment updates |
| `task:moved` | `{ task, from, to }` | Manual moves, queue automation, execution transitions |
| `task:reordered` | `{ phase, taskIds }` | Reorder endpoint |
| `task:plan_generated` | `{ taskId, plan }` | Async planning completion |
| `activity:entry` | `{ entry }` | User/agent chat messages, system events |
| `queue:status` | `{ status: QueueStatus }` | Queue manager enable/disable and cycle ticks |
| `workspace:automation_updated` | `{ workspaceId, settings, overrides, globalDefaults }` | Automation/global workflow updates |
| `idea_backlog:updated` | `{ workspaceId, backlog }` | Idea backlog add/remove/reorder |
| `shelf:updated` | `{ workspaceId, shelf }` | Shelf/task-draft/artifact mutations |
| `agent:status` | `{ agent }` | Connection bootstrap (currently empty object payload) |

### B) Execution streaming events

| Event type | Payload summary |
|---|---|
| `agent:execution_status` | `{ taskId, status }` where status ∈ `idle/awaiting_input/streaming/tool_use/thinking/completed/error/pre-hooks/post-hooks` |
| `agent:streaming_start` | `{ taskId }` |
| `agent:streaming_text` | `{ taskId, delta }` |
| `agent:streaming_end` | `{ taskId, fullText }` |
| `agent:thinking_delta` | `{ taskId, delta }` |
| `agent:thinking_end` | `{ taskId }` |
| `agent:tool_start` | `{ taskId, toolName, toolCallId }` |
| `agent:tool_update` | `{ taskId, toolCallId, delta }` |
| `agent:tool_end` | `{ taskId, toolCallId, toolName, isError, result? }` |
| `agent:turn_end` | `{ taskId }` |

### C) Planning/Foreman events

| Event type | Payload summary |
|---|---|
| `planning:status` | `{ workspaceId, status }` where status ∈ `idle/streaming/tool_use/thinking/error/awaiting_qa` |
| `planning:message` | `{ workspaceId, message }` (`PlanningMessage`) |
| `planning:streaming_text` | `{ workspaceId, delta }` |
| `planning:streaming_end` | `{ workspaceId, fullText, messageId }` |
| `planning:thinking_delta` | `{ workspaceId, delta }` |
| `planning:thinking_end` | `{ workspaceId }` |
| `planning:tool_start` | `{ workspaceId, toolName, toolCallId }` |
| `planning:tool_update` | `{ workspaceId, toolCallId, delta }` |
| `planning:tool_end` | `{ workspaceId, toolCallId, toolName, isError, result? }` |
| `planning:turn_end` | `{ workspaceId }` |
| `planning:session_reset` | `{ workspaceId, sessionId }` |
| `planning:task_form_updated` | `{ workspaceId, formState }` |
| `qa:request` | `{ workspaceId, request }` (`QARequest`) |

### D) Declared in shared types but not currently emitted in runtime

| Event type | Status |
|---|---|
| `task:claimed` | Declared contract; not broadcast by current server code |
| `metrics:updated` | Declared contract; not broadcast by current server code |
| `wip:breach` | Declared contract; not broadcast by current server code |

---

## Runtime-validated frame examples

These examples were manually smoke-checked on **2026-02-15**.

### Subscribe to workspace

```json
{ "type": "subscribe", "workspaceId": "8a3ea9cc-310f-42dd-8fe0-92a1a027a309" }
```

### Task-created broadcast

```json
{
  "type": "task:created",
  "task": {
    "id": "TMPZ-2",
    "frontmatter": { "phase": "backlog" }
  }
}
```

### Activity send → activity entry

Client frame:

```json
{ "type": "activity:send", "taskId": "TMPZ-1", "role": "user", "content": "ws hello" }
```

Broadcast frame:

```json
{
  "type": "activity:entry",
  "entry": {
    "type": "chat-message",
    "taskId": "TMPZ-1",
    "role": "user",
    "content": "ws hello"
  }
}
```

### Automation update side-effects

A single automation patch can emit a burst like:

- `queue:status`
- `workspace:automation_updated`
- `task:moved`
- `agent:execution_status`
- `agent:streaming_start`

(Exact sequence depends on queue state and ready tasks.)

---

## Operational behavior notes

- Events are pushed only to sockets subscribed to the workspace.
- WebSocket ordering is preserved per connection for emitted frames, but async producers can interleave naturally.
- There is no built-in ACK/replay protocol; on reconnect, clients should re-fetch canonical state via REST.
