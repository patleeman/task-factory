# Getting Started (Local Development)

This guide gets a new engineer from clone to a successful local run.
It is aligned to the current npm workspace scripts in the root `package.json` and `packages/*/package.json`.

## Prerequisites

- **Node.js 20+** (the server bundle targets `node20` in `scripts/bundle-server.js`)
- **npm** (workspace scripts use npm workspaces)
- **Git**
- **Pi configured locally** (auth + model/provider setup in `~/.pi/agent/`)
- **Available local ports**
  - `3000` for the API/WebSocket server in dev
  - `3001` for the Vite client in dev (Vite auto-picks another port if needed)

## 1) Clone and install

```bash
git clone https://github.com/patleeman/pi-factory.git
cd pi-factory
npm install
```

## 2) Verify the workspace installs cleanly

```bash
npm run build
```

This builds all workspaces and bundles the production server to `dist/server.js`.

## 3) First successful local run (recommended: dev mode)

```bash
npm run dev
```

What this starts:

- `@pi-factory/shared` in watch mode
- `@pi-factory/server` in watch mode (`tsx watch`)
- `@pi-factory/client` via Vite dev server

Then open the URL printed by Vite (usually `http://localhost:3001`).

> Note: client dev proxy targets `http://localhost:3000` in `packages/client/vite.config.ts`, so keep the server on port `3000` for `npm run dev` unless you also update the proxy target.

### Success checklist

- The browser UI loads
- The server starts on `127.0.0.1:3000`
- You can open/create tasks in the UI without startup errors

Stop everything with `Ctrl+C`.

## 4) Alternative: run the production build locally

```bash
npm run build
npm start
```

Then open `http://127.0.0.1:3000`.

If `3000` is already in use:

```bash
PORT=3100 npm start
```

## Monorepo structure and where to make changes

| Area | Path | What lives here | Edit here when you need to... |
|---|---|---|---|
| `client` | `packages/client/` | React + Vite frontend | Change UI, interactions, routing, client-side state, or presentation |
| `server` | `packages/server/` | Express + WebSocket backend and task pipeline logic | Add/modify APIs, queue behavior, planning/execution services, storage, or server orchestration |
| `shared` | `packages/shared/` | Shared TypeScript types/contracts | Change types used by both client and server |
| `extensions` | `extensions/` | Custom runtime tools exposed to planning/execution agents | Add/update agent tools (e.g., task lifecycle/shelf helpers) |
| `skills` | `skills/` | Built-in skill prompts and hook metadata | Add/update reusable execution skills and instructions |

### Common change map

- **New UI panel / component:** `packages/client/src/components/*`
- **API route or server behavior:** `packages/server/src/index.ts` + related `*-service.ts`
- **Shared task/model types:** `packages/shared/src/types.ts`
- **New agent tool (extension):** `extensions/<tool-name>.ts`
- **New reusable skill:** `skills/<skill-name>/SKILL.md`

## Troubleshooting first run

- **`EADDRINUSE` on port `3000`**: another process is using the server port; stop that process and rerun.
- **Client starts on `3002+` instead of `3001`**: expected when `3001` is busy; use the URL Vite prints.
- **Auth/model errors in the app**: verify Pi auth/provider config under `~/.pi/agent/`.
