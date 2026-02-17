# API WebSocket Events

## Scope

Live WebSocket event contract used by Task Factory clients.

## Use when

- You are implementing or debugging real-time UI updates
- You need exact client->server and server->client event payloads
- You are troubleshooting reconnect/subscription behavior

## Quick start

1. Connect to `ws://<host>:<port>/ws`.
2. Send a `subscribe` event with `workspaceId`.
3. Consume `task:*`, `planning:*`, `agent:*`, and `queue:status` events.
4. On reconnect, re-subscribe and refresh canonical state via REST.

On connect, server sends:

```json
{ "type": "agent:status", "agent": {} }
```

## Reference

### Client -> server events

| Event type | Payload | Behavior |
|---|---|---|
| `subscribe` | `{ type, workspaceId }` | Subscribes socket to workspace broadcast set |
| `unsubscribe` | `{ type, workspaceId }` | Removes workspace subscription |
| `activity:send` | `{ type, taskId, content, role }` | Persists activity and broadcasts `activity:entry` |
| `task:move` | `{ type, taskId, toPhase }` | Declared; currently ignored by runtime handler |
| `task:claim` | `{ type, taskId, agentId }` | Declared; currently ignored |
| `agent:heartbeat` | `{ type, agentId }` | Declared; currently ignored |

### Server -> client event groups

#### Task/workspace/activity

| Event type | Payload summary |
|---|---|
| `task:created` | `{ task }` |
| `task:updated` | `{ task, changes }` |
| `task:moved` | `{ task, from, to }` |
| `task:reordered` | `{ phase, taskIds }` |
| `task:plan_generated` | `{ taskId, plan }` |
| `activity:entry` | `{ entry }` |
| `queue:status` | `{ status }` |
| `workspace:automation_updated` | `{ workspaceId, settings, overrides, globalDefaults }` |
| `idea_backlog:updated` | `{ workspaceId, backlog }` |
| `shelf:updated` | `{ workspaceId, shelf }` |
| `agent:status` | `{ agent }` |

#### Execution streaming

| Event type | Payload summary |
|---|---|
| `agent:execution_status` | `{ taskId, status }` |
| `agent:streaming_start` | `{ taskId }` |
| `agent:streaming_text` | `{ taskId, delta }` |
| `agent:streaming_end` | `{ taskId, fullText }` |
| `agent:thinking_delta` | `{ taskId, delta }` |
| `agent:thinking_end` | `{ taskId }` |
| `agent:tool_start` | `{ taskId, toolName, toolCallId }` |
| `agent:tool_update` | `{ taskId, toolCallId, delta }` |
| `agent:tool_end` | `{ taskId, toolCallId, toolName, isError, result? }` |
| `agent:turn_end` | `{ taskId }` |

#### Planning / Foreman streaming

| Event type | Payload summary |
|---|---|
| `planning:status` | `{ workspaceId, status }` |
| `planning:message` | `{ workspaceId, message }` |
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
| `qa:request` | `{ workspaceId, request }` |

### Runtime notes

- Invalid JSON frames are ignored after server-side logging.
- Events are emitted only to sockets subscribed to the matching workspace.
- There is no replay protocol; clients should re-fetch REST state after reconnect.

## Examples

### Subscribe

```json
{ "type": "subscribe", "workspaceId": "workspace-123" }
```

### Activity send

```json
{ "type": "activity:send", "taskId": "TASK-1", "role": "user", "content": "hello" }
```

## Related docs

- [API REST Reference](./api-rest-reference.md)
- [Runtime Flows](./runtime-flows.md)
- [Workflow and Queue](./workflow-and-queue.md)
