# Task Factory

A lean manufacturing-inspired task queue for AI coding agents. Task Factory gives you a two-mode UI: a **planning agent** for research and task decomposition, and a **task pipeline** that feeds work to [Pi](https://github.com/nicholasgasior/pi-coding-agent) agents one task at a time.

## How it works

**Planning mode** — Chat with a planning agent to research, brainstorm, and break work into small tasks. Draft tasks and HTML artifacts land on a **shelf** for review before entering the pipeline.

**Task mode** — Select a task from the pipeline bar to see its details and chat with the task agent. Tasks flow left-to-right: Backlog → Planning → Ready → Executing → Complete.

The pipeline bar sits at the bottom of the screen. Click a task to switch from planning to task mode. Press `Esc` to go back.

## Quick start (npm CLI)

```bash
# Install globally
npm install -g pi-factory

# Start server (opens browser automatically)
pifactory
```

By default, `pifactory` starts the server and opens your browser to [http://localhost:3000](http://localhost:3000).

```bash
pifactory --help                      # Show CLI help
pifactory --version                   # Show version
pifactory --no-open                   # Start without opening browser
PORT=8080 HOST=127.0.0.1 pifactory    # Override host/port
```

`pi-factory` is kept as a compatibility alias.

## Development from source

```bash
git clone https://github.com/patleeman/pi-factory.git
cd pi-factory
npm install
npm run build
npm start

# Or run in dev mode (hot reload)
npm run dev
```

## Prerequisites

- Node.js 20+
- A Pi-compatible API key configured in `~/.pi/agent/auth.json` (see [Pi docs](https://github.com/nicholasgasior/pi-coding-agent))

## Concepts

### Pipeline phases

| Phase | Description |
|-------|-------------|
| **Backlog** | Unplanned tasks. Agent creates a plan before they're ready. |
| **Planning** | Agent is generating a plan and acceptance criteria. |
| **Ready** | Planned and approved. Queued for execution. |
| **Executing** | Agent is actively working on the task. |
| **Complete** | Done. Ready for archiving. |
| **Archived** | Out of the pipeline. |

### Shelf

The planning agent can create **draft tasks** and **HTML artifacts** on the shelf. Draft tasks can be pushed to the backlog with one click. Artifacts are rendered HTML in sandboxed iframes — useful for research summaries, comparison tables, or mockups.

### Extensions

Drop `.ts` files in the `extensions/` directory to add custom tools to the agents. Task Factory includes built-in extensions for `save_plan`, `task_complete`, `create_draft_task`, and `create_artifact`.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Deselect task (return to planning mode) |
| `⌘/Ctrl+K` | Focus chat input |

## Project structure

```
pi-factory/
├── bin/                    # CLI entry point
├── extensions/             # Agent tool extensions
├── packages/
│   ├── client/             # React + Vite frontend
│   ├── server/             # Express + WebSocket backend
│   └── shared/             # Shared types
├── skills/                 # Post-execution skill definitions
└── scripts/                # Build scripts
```

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |

### Workspace config

Each workspace stores configuration in `{workspace}/.pi/`:
- `shelf.json` — Draft tasks and artifacts
- `planning-messages.json` — Planning conversation history
- Task files live in `{workspace}/.pi/tasks/`

## Development

```bash
npm run dev          # Start all packages with hot reload
npm run build        # Production build
npm run typecheck    # Type checking across all packages
```

## License

MIT
