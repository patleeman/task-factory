# Contribution: Extensions and Skills

## Scope

How to safely customize Task Factory with repo extensions (`extensions/`) and execution skills (`skills/` and `~/.taskfactory/skills/`).

## Use when

- You need to add a new agent tool
- You want to add/update pre-planning, pre-execution, or post-execution skills
- You are reviewing extension/skill safety and compatibility

## Quick start

1. Decide whether your change belongs in an extension (tool) or skill (prompt hook).
2. Keep business policy in server code; keep extension code as adapter glue.
3. Reload extensions/skills and run server tests before merge.

## Reference

### Customization surfaces

| Surface | Location | Runtime role |
|---|---|---|
| Repo extension | `extensions/<id>.ts` or `extensions/<id>/index.ts` | Registers Pi tools for sessions |
| Execution skill | `skills/<id>/SKILL.md` and `~/.taskfactory/skills/<id>/SKILL.md` | Adds pre-planning / pre / post hook prompt behavior |

### Extension discovery and audience scoping

| Topic | Behavior |
|---|---|
| Discovery | Loads `extensions/<name>.ts` and `extensions/<name>/index.ts` |
| Foreman sessions | Use repo extension paths filtered for Foreman audience |
| Task sessions | Exclude Foreman-only extension IDs |
| Scope owner | `packages/server/src/agent-execution-service.ts` |

### Skill discovery and precedence

| Topic | Behavior |
|---|---|
| Sources | Repo starter skills + user skills in `~/.taskfactory/skills` |
| Merge rule | User skill with same ID overrides starter skill |
| Required file | `SKILL.md` with YAML frontmatter + markdown body |
| Required fields | `name`, `description` (`name` must match directory ID) |
| Hook metadata | `hooks` supports `pre-planning`, `pre`, `post`, or combinations |

### Hook execution semantics

| Hook | Behavior |
|---|---|
| `pre-planning` | Runs before task planning prompt; failure aborts planning |
| `pre` | Runs before execution prompt; failure aborts execution |
| `post` | Runs after `task_complete`; failure is logged and next post hook continues |

### Starter post-execution skills

| Skill | Purpose |
|---|---|
| `checkpoint` | Commits and pushes agent-authored changes |
| `code-review` | Reviews task changes for correctness, quality, and safety |
| `update-docs` | Reviews implementation deltas and updates impacted docs (`README.md`, `docs/**`, `CHANGELOG.md` when applicable), or explicitly reports when no docs are needed |

Built-in post-execution order for new tasks (when no global/workspace/task override is set) is:

1. `checkpoint`
2. `code-review`
3. `update-docs`

### Customizing hook order (global/workspace/task)

| Scope | Where to change it | Fields |
|---|---|---|
| Global default | `~/.taskfactory/settings.json` (or Settings UI) | `taskDefaults.prePlanningSkills`, `taskDefaults.preExecutionSkills`, `taskDefaults.postExecutionSkills` |
| Workspace override | `~/.taskfactory/workspaces/<workspace-id>/task-defaults.json` (or Workspace Settings) | `prePlanningSkills`, `preExecutionSkills`, `postExecutionSkills` |
| Single task | Create Task form / API request payload | `prePlanningSkills`, `preExecutionSkills`, `postExecutionSkills` |

Example global default override:

```json
{
  "taskDefaults": {
    "prePlanningSkills": ["plan-context"],
    "postExecutionSkills": ["code-review", "update-docs", "checkpoint"]
  }
}
```

### Security guardrails

- Apply least-privilege tool design.
- Validate all extension tool inputs.
- Avoid destructive defaults in hooks.
- Never hardcode secrets in extensions/skills.

## Examples

```bash
# Reload repo extensions
curl -s -X POST "$BASE_URL/api/factory/extensions/reload"

# Reload skills
curl -s -X POST "$BASE_URL/api/factory/skills/reload"

# Targeted server tests
npm run test -w @task-factory/server -- repo-extension-scope.test.ts
npm run test -w @task-factory/server -- skill-hook-execution.test.ts
```

## Related docs

- [System Architecture](./system-architecture.md)
- [State Contract](./state-contract.md)
- [Contribution Commands](./contribution-commands.md)
