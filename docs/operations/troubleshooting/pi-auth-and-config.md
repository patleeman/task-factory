# Troubleshooting: Pi Auth / Model Config Issues

- **Owner:** Task Factory maintainers
- **Last reviewed:** 2026-02-15

## Symptoms

- Planning/execution fails with provider auth errors
- Model lists are empty or missing expected providers
- OAuth login sessions remain pending/fail repeatedly

## Detection signals

- `GET /api/pi/auth`
- `GET /api/pi/models`
- `GET /api/pi/available-models`
- Server logs showing Pi auth endpoint failures

## Common causes

1. Missing/invalid credentials in `~/.pi/agent/auth.json`
2. Provider configured without valid model availability
3. Expired/revoked OAuth token
4. Corrupt JSON settings in `~/.pi/agent/` or `~/.taskfactory/`
5. Running with unexpected home directory/user context

## Investigation steps

1. Set API base URL and check auth overview:

```bash
export BASE_URL=${BASE_URL:-http://127.0.0.1:3000}
curl -s "$BASE_URL/api/pi/auth"
```

2. Check configured and runtime-available models:

```bash
curl -s "$BASE_URL/api/pi/models"
curl -s "$BASE_URL/api/pi/available-models"
```

3. Verify required local files/dirs are readable:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/settings.json`
- `~/.taskfactory/settings.json` (if present)

4. If OAuth is used, inspect active login session status:

- `GET /api/pi/auth/login/:sessionId`

## Resolution steps

1. Set/replace API key for provider:

```bash
curl -s -X PUT "$BASE_URL/api/pi/auth/providers/<providerId>/api-key" \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"<redacted>"}'
```

2. Clear stale credential if needed:

```bash
curl -s -X DELETE "$BASE_URL/api/pi/auth/providers/<providerId>"
```

3. Re-run OAuth flow (`/api/pi/auth/login/start`, then session input/cancel endpoints as needed).
4. Restart Task Factory after credential/config repair.
5. If home-dir migration confusion exists, confirm active data dir is `~/.taskfactory` (legacy `~/.pi/factory` is migration source).

## Prevention / Follow-up

- Keep provider credentials out of source control
- Rotate compromised keys immediately
- Validate auth/model setup during release smoke tests
- Use a consistent runtime user/home context for local automation

## References

- [REST API Reference](../../api/rest-api-reference.md)
- [Getting Started](../../setup/getting-started.md)
- [Security Posture and Accepted-Risk Handling](../security-posture.md)
