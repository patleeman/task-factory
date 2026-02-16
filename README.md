# Task Factory

Task Factory is a queue-first work orchestrator for AI coding agents, built on **Pi**.

By default, Task Factory runs with Pi-style **YOLO mode** behavior (no permission popups/approval gates). Agents can execute tools and shell commands with your local user permissions.

> ⚠️ **Security warning:** Task Factory currently has **no sandbox boundary**. Only run it on trusted repositories and in environments you control.

## Why this exists

Task Factory is designed around one idea: **the human is the bottleneck**.

Instead of juggling many half-finished agent runs, you stage work in a queue and let the system sequence it with explicit capacity limits. The goal is to maximize your throughput and reduce context switching.

## Product preview

![Idea backlog and queue sequencing](docs/screenshots/idea_backlog.png)

![Task-level execution context and review](docs/screenshots/task_view.png)

## Core queue states (working flow)

The active flow is intentionally simple:

| State | Meaning |
|---|---|
| **Backlog** | Captured work/intent that is not yet queued to run |
| **Ready** | Planned work that is approved and waiting for execution capacity |
| **Executing** | Agent is actively implementing the task |
| **Complete** | Execution finished; task is ready for review/rework/archive |

`archived` also exists for historical storage, but the core day-to-day working queue is **backlog → ready → executing → complete**.

> Planning is handled as task-level lifecycle/status (plan generation + criteria), not as a separate queue column.

## Queue philosophy: pull, sequence, and WIP limits

Task Factory uses pull-based flow:

- Work is added to **backlog** as intents.
- Tasks move to **ready** only when they are defined enough to execute.
- The queue pulls from **ready** into **executing** when capacity is available.
- WIP/concurrency limits constrain how many tasks can be staged or running at once (for example, one executing task at a time).

This keeps agent output aligned to your review capacity and prevents overproduction.

## Task-level context lifecycle (single-task encapsulation)

Each task is the unit of context and traceability:

1. **Original intent**
   - Task description captures the problem/request in markdown.
2. **Context aids**
   - Attach files/images directly to the task.
   - Add **Excalidraw** sketches to communicate intent visually.
3. **Plan + acceptance criteria**
   - A planning run generates a structured plan and testable acceptance criteria.
4. **Execution history**
   - Task chat/activity history shows what the agent did and why.
5. **Completion review**
   - Post-execution summary includes what changed, code-change evidence (file diffs), and acceptance-criteria validation (pass/fail/pending with evidence).

## Workflow customization per task

Each task can run ordered skills around main execution:

- **Pre-execution hooks**: run before implementation (for setup, guardrails, quality gates, etc.).
- **Post-execution hooks**: run after implementation (for quality checks, commit/push, PR workflows, reporting, etc.).

These hooks are configurable per task so you can enforce the workflow your team wants.

## Prerequisites

- Node.js **20+**
- npm
- Git
- Pi configured locally (`~/.pi/agent/` auth + model/provider setup)

## Installation

### Option A: npm global install

```bash
npm install -g pi-factory
```

This installs both CLI names:

- `pifactory` (primary)
- `pi-factory` (compatibility alias)

Run it:

```bash
pifactory
```

### Option B: run from source

```bash
git clone https://github.com/patleeman/pi-factory.git
cd pi-factory
npm install
```

## Running from source

### Production build

```bash
npm run build
npm start
```

Open `http://127.0.0.1:3000`.

### Development mode

```bash
npm run dev
```

This starts shared, server, and client in watch/dev mode.

## Useful CLI options

```bash
pifactory --help
pifactory --version
pifactory --no-open
PORT=8080 HOST=127.0.0.1 pifactory
HOST=0.0.0.0 pifactory  # Expose on your network (explicit opt-in)
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket server port |
| `HOST` | `127.0.0.1` | Server bind host |
| `DEBUG` | _(unset)_ | Enable debug-level server logs when set to any non-empty value |
| `PI_FACTORY_SERVER_LOG_PATH` | `~/.taskfactory/logs/server.jsonl` | Override server log file destination |

By default Task Factory binds to loopback only; set `HOST=0.0.0.0` to intentionally expose on your network.

## Quality checks

```bash
npm run check:deadcode
npm run check:release
```

## Feature gallery

Additional screenshots for key workflows and capabilities:

![Provider setup and login](docs/screenshots/provider_login.png)

![Question/answer flow in planning](docs/screenshots/qa.png)

![Artifacts generated during planning](docs/screenshots/artifacts.png)

![Customizable execution skills](docs/screenshots/customizable_skills.png)

![Task skill sequencing](docs/screenshots/task_skill_sequencing.png)

![Embedded Excalidraw for visual intent](docs/screenshots/embedded_excalidraw.png)

![Task archive and history](docs/screenshots/task_archive.png)

![Task completion summary and criteria review](docs/screenshots/task_completion_summary.png)

![Task statistics and metrics](docs/screenshots/task_stats.png)

![Voice dictation support](docs/screenshots/voice_dictation.png)

## License

MIT
