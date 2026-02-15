# Extension + Execution Skill Customization

This guide documents how to safely extend Task Factory with:

1. **Repo-local extensions** (`extensions/`) that register agent tools.
2. **Execution skills** (`skills/` and `~/.taskfactory/skills/`) that run in pre/post hooks.

Use this when adding new tools, scoping tools by agent audience, or creating automation skills.

## Customization surfaces at a glance

| Surface | Location | Runtime role | Typical use |
|---|---|---|---|
| Repo extension | `extensions/<id>.ts` or `extensions/<id>/index.ts` | Registers tools into Pi sessions | Add a new tool (`save_*`, `manage_*`, integrations) |
| Execution skill | `skills/<id>/SKILL.md` (starter) or `~/.taskfactory/skills/<id>/SKILL.md` (user override) | Runs additional prompt turns in `pre`/`post` hooks | Enforce workflows (test-first, review, checkpoint) |

---

## 1) Repo extension discovery, loading, and audience scoping

Source of truth: `packages/server/src/agent-execution-service.ts`.

### Discovery rules

`discoverRepoExtensions()` finds the Task Factory repo `extensions/` directory, then loads:

- `extensions/<name>.ts`
- `extensions/<name>/index.ts`

It skips hidden entries and `node_modules`.

Discovered paths are cached in `_repoExtensionPaths` and reused until reloaded.

### Loading behavior

Repo extensions are loaded through `DefaultResourceLoader({ additionalExtensionPaths })`:

- **Foreman planning sessions** use `getRepoExtensionPaths('foreman')`.
- **Task conversations** (planning/execution/rework) use `getRepoExtensionPaths('task')`.

These are **additional** paths; Pi global extensions from `~/.pi/agent/extensions` are still handled by Pi runtime behavior.

### Audience scoping rules

`RepoExtensionAudience` supports:

- `all`
- `foreman`
- `task`

`FOREMAN_ONLY_EXTENSION_IDS` controls exclusions for task sessions.

Current behavior:

- `task` excludes foreman-only extensions.
- `foreman` and `all` include all repo extensions.

Today, `web-tools` is foreman-only (`web_search` / `web_fetch` are intentionally unavailable in task sessions).

> Extension scope is one guardrail; mode contracts in `docs/architecture/state-contract.md` are another.

---

## 2) Execution skill discovery, hook support, and configuration

Source of truth: `packages/server/src/post-execution-skills.ts`.

### Discovery and precedence

`discoverPostExecutionSkills()` merges two sources:

1. **Starter skills** from repo `skills/`
2. **User skills** from `~/.taskfactory/skills`

Merge is by `id` (directory name): **user skills override starter skills** with the same ID.

Results are cached (`_cachedSkills`) until `reloadPostExecutionSkills()` (or server restart).

### Required `SKILL.md` shape

Each skill directory must contain `SKILL.md` with YAML frontmatter + markdown body.

Required frontmatter fields:

- `name`
- `description`

Validation rule:

- `name` must exactly match the directory name (this becomes `skill.id`).

Recognized metadata keys:

- `type`: `follow-up` (default) or `loop`
- `hooks` (or legacy `hook`): comma/space list containing `pre`, `post`, or both
- `max-iterations`: loop cap (default `1`)
- `done-signal`: loop completion marker (default `HOOK_DONE`)
- `workflow-id`: optional grouping label
- `pairs-with`: optional related skill ID

If `hooks` is missing or invalid, runtime defaults to `pre,post` for backward compatibility.

### Hook execution semantics

- **Pre-execution hooks** (`runPreExecutionSkills`)
  - run before main task prompt
  - missing skill or unsupported `pre` hook throws
  - failure aborts main execution and post hooks

- **Post-execution hooks** (`runPostExecutionSkills`)
  - run after `task_complete` signal
  - missing skill or unsupported `post` hook is skipped (logged)
  - failure does not fail task completion; next post skill continues

### Config fields and per-task overrides

Skill frontmatter can include a `config` array. Each field supports:

- `key`, `label`, `type`, `default`, `description`
- optional `validation` (`min`, `max`, `pattern`, `options`)

At runtime, task-level `skillConfigs` overrides are applied per skill:

