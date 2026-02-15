# Task Factory

Task Factory is a lean manufacturing-inspired task queue for AI coding agents, built on **Pi**.

It gives you a two-mode interface:
- a **planning agent** for research and task decomposition
- a **task pipeline** that executes work in controlled, trackable phases

> ⚠️ **Important security note:** Task Factory is built on Pi and currently has **no sandboxing**.
> Agents can run tools and commands with your user permissions. Only run it against trusted code/workspaces.

## How the application works

### 1) Planning mode (Foreman)
In planning mode, you chat with a planning agent to:
- explore the codebase
- break larger goals into smaller tasks
- draft acceptance criteria and implementation plans

Planning output is saved to a **Shelf** as draft tasks and artifacts for review.

### 2) Shelf review
The Shelf acts as a staging area for planning output:
- **Draft tasks** can be promoted into the pipeline
- **Artifacts** (e.g. HTML summaries) can be reviewed before execution

### 3) Task pipeline execution
Tasks move left-to-right through phases:

| Phase | Description |
|---|---|
| **Backlog** | New/unplanned tasks |
| **Planning** | Plan generation in progress |
| **Ready** | Planned and queued |
| **Executing** | Agent actively working |
| **Complete** | Finished |
| **Archived** | Removed from active flow |

### 4) Task mode
Selecting a task switches to task mode, where you can:
- inspect task details
- chat with the task agent
- monitor streaming progress, tool calls, and status updates

## Prerequisites

- Node.js **20+**
- Pi configured locally (auth + model/provider setup in `~/.pi/agent/`)

## Installation

### Option A: Install from npm (recommended)

```bash
npm install -g pi-factory
```

This installs both CLI commands:
- `pifactory` (primary)
- `pi-factory` (compatibility alias)

### Option B: Install from source

```bash
git clone https://github.com/patleeman/pi-factory.git
cd pi-factory
npm install
```

## Quickstart

### Start with the CLI

```bash
pifactory
```

By default this starts the server and opens the app in your browser.

Useful options:

```bash
pifactory --help
pifactory --version
pifactory --no-open
PORT=8080 HOST=127.0.0.1 pifactory
```

### Start from source (production build)

```bash
npm run build
npm start
```

Then open `http://localhost:3000`.

### Development mode

```bash
npm run dev
```

## Configuration

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket server port |
| `HOST` | `0.0.0.0` (CLI) | Bind host |
| `DEBUG` | _(unset)_ | Enable debug-level server logs when set to any non-empty value |
| `PI_FACTORY_SERVER_LOG_PATH` | `~/.pi/factory/logs/server.jsonl` | Override server log file destination |

### Server logging

The server writes JSON log lines to both console output (`stdout`/`stderr`) and a local log file.

- Default log file: `~/.pi/factory/logs/server.jsonl`
- Custom log file: set `PI_FACTORY_SERVER_LOG_PATH`

For troubleshooting, inspect or tail that file directly.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Esc` | Return to planning mode |
| `⌘/Ctrl+K` | Focus chat input |

## Built on Pi (and no sandboxing yet)

Task Factory is built directly on the Pi coding-agent runtime and extension model.

That means:
- agent capabilities are powerful and flexible
- but there is currently **no sandboxing boundary** in Task Factory
- commands/tool calls execute with your local machine permissions

Use trusted repositories, review task intent, and run in an environment you control.

## Contributing

We are currently **not accepting pull requests**.

If you find a bug or have a feature request, please open a GitHub **Issue** with:
- what you expected
- what happened
- steps to reproduce
- logs/screenshots (if available)

## License

MIT
