# CLI Migration Guide (0.3.x → 0.5.x)

Use this guide when upgrading older global Task Factory CLI installs (for example `0.3.0`) to the current release.

## 1) Upgrade the global CLI

```bash
# Upgrade from npm registry
npm install -g task-factory@latest

# Confirm installed version
task-factory --version
```

## 2) Verify required command surface

```bash
# Human check
task-factory --help

# Machine check (recommended for agents/automation)
task-factory capabilities --compact
```

Required commands for modern agent workflows:

- `task-factory task update`
- `task-factory task activity`
- `task-factory task conversation`
- `task-factory stats`
- `task-factory models list`
- `task-factory settings`

A fully upgraded install reports:

- `supportLevel: "full"`
- `requiredForAgents` values all `true`
- `commands.missingRequired` empty

## 3) Agent-facing warning behavior for missing capabilities

Agents should run `task-factory capabilities --compact` once per session and branch behavior:

- `supportLevel: "full"`: run normal command flow.
- `supportLevel: "partial"`: warn clearly and avoid unsupported commands.

Recommended warning text:

> Installed task-factory CLI is missing required commands for this workflow. Upgrade with `npm install -g task-factory@latest`.

Use `commands.missingRequired` to report exactly what is unavailable.

## 4) Rollback guidance

If upgrade causes issues, rollback to a known version:

```bash
npm install -g task-factory@0.5.2
task-factory --version
```

After rollback, rerun:

```bash
task-factory capabilities --compact
```

to confirm supported/unsupported commands before resuming automation.

## 5) Rollout plan (maintainers)

1. Run local release checks (`npm run test`, `npm run check:cli-drift`, `npm run build`).
2. Publish the new CLI (`npm publish`) and verify package metadata in npm.
3. Install globally in a clean shell (`npm install -g task-factory@latest`).
4. Verify required command surface with:
   - `task-factory --version`
   - `task-factory task --help`
   - `task-factory capabilities --compact`
5. Notify agent operators to run one-time capability checks at session start and follow partial-support warning flow.

## 6) Release gate (maintainers)

Before publishing a new CLI release, run:

```bash
npm run check:cli-drift
```

This fails when the shipped CLI command surface and the documented/skill command surface diverge.
