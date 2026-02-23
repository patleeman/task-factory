---
name: task-factory-cli
description: Use task-factory CLI commands to manage workspaces, tasks, and workflows. Use when the user needs to create tasks, manage task execution, check queue status, or work with the Task Factory system via CLI.
---

# Task Factory CLI Skill

Guide for using the task-factory command-line interface to manage agent workflows.

## Quick Start

```bash
# Check daemon status
task-factory daemon status

# Start daemon if not running
task-factory daemon start

# View overall stats
task-factory stats
```

## Common Workflows

### Create and Execute a Task

```bash
# 1. List workspaces to get ID
task-factory workspaces list

# 2. Create a task
task-factory task create -w <workspace-id> -t "Task title" -c "Task description"

# 3. Move to ready (optionally skip planning)
task-factory task move TASK-XX --to ready

# 4. Start execution
task-factory task execute TASK-XX

# 5. Check activity
task-factory task activity TASK-XX --limit 20

# 6. View conversation when done
task-factory task conversation TASK-XX
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

```bash
# Change title/content
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

1. **Use partial task IDs** - Most commands accept partial IDs (min 8 chars)
2. **Skip planning** - Use `--skip-planning` or set task to ready directly
3. **Check stats often** - `task-factory stats` gives quick overview
4. **Use models command** - Find available models before switching
5. **Queue is automatic** - Tasks in ready queue execute serially by default