# Contribution Commands

## Scope

Command reference for day-to-day development and release validation.

## Use when

- You are implementing changes in this repository
- You need build/lint/typecheck/test commands
- You want workspace-specific command examples

## Quick start

```bash
npm run dev
npm run lint && npm run typecheck && npm run test
npm run build
```

## Reference

### Core workflows

| Workflow | Command | Purpose |
|---|---|---|
| Full local dev stack | `npm run dev` | Shared watch + server watch + client Vite |
| Production build | `npm run build` | Builds workspaces and bundles server |
| Run production build | `npm start` | Starts compiled server |
| Lint | `npm run lint` | ESLint across workspaces |
| Typecheck | `npm run typecheck` | TS checks with no emit |
| Test | `npm run test` | Workspace tests |
| Coverage | `npm run test:coverage` | Coverage run for server tests |

### Workspace-scoped commands

| Workflow | Command |
|---|---|
| Client dev server | `npm run dev:client` |
| Server watch mode | `npm run dev:server` |
| Shared watch build | `npm run dev:shared` |
| One workspace script | `npm run <script> -w @task-factory/<client|server|shared>` |

### Release and hygiene checks

| Workflow | Command |
|---|---|
| Dead-code checks | `npm run check:deadcode` |
| Full release gate | `npm run check:release` |

## Examples

```bash
npm run lint -w @task-factory/client
npm run test -w @task-factory/server
npm run build -w @task-factory/shared

# Lifecycle-focused server tests
npm run test -w @task-factory/server -- state-contract.test.ts
npm run test -w @task-factory/server -- state-transition.test.ts
```

## Related docs

- [Getting Started](./getting-started.md)
- [CLI Reference](./cli-reference.md)
- [System Architecture](./system-architecture.md)