- source: `task.frontmatter.skillConfigs[skillId]`
- template interpolation: `{{field-key}}`
- reserved control keys: `max-iterations`, `done-signal`

Useful behavior note:

- invalid `max-iterations` overrides are ignored for loop count, but still interpolate into prompt text.

---

## 3) Workflow: add a new repo extension tool

1. **Choose an ID and audience**
   - File name (or parent directory for `index.ts`) becomes extension ID.
   - Decide if it should be foreman-only.

2. **Add extension entrypoint**
   - Create `extensions/<id>.ts` (or `extensions/<id>/index.ts`).
   - Export default `(pi: ExtensionAPI) => { ... }`.

3. **Register tools with strict schemas**
   - Use `TypeBox` (`Type.Object(...)`) parameters.
   - Validate inputs and return explicit errors.

4. **Keep business logic server-side**
   - Prefer callback bridges (`globalThis.__piFactory...`) into server services.
   - Keep extension files as adapters, not policy owners.

5. **Apply audience scoping (if needed)**
   - Add ID to `FOREMAN_ONLY_EXTENSION_IDS` for foreman-only tools.

6. **Reload and verify discovery**
   - Call `POST /api/factory/extensions/reload` or restart server.
   - Check `GET /api/factory/extensions` returns expected entry.

7. **Run required validation checks**
   - Add/adjust extension tests under `packages/server/tests/`.
   - Run:

```bash
npm run test -w @pi-factory/server -- repo-extension-scope.test.ts
npm run lint -w @pi-factory/server
npm run typecheck -w @pi-factory/server
```

---

## 4) Workflow: add a new execution skill

1. **Pick skill ID and hook lane(s)**
   - Use lowercase hyphenated ID (`skills/<id>/SKILL.md`).
   - Decide `pre`, `post`, or both.

2. **Create `SKILL.md`**
   - Add required frontmatter (`name`, `description`).
   - Set `metadata.type`, `metadata.hooks`, and loop controls if needed.

3. **(Optional) Define configurable fields**
   - Add `config` entries for values you want editable per task.
   - Reference values in prompt template via `{{key}}`.

4. **Reload and verify**
   - Call `POST /api/factory/skills/reload` or restart server.
   - Check `GET /api/factory/skills` for hooks, type, source, config schema.

5. **Wire into task/workspace defaults**
   - Select skill in UI or set task fields:
     - `preExecutionSkills`
     - `postExecutionSkills`
     - `skillConfigs`

6. **Run required validation checks**
   - Add/update tests for hook compatibility and config interpolation.
   - Run:

```bash
npm run test -w @pi-factory/server -- post-execution-skills.test.ts skill-hook-execution.test.ts post-execution-skills-config.test.ts task-defaults-service.test.ts
npm run lint -w @pi-factory/server
npm run typecheck -w @pi-factory/server
```

---

## 5) Security and safety guidance (required)

Task Factory has no sandbox; tools run with your user permissions. Treat every extension/skill change as privileged automation.

### For extensions

- Prefer **least privilege**: only expose tools that are necessary.
- Keep risky capabilities (networking, mass file writes, destructive shell behavior) out of task sessions unless explicitly required.
- Validate every tool input and reject ambiguous/dangerous payloads.
- Require explicit user confirmation patterns for destructive operations.
- Never hardcode secrets; rely on environment variables and existing auth storage.

### For execution skills

- Keep prompts deterministic and scope-limited.
- Use `pre` hooks for setup/verification only; remember failures block main execution.
- Bound loop skills with conservative `max-iterations` and clear `done-signal`.
- Avoid accidental destructive automation in post hooks (for example force pushes or broad deletes).

### Regression checks to keep

- Scope regression: `repo-extension-scope.test.ts`
- Hook behavior: `skill-hook-execution.test.ts`
- Config interpolation/control overrides: `post-execution-skills-config.test.ts`
- Defaults/hook compatibility validation: `task-defaults-service.test.ts`

---

## Related docs

- [State Contract (canonical)](../architecture/state-contract.md)
- [Runtime Flows](../architecture/runtime-flows.md)
- [Developer Commands Reference](./developer-commands.md)
