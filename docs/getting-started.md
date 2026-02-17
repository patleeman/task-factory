# Getting Started

## Scope

Local onboarding for running and developing Task Factory from source.

## Use when

- You are setting up the project for the first time
- You need the fastest path from clone to a successful local run
- You want to know where to make changes in the monorepo

## Quick start

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | Server bundle targets Node 20 |
| npm | Workspace scripts use npm workspaces |
| Git | Required for repository workflows |
| Pi local config | Auth/provider setup under `~/.pi/agent/` |
| Open local ports | `3000` (server), `3001` (Vite dev client) |

### Install

```bash
git clone https://github.com/patleeman/task-factory.git
cd task-factory
npm install
```

### First successful run (dev mode)

```bash
npm run dev
```

This starts shared watch, server watch, and the Vite client.
Open the URL printed by Vite (usually `http://localhost:3001`).

### Production-style local run

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3000`.

## Reference

### Monorepo map

| Area | Path | Edit here when you need to... |
|---|---|---|
| Client | `packages/client/` | Update UI, interactions, and rendering |
| Server | `packages/server/` | Change APIs, queue behavior, planning/execution orchestration |
| Shared | `packages/shared/` | Update shared TypeScript contracts |
| Extensions | `extensions/` | Add agent tools exposed to sessions |
| Skills | `skills/` | Add reusable pre/post execution skills |

### Common first-run issues

| Symptom | Resolution |
|---|---|
| `EADDRINUSE` on `3000` | Stop the conflicting process or set a different `PORT` |
| Client opens on `3002+` | Expected when `3001` is busy; use printed Vite URL |
| Provider/auth errors | Verify `~/.pi/agent/` configuration |

## Examples

```bash
# Run just the server in watch mode
npm run dev:server

# Run server tests
npm run test -w @task-factory/server
```

## Related docs

- [CLI Reference](./cli-reference.md)
- [Workflow and Queue](./workflow-and-queue.md)
- [System Architecture](./system-architecture.md)
- [Contribution Commands](./contribution-commands.md)
