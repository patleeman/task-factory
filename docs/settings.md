# Settings

## Scope

How Task Factory stores and resolves global + workspace settings, including first-run migration state.

## Use when

- You need to locate a setting file on disk
- You want to understand global-vs-workspace precedence
- You are troubleshooting first-run migration behavior

## Quick start

1. Open **Settings** in the UI for global defaults.
2. Open **Workspace Settings** for per-workspace overrides.
3. For first-run migration issues, check `~/.taskfactory/pi-migration-state.json`.

## Reference

### Global settings and state files

| Path | Purpose |
|---|---|
| `~/.taskfactory/settings.json` | Global Task Factory settings (theme, task defaults, reusable model profiles, workflow automation defaults) |
| `~/.taskfactory/agent/auth.json` | Provider credentials used by Task Factory runtime |
| `~/.taskfactory/agent/skills/` | Global Pi-style skills migrated from legacy Pi data |
| `~/.taskfactory/skills/` | Global execution hook skills (`pre-planning`, `pre`, `post`) |
| `~/.taskfactory/extensions/` | Global TypeScript extensions |
| `~/.taskfactory/workspaces.json` | Registered workspace list |
| `~/.taskfactory/pi-migration-state.json` | One-time legacy migration decision (`pending`/`migrated`/`skipped`/`not_needed`) |

### Workspace-local settings and artifacts

| Path | Purpose |
|---|---|
| `<workspace>/.taskfactory/factory.json` | Workspace config (task locations, defaults) |
| `<workspace>/.taskfactory/workspace-context.md` | Shared workspace context merged into planning prompts |
| `<workspace>/.taskfactory/tasks/` | Default workspace task storage |
| `<workspace>/.taskfactory/skills/` | Repo-local skills created via `create_skill destination: repo-local` |
| `<workspace>/.taskfactory/extensions/` | Repo-local extensions created via `create_extension destination: repo-local` |

Workspace skill discovery for agent availability now reads local `SKILL.md` files from:
- `<workspace>/skills/`
- `<workspace>/.taskfactory/skills/`

Workspace Configuration only manages skill enable/disable state; extensions are configured globally.

### Precedence summary

1. Workspace-level overrides win when present.
2. Otherwise global defaults from `~/.taskfactory/settings.json` apply.
3. Built-in starter behavior is used when neither override exists.

For model selection defaults in **New Task**, precedence is:
1. Explicit form state (manual selection, restored draft, or prefill)
2. Workspace `taskDefaults.defaultModelProfileId`
3. Global `taskDefaults.defaultModelProfileId`
4. Manual planning/execution model defaults

If a saved default profile ID no longer exists in `modelProfiles`, Task Factory safely drops it (no invalid selection is persisted or returned).

### First-run migration behavior

- On startup, if no migration decision is stored, Task Factory checks `~/.pi` for migratable categories (`auth`, `skills`, `extensions`).
- If data exists, the app shows a one-time prompt before normal routing.
- Choosing **Migrate** or **Skip** persists a decision in `~/.taskfactory/pi-migration-state.json`.
- After a decision is stored, the prompt is suppressed on subsequent startups.

### Pi settings compatibility

Task Factory uses its own storage under `~/.taskfactory` for runtime auth/skills/extensions. If you also manage Pi-specific settings directly, refer to the Pi documentation for `settings.json`, models, and themes expectations.

## Related docs

- [Getting Started](./getting-started.md)
- [System Architecture](./system-architecture.md)
- [Contribution: Extensions and Skills](./contribution-extensions-skills.md)
