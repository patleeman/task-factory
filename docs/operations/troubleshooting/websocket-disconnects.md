# Troubleshooting: WebSocket Disconnects or Missing Live Updates

- **Owner:** Task Factory maintainers
- **Last reviewed:** 2026-02-15

## Symptoms

- UI loads, but live updates (planning stream, queue/task events) stop arriving
- Frequent reconnect/disconnect behavior in browser
- REST API works while WebSocket-driven UI stays stale

## Detection signals

- Browser devtools WebSocket frames for `/ws`
- Server log entries such as:
  - `Terminating unresponsive client`
  - `WebSocket error for client ...`
  - `Failed to parse WebSocket message`
- `/api/health` is healthy while streaming updates fail

## Common causes

1. Client did not subscribe to a workspace after reconnect
2. Network/proxy timeout closes idle WS connections
3. Host/port mismatch between browser and running server
4. Heartbeat timing is incompatible with intermediary timeouts

## Investigation steps

1. Set API base URL and verify server health:

```bash
export BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
curl -s "$BASE_URL/api/health"
```

2. Confirm browser connects to `ws://<host>:<port>/ws` (or `wss://` behind TLS).
3. Verify client sends `subscribe` with the target `workspaceId` after connect.
4. Check server-side heartbeat config (`WS_HEARTBEAT_INTERVAL_MS`, default `30000`).
5. Review reverse-proxy/load-balancer idle timeout settings if applicable.

## Resolution steps

1. Refresh client and force a clean reconnect/subscription.
2. If behind a proxy, set idle timeout comfortably above heartbeat cadence.
3. Keep local runs on loopback (`HOST=127.0.0.1`) unless remote access is intentional.
4. If needed, tune heartbeat interval:

```bash
WS_HEARTBEAT_INTERVAL_MS=15000 npm start
```

5. After reconnect, re-fetch canonical state through REST (`tasks`, `automation`, `planning/messages`) to re-sync UI.

## Prevention / Follow-up

- Do not disable heartbeat-based liveness checks
- Keep WS path stable (`/ws`) and avoid proxy rewrites that strip ping/pong behavior
- Include WebSocket reconnect checks in release smoke tests

## References

- [WebSocket Event Reference](../../api/websocket-events-reference.md)
- [Factory Runtime Operations](../runbooks/factory-runtime-operations.md)
