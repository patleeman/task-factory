# Operations Security Posture

## Scope

Current Task Factory security model and accepted-risk handling workflow.

## Use when

- You are reviewing release risk posture
- You are deciding whether runtime exposure is acceptable
- You need the policy baseline for extension/skill changes

## Quick start

1. Confirm runtime uses trusted repositories and local environments.
2. Keep `HOST=127.0.0.1` unless remote exposure is explicitly required.
3. Re-review accepted risks on every release.

## Reference

### Baseline posture

| Area | Current posture |
|---|---|
| Sandbox boundary | None; agent tools/shell run with local user permissions |
| API auth | None; API is local-trust model |
| Host binding default | `127.0.0.1` |
| Logging | Structured server logs enabled by default |

### Accepted-risk register

| Risk ID | Risk statement | Why accepted now | Compensating controls |
|---|---|---|---|
| `R-001` | Agent execution is unsandboxed and can access local files/processes. | Core product behavior depends on Pi tool execution model. | Trusted-repo policy, explicit operator guidance, local environment usage. |
| `R-002` | APIs are unauthenticated; non-loopback binding can expose controls on local networks. | Product is local-first and defaults to loopback. | Loopback default, startup warning for non-loopback binds, release gate checks. |
| `R-003` | Extensions/skills can introduce privileged operations. | Extensibility is a primary capability. | Code review, least-privilege tool design, explicit signoff for risky changes. |

### Accepted-risk handling workflow

1. Identify and classify blocker vs accepted-with-controls.
2. Document risk ID, owner, impact, controls, and review date.
3. Capture release owner + security/risk reviewer signoff.
4. Track follow-up work for temporary controls.
5. Re-validate on each release.

### Out-of-policy modes

- Internet-exposed Task Factory without additional network/auth controls
- Running untrusted repositories with privileged credentials
- Committing plaintext secrets/tokens to source control

## Examples

```bash
# Safe local bind (recommended)
HOST=127.0.0.1 task-factory

# Explicit network exposure (requires additional controls)
HOST=0.0.0.0 task-factory
```

## Related docs

- [Workflow and Queue](./workflow-and-queue.md)
- [CLI Reference](./cli-reference.md)
- [Contribution Extensions + Skills](./contribution-extensions-skills.md)
