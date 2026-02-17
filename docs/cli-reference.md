# CLI Reference

## Scope

Reference for launching Task Factory and controlling runtime behavior from the command line.

## Use when

- You are starting Task Factory locally
- You need CLI flags or runtime environment variables
- You want quick command snippets for common operations

## Quick start

### Install and run

```bash
npm install -g task-factory
task-factory
```

### Source run

```bash
npm run build
npm start
```

## Reference

### Core CLI commands

| Command | Purpose |
|---|---|
| `task-factory --help` | Show all CLI options |
| `task-factory --version` | Print installed version |
| `task-factory --no-open` | Start server without auto-opening browser |

### Common runtime environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `127.0.0.1` | Bind host (`0.0.0.0` exposes to network) |
| `DEBUG` | unset | Enables debug logging |
| `PI_FACTORY_SERVER_LOG_PATH` | `~/.taskfactory/logs/server.jsonl` | Structured server log file path |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket heartbeat interval |

### Quality and release checks

| Command | Purpose |
|---|---|
| `npm run check:deadcode` | Dependency/dead-code checks |
| `npm run check:release` | Lint + typecheck + test + build + dead-code |

## Examples

```bash
# Local-only bind on a custom port
PORT=8080 HOST=127.0.0.1 task-factory --no-open

# Network-exposed bind (explicit opt-in)
HOST=0.0.0.0 task-factory

# Start with faster heartbeat pings
WS_HEARTBEAT_INTERVAL_MS=15000 npm start
```

## Related docs

- [Getting Started](./getting-started.md)
- [Contribution Commands](./contribution-commands.md)
- [Workflow and Queue](./workflow-and-queue.md)
