# Runbook: Factory Release Checklist

- **Owner:** Task Factory maintainers
- **Severity / Priority:** Release gate (must-pass)
- **Last reviewed:** 2026-02-15

## Purpose

Ship releases with explicit quality gates, dependency/security checks, and documented signoff.

## Preconditions

- Release branch is up to date with `main`
- Clean working tree (`git status`)
- Node.js 20+ and npm installed
- Access to publish target (if publishing)

## Procedure

### 1) Required quality gates (blockers)

Run from repo root:

```bash
npm run check:release
```

This gate includes:

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run check:deadcode`

Release does **not** proceed on any failing command.

### 2) Dependency and audit checks (required)

Run both production and full-tree checks:

```bash
npm audit --omit=dev
npm audit
```

Triage policy:

- **Critical/High** vulnerabilities in runtime dependencies: fix or block release.
- **Moderate/Low** or dev-only findings: document disposition and owner before release.
- If deferring any finding, record it in [Security Posture and Accepted-Risk Handling](../security-posture.md).

Optional visibility check:

```bash
npm outdated
```

### 3) Security + risk posture gate

Confirm release still matches accepted operating model:

- Loopback-by-default host binding (`HOST=127.0.0.1` unless explicitly overridden)
- No accidental expansion of privileged tool behavior without review
- No hardcoded credentials/secrets in repo changes
- Accepted risk register reviewed/updated if posture changed

Reference: [Security Posture and Accepted-Risk Handling](../security-posture.md).

### 4) Packaging sanity check

Validate CLI and bundle behavior from built artifacts:

```bash
pifactory --version
pifactory --help
```

If publishing, smoke test install from the packed artifact in a clean directory before promoting.

### 5) Signoff requirements (required)

All releases require explicit signoff in release notes/issue:

| Signoff | Required evidence |
|---|---|
| **Engineering signoff** | `npm run check:release` passed on release commit |
| **Security/risk signoff** | `npm audit` results reviewed; deferred findings linked to accepted-risk entry |
| **Release owner signoff** | Version/change summary + rollback plan documented |

No signoff → no release.

### 6) Publish and post-release verification

After publish/deploy:

1. Verify startup on a clean environment (`pifactory` or `npm start`)
2. Verify `/api/health`
3. Verify one end-to-end task lifecycle (`backlog -> ready -> executing -> complete`)
4. Confirm queue controls still work (`/queue/start`, `/queue/stop`, `/automation`)

## Validation

- All required gates passed
- Audit checks completed and dispositions recorded
- All three signoffs captured
- Post-release smoke checks pass

## Rollback / Recovery

- Stop new releases immediately if runtime regressions are detected
- Revert to last known-good version/tag
- Disable queue automation (`readyToExecuting=false`) if active runs need containment
- Open incident/task with failing checks, logs, and mitigation status

## Escalation

Escalate to maintainers/security reviewer when:

- a blocker vulnerability has no immediate fix
- release requires non-loopback/network-exposed runtime by default
- signoff owners disagree on accepted-risk disposition
