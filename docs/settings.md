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

Model profiles support ordered fallback arrays for both planning and execution (`planningFallbackModels[]`, `executionFallbackModels[]`). Fallback entries use the same validation rules as primary model configs (`provider`, `modelId`, optional `thinkingLevel`) and are ignored when empty arrays are saved.

### First-run migration behavior

- On startup, if no migration decision is stored, Task Factory checks `~/.pi` for migratable categories (`auth`, `skills`, `extensions`).
- If data exists, the app shows a one-time prompt before normal routing.
- Choosing **Migrate** or **Skip** persists a decision in `~/.taskfactory/pi-migration-state.json`.
- After a decision is stored, the prompt is suppressed on subsequent startups.

### Available Settings Fields

Use the CLI to view all available settings:

```bash
task-factory settings schema
```

**Key settings categories:**

| Setting Path | Type | Description |
|--------------|------|-------------|
| `theme` | string | UI theme (`"dark"` or `"light"`) |
| `defaultWorkspace` | string | Default workspace ID to open on startup |
| `taskDefaults.modelConfig.provider` | string | Default model provider for execution |
| `taskDefaults.modelConfig.modelId` | string | Default model ID for execution |
| `taskDefaults.modelConfig.thinkingLevel` | string | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `taskDefaults.planningModelConfig.*` | object | Same as modelConfig but for planning phase |
| `taskDefaults.executionModelConfig.*` | object | Same as modelConfig but for execution phase |
| `taskDefaults.preExecutionSkills` | string[] | Skills to run before task execution |
| `taskDefaults.postExecutionSkills` | string[] | Skills to run after task completion |
| `workflowDefaults.readyLimit` | number | Max tasks in ready queue (1-100) |
| `workflowDefaults.executingLimit` | number | Max concurrent executing tasks (1-20) |
| `workflowDefaults.backlogToReady` | boolean | Auto-promote backlog → ready |
| `workflowDefaults.readyToExecuting` | boolean | Auto-promote ready → executing |
| `planningGuardrails.timeoutMs` | number | Planning session timeout |
| `planningGuardrails.maxToolCalls` | number | Max tool calls per planning session |

**View current settings:**
```bash
task-factory settings get
```

**Set a setting:**
```bash
# Simple value
task-factory settings set theme "dark"

# Nested value (dot notation)
task-factory settings set taskDefaults.modelConfig.provider "openai-codex"
task-factory settings set workflowDefaults.readyLimit 10
```

### Pi settings compatibility

Task Factory uses its own storage under `~/.taskfactory` for runtime auth/skills/extensions. If you also manage Pi-specific settings directly, refer to the Pi documentation for `settings.json`, models, and themes expectations.

## Related docs

- [Getting Started](./getting-started.md)
- [System Architecture](./system-architecture.md)
- [Contribution: Extensions and Skills](./contribution-extensions-skills.md)
