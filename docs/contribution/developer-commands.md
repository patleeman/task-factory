# Developer Commands Reference

Run commands from the repository root unless noted otherwise.
All entries below map directly to the current npm scripts defined in the root and workspace `package.json` files.

## Core workflows

| Workflow | Command | What it does |
|---|---|---|
| Start full local dev stack | `npm run dev` | Builds `shared` once, then runs `dev:shared`, `dev:server`, and `dev:client` concurrently |
| Build production artifacts | `npm run build` | Builds all workspaces and bundles server output to `dist/server.js` |
| Run production build locally | `npm start` | Starts `@pi-factory/server` from compiled output (run `npm run build` first) |
| Lint all workspaces | `npm run lint` | Runs ESLint in `client`, `server`, and `shared` |
| Typecheck all workspaces | `npm run typecheck` | Runs TypeScript `--noEmit` checks in all workspaces |
| Run tests | `npm run test` | Runs workspace test suites (`server` currently defines tests) |
| Run coverage | `npm run test:coverage` | Runs `vitest --coverage` in `@pi-factory/server` |

## Workspace-scoped commands

| Workflow | Command |
|---|---|
| Client only (Vite dev server) | `npm run dev:client` |
| Server only (`tsx watch`) | `npm run dev:server` |
| Shared types watch build | `npm run dev:shared` |
| Run any script in one workspace | `npm run <script> -w @pi-factory/<client|server|shared>` |

Examples:

```bash
npm run lint -w @pi-factory/client
npm run test -w @pi-factory/server
npm run build -w @pi-factory/shared
```

## Release and hygiene gates

| Workflow | Command |
|---|---|
| Dead-code/dependency checks | `npm run check:deadcode` |
| Full release gate (lint + typecheck + test + build + deadcode) | `npm run check:release` |

## Suggested daily loop

1. `npm run dev`
2. Make changes
3. `npm run lint && npm run typecheck && npm run test`
4. Before merge/release-sensitive changes: `npm run build` and optionally `npm run check:release`
