# Security Posture and Accepted-Risk Handling

- **Owner:** Task Factory maintainers
- **Last reviewed:** 2026-02-15

## Scope

This document defines the current Task Factory security posture and the process for handling **accepted risk** in releases and runtime operations.

## Current security posture

Task Factory is intentionally local-first and currently operates with these constraints:

1. **No sandbox boundary** for agent execution
   - Agent tools and shell commands run with the local user's permissions.
2. **No server-side authentication** on local-control APIs
   - APIs are designed for trusted local environments.
3. **Host binding defaults to loopback**
   - Default `HOST=127.0.0.1` limits exposure to the local machine.
4. **Structured server logging is enabled by default**
   - Logs go to stdout/stderr and `~/.taskfactory/logs/server.jsonl` unless overridden.

## Compensating controls in place

- Loopback-by-default network binding with explicit non-loopback warning at startup
- Workspace-scoped queue controls (start/stop/status) for containment during incidents
- Clear operator guidance in runtime and troubleshooting runbooks
- Persisted activity/state transitions to aid post-incident diagnosis

## Accepted-risk register

These risks are currently accepted and must be re-reviewed every release:

| Risk ID | Risk statement | Why accepted now | Compensating controls | Review cadence |
|---|---|---|---|---|
| `R-001` | Agent execution is unsandboxed and can access local files/processes with user privileges. | Core product behavior depends on Pi tool execution model. | Trusted-repo policy, explicit operator guidance, local environment usage. | Every release |
| `R-002` | Control APIs are unauthenticated; non-loopback exposure can allow remote control on local networks. | Product is local-first and defaults to loopback. | `HOST=127.0.0.1` default, startup warning for non-loopback binds, release gate checks. | Every release + any deployment topology change |
| `R-003` | Extensions/skills may introduce privileged operations beyond intended scope. | Extensibility is a primary capability. | Code review for extension/skill changes, least-privilege tool design, release signoff. | Every extension/skill change |

## Accepted-risk handling workflow

1. **Identify and classify**
   - Decide whether risk is blocker vs accepted-with-controls.
2. **Document**
   - Record risk ID, owner, impact, controls, and review date in this doc (or linked release note).
3. **Sign off**
   - Release owner + security/risk reviewer must explicitly approve deferrals.
4. **Track to closure**
   - Add follow-up work when controls are temporary or insufficient.
5. **Re-validate at release time**
   - Execute [Factory Release Checklist](./runbooks/factory-release-checklist.md).

## Non-accepted operating modes

The following are out of policy without additional controls:

- Internet-exposed Task Factory server without network ACL/auth hardening
- Running untrusted repositories with privileged local credentials
- Committing plaintext secrets/tokens to repository files

## Related docs

- [Factory Runtime Operations](./runbooks/factory-runtime-operations.md)
- [Factory Release Checklist](./runbooks/factory-release-checklist.md)
- [Extension + Execution Skill Customization](../contribution/extensions-and-execution-skills.md)
