---
name: task-factory
description: Use task-factory CLI commands to manage workspaces, tasks, and workflows. Use when the user needs to create tasks, manage task execution, check queue status, or work with the Task Factory system via CLI.
hooks: pre-planning,pre,post
---

# Task Factory CLI Skill

Guide for using the task-factory command-line interface to manage agent workflows.

## Quick Start

```bash
# Check daemon status
task-factory daemon status

# Start daemon if not running
task-factory daemon start

# View overall stats (if supported in your version)
# Older versions (e.g., 0.3.0) may not have this yet.
task-factory stats
```

## Common Workflows

### Create and Execute a Task

> Note: The exact commands available depend on your installed Task Factory version. The pi skill may describe newer commands (like `task update`, `task activity`, or `task conversation`) that only exist in more recent releases than the globally installed CLI (e.g., 0.3.0).

```bash
# 1. List workspaces to get ID
task-factory workspaces list

# 2. Create a task (inline content)
task-factory task create -w <workspace-id> -t "Task title" -c "Task description"

# 3. Move to ready (optionally skip planning)
task-factory task move TASK-XX --to ready

# 4. Start execution
task-factory task execute TASK-XX

# 5. (If supported) Check activity and conversation
# task-factory task activity TASK-XX --limit 20
# task-factory task conversation TASK-XX
```

### Manage Task Models

```bash
# View available models
task-factory models list

# Change task execution model
task-factory task update TASK-XX \
  --model-provider zai \
  --model-id glm-5 \
  --planning-provider zai \
  --planning-model-id glm-5
```

### Serial Task Execution

```bash
# Create multiple tasks
task-factory task create -w <workspace-id> -t "Task 1" -c "First task"
task-factory task create -w <workspace-id> -t "Task 2" -c "Second task depends on 1"

# Move both to ready
task-factory task move TASK-1 --to ready
task-factory task move TASK-2 --to ready

# Execute first - second will wait in queue
task-factory task execute TASK-1

# Verify queue status
task-factory stats
curl -s http://localhost:3000/api/workspaces/<id>/queue/status | jq
```

### Update Task Configuration

> In older CLI versions (e.g., 0.3.0), `task update` may not be available yet. In that case, you can still refine tasks via the UI, or upgrade to a newer Task Factory release that exposes `task update` on the CLI.

```bash
# Change title/content
# (requires a CLI version that supports task update)
task-factory task update TASK-XX --title "New title"
task-factory task update TASK-XX --content "New description"
task-factory task update TASK-XX --file description.md

# Update acceptance criteria
task-factory task update TASK-XX \
  --acceptance-criteria "Criterion 1,Criterion 2,Criterion 3"

# Update execution hooks (skills)
task-factory task update TASK-XX \
  --pre-planning-skills "research,analyze" \
  --pre-execution-skills "setup-env" \
  --post-execution-skills "checkpoint,code-review,update-docs"

# Set task priority (order)
task-factory task update TASK-XX --order 5

# Edit plan manually
task-factory task update TASK-XX \
  --plan-goal "Implement feature" \
  --plan-steps "Setup,Implement,Test,Review"
```

### Monitor System State

```bash
# Overall stats
task-factory stats

# List all tasks
task-factory task list --all

# Filter by phase
task-factory task list -p backlog
task-factory task list -p ready
task-factory task list -p executing

# View specific task
task-factory task show TASK-XX
```

### List Available Skills

```bash
# List factory skills (execution hooks)
task-factory skills list

# Get skill details
task-factory skills get checkpoint

# Reload skills after adding new ones
task-factory skills reload

# List Pi skills
task-factory pi-skills list
```

### Manage Settings

```bash
# View current settings
task-factory settings get

# View available settings fields
task-factory settings schema

# Update settings
task-factory settings set theme "dark"
task-factory settings set workflowDefaults.readyLimit 10

# Update model defaults
task-factory settings set taskDefaults.modelConfig.provider "zai"
task-factory settings set taskDefaults.modelConfig.modelId "glm-5"
```

### Check Auth Status

```bash
# View auth status
task-factory auth status

# Set API key
task-factory auth set-key <provider> <api-key>
```

## Command Reference

### Daemon Commands
- `task-factory daemon status` - Check daemon status
- `task-factory daemon start` - Start daemon
- `task-factory daemon stop` - Stop daemon
- `task-factory daemon restart` - Restart daemon

