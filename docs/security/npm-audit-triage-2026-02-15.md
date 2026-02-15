# npm audit triage (PIFA-106) — 2026-02-15

## Scope
- Baseline command: `npm audit --omit=dev --json`
- Remediation command: `npm audit fix --omit=dev`
- Validation command: `npm audit --omit=dev --audit-level=high`

## Snapshots
- Baseline JSON: `docs/security/npm-audit-baseline-2026-02-15.json`
- Post-fix JSON: `docs/security/npm-audit-postfix-2026-02-15.json`
- Baseline counts: **6 total** (`moderate: 5`, `low: 1`, `high/critical: 0`)
- Post-fix counts: **5 total** (`moderate: 5`, `low: 0`, `high/critical: 0`)
- Follow-up `npm audit fix --omit=dev --dry-run` still reports the same 5 moderate findings; npm only offers `--force` (Excalidraw downgrade path) for full removal.

## Advisory ownership and triage

| Advisory | Sev | Owner chain | Status | Rationale |
|---|---:|---|---|---|
| `qs` (GHSA-w7fw-mjwx-w883) | low | `@pi-factory/server` → `express@4.22.1` / `body-parser@1.20.4` → `qs` | **Fixed** | Non-breaking patch applied in lockfile: `qs 6.14.1 -> 6.14.2`. |
| `@excalidraw/excalidraw` (meta via deps) | moderate | `@pi-factory/client` (direct dep) | **Accepted risk (deferred)** | `npm audit fix --force` proposes `@excalidraw/excalidraw@0.17.6` (semver-major/downgrade) and conflicts with current React 19 peer range. |
| `@excalidraw/mermaid-to-excalidraw` (meta via deps) | moderate | `@pi-factory/client` → `@excalidraw/excalidraw` → `@excalidraw/mermaid-to-excalidraw@1.1.2` | **Accepted risk (deferred)** | No safe non-breaking upgrade path from current Excalidraw line without force/downgrade risk. |
| `mermaid` (GHSA-7rqq-prvp-x9jh) | moderate | `@pi-factory/client` → `@excalidraw/excalidraw` → `@excalidraw/mermaid-to-excalidraw` → `mermaid@10.9.3` | **Accepted risk (deferred)** | Transitively pinned via Excalidraw chain; fix path is coupled to upstream package upgrades. |
| `dompurify` (GHSA-vhxf-7vqr-mrjg) | moderate | `@pi-factory/client` → `@excalidraw/excalidraw` → `@excalidraw/mermaid-to-excalidraw` → `mermaid` → `dompurify@3.1.6` | **Accepted risk (deferred)** | Vulnerability inherited from transitive mermaid dependency in current Excalidraw chain; no safe direct patch in this repo without breaking-path changes. |
| `nanoid` (GHSA-mwcw-c2x4-8c55) | moderate | `@pi-factory/client` → `@excalidraw/excalidraw` → `nanoid@3.3.3` and `@excalidraw/mermaid-to-excalidraw` → `nanoid@4.0.2` | **Accepted risk (deferred)** | Audit fix for this tree requires forced Excalidraw downgrade/major change (`0.17.6`). |

## Mitigations for unresolved Excalidraw chain
- Exposure is **client-side only** (whiteboard UI); server/runtime path is not directly affected.
- Default deployment binds to `127.0.0.1`, reducing remote exposure unless operators intentionally expose the app.
- Treat whiteboard/diagram content as trusted internal content until upstream-safe upgrades are available.
- Track upstream releases for `@excalidraw/excalidraw` and its mermaid/nanoid chain; prioritize upgrade when a React 19-compatible safe path exists.

## Release sign-off notes
- Release recommendation: **Proceed with accepted moderate client-side risk** after lockfile patching of `qs`.
- Accepted risk scope: Excalidraw/mermaid/dompurify/nanoid transitive advisories only.
- Required explicit approval before release:
  - [ ] Client owner sign-off (name/date)
  - [ ] Release manager sign-off (name/date)
  - [ ] Security reviewer acknowledgement (name/date)

## Quality gates after update
- `npm audit --omit=dev --audit-level=high` ✅ (exit 0)
- `npm audit --omit=dev --audit-level=moderate` ❌ (exit 1, expected: 5 accepted Excalidraw-chain moderates)
- `npm run build` ✅
- `npm run typecheck` ✅
- `npm run test` ✅
