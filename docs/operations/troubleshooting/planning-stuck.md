# Troubleshooting: Planning Stuck or Not Progressing

- **Owner:** Task Factory maintainers
- **Last reviewed:** 2026-02-15

## Symptoms

- Foreman planning shows `streaming`/`tool_use` for a long time with no new output
- Planning appears idle in UI, but user input does not trigger a response
- Planning asks a question and never resumes

## Detection signals

- `GET /api/workspaces/:workspaceId/planning/status`
- `GET /api/workspaces/:workspaceId/qa/pending`
- Server logs around planning routes and planning agent retry/reset paths

## Common causes

1. Planning is waiting on unresolved `ask_questions` input (`awaiting_qa`)
2. Planning turn is still active and needs explicit stop
3. WebSocket missed events; UI state is stale while server state moved on
4. Agent session hit an error and needs reset/recreation

## Investigation steps

Set environment:

```bash
export BASE_URL=http://127.0.0.1:3000
export WORKSPACE_ID=<workspace-id>
```

1. Check planning status:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/planning/status"
```

2. Check for pending Q&A:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/qa/pending"
```

3. Inspect recent planning messages:

```bash
curl -s "$BASE_URL/api/workspaces/$WORKSPACE_ID/planning/messages"
```

4. Confirm WebSocket connectivity separately (see [WebSocket troubleshooting](./websocket-disconnects.md)).

## Resolution steps

1. **If status is `awaiting_qa`**: submit answers or abort pending Q&A.
2. **If status is `streaming`/`tool_use` too long**: stop current turn.

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/planning/stop"
```

3. Retry with a fresh planning turn.
4. If still stuck, reset planning session (archives prior session and clears active messages).

```bash
curl -s -X POST "$BASE_URL/api/workspaces/$WORKSPACE_ID/planning/reset"
```

5. Send a new planning message to verify recovery.

## Prevention / Follow-up

- Prefer resolving Q&A prompts promptly to avoid long-lived `awaiting_qa` state
- Monitor recurring planning resets and capture root-cause examples in task history
- Keep planning-related docs and state-contract expectations aligned when lifecycle behavior changes

## References

- [Runtime Flows](../../architecture/runtime-flows.md)
- [State Contract (canonical)](../../architecture/state-contract.md)
- [REST API Reference](../../api/rest-api-reference.md)