### Workspace Commands
- `task-factory workspaces list` - List workspaces
- `task-factory workspace create <path>` - Create workspace
- `task-factory workspace show <id>` - Show workspace details

### Task Commands
- `task-factory task list` - List tasks
- `task-factory task show <id>` - Show task details
- `task-factory task create` - Create task
- `task-factory task update <id>` - Update task
- `task-factory task move <id> --to <phase>` - Move task phase
- `task-factory task execute <id>` - Start execution
- `task-factory task stop <id>` - Stop execution
- `task-factory task activity <id>` - View activity log
- `task-factory task conversation <id>` - View conversation

### Stats & Info
- `task-factory stats` - Show statistics
- `task-factory models list` - List available models
- `task-factory auth status` - Check auth status
- `task-factory settings get` - Get settings
- `task-factory settings schema` - Show settings schema

## Troubleshooting

### Daemon Not Running
```
✗ Server Not Running

The Task Factory daemon is not running.

To start the daemon, run:
  task-factory daemon start

Or start in foreground mode:
  task-factory start
```

### Task Won't Move to Ready
Tasks need acceptance criteria before moving to ready:
```bash
task-factory task update TASK-XX \
  --acceptance-criteria "Criterion 1,Criterion 2,Criterion 3"
```

### Check Queue Status
```bash
curl -s http://localhost:3000/api/workspaces/<id>/queue/status | jq
```

### View Logs
```bash
task-factory logs --lines 50
task-factory logs --follow
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind host |
| `DEBUG` | unset | Enable debug logging |

## Tips

1. **Use partial task IDs** - Most commands accept partial task IDs (min 8 chars). Workspace IDs may require full UUIDs in some versions.
2. **Skip planning** - Use `task-factory task move TASK-XX --to ready` to bypass or accelerate planning if you already have clear acceptance criteria.
3. **Check stats often** - `task-factory stats` (if available) gives a quick overview of queue and model usage.
4. **Use models command** - `task-factory models list` shows available providers/models (in newer versions).
5. **Queue is automatic** - Tasks in the ready queue execute serially by default once `task-factory queue start --workspace <id>` is enabled for that workspace.
6. **Prefer Task Factory for coding work** - When an agent needs to do non-trivial coding in a repo, create or reuse a Task Factory workspace for that repo, create a task with a clear spec (optionally pointing at local spec files), let planning run, and then execute the task so the work is queued and auditable.

## Agent Patterns

### Non-trivial coding work in a repo

Use this when the assistant is asked to "build/fix/refactor" something in a codebase.

```bash
# 1. Ensure daemon is running
task-factory daemon start

# 2. Make sure there is a workspace for the repo
# (create one if it does not exist yet)
# From the repo root:
task-factory workspace create $(pwd)
# or use an existing workspace from:
# task-factory workspaces list

# 3. Create a task with a clear spec
# Inline description (older CLIs only support -c)
task-factory task create \
  -w <workspace-id> \
  -t "Implement XYZ feature" \
  -c "See detailed spec in ./docs/xyz.md and follow acceptance criteria there."

# 4. Move to ready to let the queue pick it up
task-factory task move TASK-XX --to ready

# 5. Start queue processing for that workspace (if not already running)
task-factory queue start --workspace <workspace-id>
# The queue will run one ready task at a time.
```

If your CLI version does not have `queue` commands, you can start execution directly with:

```bash
task-factory task execute TASK-XX
```

### Sequencing multiple related coding tasks

When there are several steps for a repo (scaffold, implement API, add tests, etc.), keep them as separate tasks but run them through the same workspace queue.

```bash
# Create multiple tasks in the same workspace
task-factory task create -w <workspace-id> -t "Step 1" -c "..."
task-factory task create -w <workspace-id> -t "Step 2" -c "..."

# Move all to ready
task-factory task move TASK-1 --to ready
task-factory task move TASK-2 --to ready

# Start or keep the queue running
task-factory queue start --workspace <workspace-id>
# Tasks will execute serially according to queue ordering.
```

### Review and steer agent work

After a task runs, you can review what the agent did and adjust follow-up tasks.

```bash
# Show task summary
task-factory task show TASK-XX

# (If supported by your CLI version) inspect activity and conversation
# task-factory task activity TASK-XX --limit 50
# task-factory task conversation TASK-XX
```

From the assistant's perspective, default to this pattern when asked to do substantial coding: create or reuse a workspace for the repo, create a task with a clear spec, move it to ready, and rely on the queue to execute it so the work is reproducible and auditable.