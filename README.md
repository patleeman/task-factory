# Task Factory

Task Factory is a queue-first work orchestrator for AI coding agents, built on **[Pi](https://github.com/badlogic/pi-mono/tree/main)**.


## Philosophy

Task Factory is designed around one idea: **the human is the bottleneck**.

Instead of juggling many half-finished agent runs, you stage work in a queue and let the system sequence the work in order. Task factory's goal is to maximize your throughput, reduce context switching, and automate the completion of the task. 

You're left with creating the idea and checking the output.

![Task-level execution context and review](docs/screenshots/task_view.png)

![Idea backlog and queue sequencing](docs/screenshots/idea_backlog.png)

## Workflow 

Task Factory has a fairly opinionated workflow. Tasks progress through stages:

- **Backlog**: Tasks are staged in the backlog as an agent is run to generate a plan. You can review the plan before marking it as ready.
- **Ready**: Once a task is ready for execution, place it in the ready queue, or let it Auto Promote from the backlog.
- **Executing**: Tasks are executed one at a time by default (but that number is configurable). Pre and post execution skill are fired before and after the task is implemented.
- **Completed**: Once in completed state, you can review the task before archiving it.

This keeps agent output aligned to your review capacity and prevents overproduction.

## YOLO by default

Task Factory runs with Pi-style **YOLO mode** behavior (no permission popups/approval gates). Agents can execute tools and shell commands with your local user permissions.

> ⚠️ **Security warning:** Task Factory currently has **no sandbox boundary**. Only run it on trusted repositories and in environments you control.

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
