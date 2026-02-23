# CLI Reference

## Overview

Task Factory provides a comprehensive command-line interface for managing workspaces, tasks, and configurations. The CLI is available as the `task-factory` command after installation.

## Installation

```bash
npm install -g task-factory
```

## Global Options

| Option | Description |
|--------|-------------|
| `--version` | Print installed version |
| `--help` | Show help for command |

## Command Categories

---

## Task Commands

Manage tasks across workspaces.

### `task-factory task list`

List tasks in a workspace.

```bash
task-factory task list --workspace <id> [--scope <scope>] [--all]
```

**Options:**
- `-w, --workspace <id>` - Workspace ID (required unless --all)
- `-s, --scope <scope>` - Scope: `active`, `archived`, `all` (default: `active`)
- `-a, --all` - List tasks from all workspaces

**Examples:**
```bash
# List active tasks in workspace
task-factory task list --workspace ws-abc123

# List all tasks across all workspaces
task-factory task list --all

# List archived tasks
task-factory task list --workspace ws-abc123 --scope archived
```

### `task-factory task show <task-id>`

Show detailed information about a task.

```bash
task-factory task show <task-id>
```

**Examples:**
```bash
task-factory task show task-abc123
task-factory task show abc123  # Partial ID matching (min 8 chars)
```

### `task-factory task update <task-id>`

Update task fields.

```bash
task-factory task update <task-id> [options]
```

**Options:**
- `-t, --title <title>` - Update title (max 200 chars)
- `-c, --content <content>` - Update content (max 50000 chars)
- `-a, --acceptance-criteria <criteria>` - Comma-separated criteria (max 50)
- `--pre-execution-skills <skills>` - Comma-separated skill IDs
- `--post-execution-skills <skills>` - Comma-separated skill IDs
- `-f, --file <path>` - Read content from file (max 50000 chars)

**Examples:**
```bash
# Update title
task-factory task update task-abc123 --title "New Title"

# Update from file
task-factory task update task-abc123 --file description.md

# Update acceptance criteria
task-factory task update task-abc123 --acceptance-criteria "Test passing,Code reviewed,Documentation updated"
```

### `task-factory task conversation <task-id>`

View conversation history for a task. Alias: `chat`.

```bash
task-factory task conversation <task-id> [options]
```

**Options:**
- `-l, --limit <n>` - Number of messages (default: 100)
- `--since <duration>` - Show messages since duration (e.g., `2h`, `1d`)
- `-f, --follow` - Follow new messages in real-time
- `-e, --export <file>` - Export to markdown file
- `--json` - Output as JSON
- `--compact` - Compact output format
- `--only <role>` - Filter by role: `user`, `agent`
- `--search <keyword>` - Search in message content

**Examples:**
```bash
# View conversation
task-factory task conversation task-abc123

# Export to file
task-factory task conversation task-abc123 --export chat.md

# Show last 20 messages
task-factory task conversation task-abc123 --limit 20

# Search messages
task-factory task conversation task-abc123 --search "database"
```

### `task-factory task activity <task-id>`

View activity log for a task.

```bash
task-factory task activity <task-id> [options]
```

**Options:**
- `-l, --limit <n>` - Number of entries (default: 50)
- `--json` - Output as JSON

### `task-factory task message <task-id> <content>`

Send a message to a task.

```bash
task-factory task message <task-id> <content> [options]
```

**Options:**
- `--file <path>` - Read message from file (max 10000 chars)
- `--attachment <paths...>` - Attach files (max 10, max 10MB each)

**Examples:**
```bash
# Send simple message
task-factory task message task-abc123 "Please fix the bug"

# Send with attachments
task-factory task message task-abc123 "See attached files" --attachment screenshot.png log.txt
```

### `task-factory task steer <task-id> <instruction>`

Send steering instruction to a running task.

```bash
task-factory task steer <task-id> <instruction>
```

**Example:**
```bash
task-factory task steer task-abc123 "Focus on the database layer optimization"
```

### `task-factory task follow-up <task-id> <message>`

Queue a follow-up message for a task.

```bash
task-factory task follow-up <task-id> <message>
```

### `task-factory task plan regenerate <task-id>`

Regenerate the plan for a task.

```bash
task-factory task plan regenerate <task-id>
```

### `task-factory task criteria regenerate <task-id>`

Regenerate acceptance criteria for a task.

```bash
task-factory task criteria regenerate <task-id>
```

### `task-factory task criteria check <task-id> <index> <status>`

Update criterion status.

```bash
task-factory task criteria check <task-id> <index> <pass|fail|pending>
```

**Example:**
```bash
task-factory task criteria check task-abc123 0 pass
```

---

## Planning Commands

Manage planning sessions.

### `task-factory planning status <workspace-id>`

Get planning session status.

```bash
task-factory planning status <workspace-id>
```

### `task-factory planning messages <workspace-id>`

Get planning messages.

```bash
task-factory planning messages <workspace-id> [--limit <n>]
```

### `task-factory planning message <workspace-id> <content>`

Send message to planning session.

```bash
task-factory planning message <workspace-id> <content>
```

### `task-factory planning stop <workspace-id>`

Stop active planning session.

```bash
task-factory planning stop <workspace-id>
```

### `task-factory planning reset <workspace-id>`

Reset planning session.

```bash
task-factory planning reset <workspace-id> [--force]
```

**Options:**
- `--force` - Skip confirmation prompt

---

## Q&A Commands

Manage Q&A (Question & Answer) flow.

### `task-factory qa pending <workspace-id>`

Get pending Q&A request.

```bash
task-factory qa pending <workspace-id>
```

### `task-factory qa respond <workspace-id>`

Submit Q&A answers.

```bash
task-factory qa respond <workspace-id> --answers <answers>
```

**Options:**
- `-a, --answers <answers>` - Comma-separated answers (required)

### `task-factory qa abort <workspace-id>`

Abort Q&A request.

```bash
task-factory qa abort <workspace-id>
```

---

## Shelf Commands

Manage draft tasks in the shelf.

### `task-factory shelf show <workspace-id>`

Show shelf contents.

```bash
task-factory shelf show <workspace-id>
```

### `task-factory shelf push <workspace-id> <draft-id>`

Promote draft to task.

```bash
task-factory shelf push <workspace-id> <draft-id>
```

### `task-factory shelf push-all <workspace-id>`

Promote all drafts to tasks.

```bash
task-factory shelf push-all <workspace-id>
```

### `task-factory shelf update <workspace-id> <draft-id>`

Update draft content.

```bash
task-factory shelf update <workspace-id> <draft-id> --content <content>
```

### `task-factory shelf remove <workspace-id> <item-id>`

Remove shelf item.

```bash
task-factory shelf remove <workspace-id> <item-id> [--force]
```

### `task-factory shelf clear <workspace-id>`

Clear all shelf items.

```bash
task-factory shelf clear <workspace-id> [--force]
```

---

## Idea Commands

Manage idea backlog.

### `task-factory idea list <workspace-id>`

List ideas.

```bash
task-factory idea list <workspace-id>
```

### `task-factory idea add <workspace-id> <description>`

Add new idea.

```bash
task-factory idea add <workspace-id> <description>
```

### `task-factory idea update <workspace-id> <idea-id> <description>`

Update idea.

```bash
task-factory idea update <workspace-id> <idea-id> <description>
```

### `task-factory idea delete <workspace-id> <idea-id>`

Delete idea.

```bash
task-factory idea delete <workspace-id> <idea-id> [--force]
```

### `task-factory idea reorder <workspace-id>`

Reorder ideas.

```bash
task-factory idea reorder <workspace-id> --order <ids>
```

**Options:**
- `-o, --order <ids>` - Comma-separated idea IDs in new order (required)

---

## Attachment Commands

Manage file attachments.

### `task-factory attachment list <task-id>`

List task attachments.

```bash
task-factory attachment list <task-id>
```

### `task-factory attachment upload <task-id> <file-path>`

Upload attachment to task.

```bash
task-factory attachment upload <task-id> <file-path> [--files <paths...>]
```

**Options:**
- `--files <paths...>` - Upload multiple files

**Constraints:**
- Maximum file size: 10MB per file

### `task-factory attachment download <task-id> <attachment-id>`

Download attachment.

```bash
task-factory attachment download <task-id> <attachment-id> [-o <path>]
```

**Options:**
- `-o, --output <path>` - Output file path

### `task-factory attachment delete <task-id> <attachment-id>`

Delete attachment.

```bash
task-factory attachment delete <task-id> <attachment-id> [--force]
```

---

## Automation Commands

Manage workflow automation settings.

### `task-factory automation get <workspace-id>`

Get automation settings.

```bash
task-factory automation get <workspace-id>
```

### `task-factory automation set <workspace-id>`

Set automation settings.

```bash
task-factory automation set <workspace-id> [options]
```

**Options:**
- `--ready-limit <n>` - Ready queue limit (1-100)
- `--executing-limit <n>` - Executing limit (1-20)
- `--backlog-to-ready <bool>` - Enable backlog→ready (`true` or `false`)
- `--ready-to-executing <bool>` - Enable ready→executing (`true` or `false`)

**Examples:**
```bash
# Set ready queue limit
task-factory automation set ws-abc123 --ready-limit 10

# Enable all automation
task-factory automation set ws-abc123 --backlog-to-ready true --ready-to-executing true
```

### `task-factory automation enable <workspace-id>`

Enable all automation.

```bash
task-factory automation enable <workspace-id>
```

### `task-factory automation disable <workspace-id>`

Disable all automation.

```bash
task-factory automation disable <workspace-id>
```

---

## Settings Commands

Manage global settings.

### `task-factory settings get`

Get global settings.

```bash
task-factory settings get
```

### `task-factory settings set <key> <value>`

Set global setting.

```bash
task-factory settings set <key> <value>
```

### `task-factory settings pi`

Get Pi settings.

```bash
task-factory settings pi
```

---

## Model Commands

Manage AI models.

### `task-factory models list`

List available models grouped by provider.

```bash
task-factory models list
```

---

## Defaults Commands

Manage task defaults.

### `task-factory defaults get`

Get global task defaults.

```bash
task-factory defaults get
```

### `task-factory defaults set`

Set global task defaults.

```bash
task-factory defaults set [options]
```

**Options:**
- `--model <model>` - Default model
- `--pre-execution-skills <skills>` - Comma-separated skill IDs
- `--post-execution-skills <skills>` - Comma-separated skill IDs

### `task-factory defaults workspace-get <workspace-id>`

Get workspace task defaults.

```bash
task-factory defaults workspace-get <workspace-id>
```

### `task-factory defaults workspace-set <workspace-id>`

Set workspace task defaults.

```bash
task-factory defaults workspace-set <workspace-id> [options]
```

---

## Auth Commands

Manage authentication.

### `task-factory auth status`

Get auth status for all providers.

```bash
task-factory auth status
```

### `task-factory auth set-key <provider> <api-key>`

Set API key for provider.

```bash
task-factory auth set-key <provider> <api-key>
```

**Example:**
```bash
task-factory auth set-key anthropic sk-ant-api03-...
```

### `task-factory auth clear <provider>`

Clear provider credentials.

```bash
task-factory auth clear <provider>
```

---

## Skill Commands

Manage Pi skills.

### `task-factory skill list`

List Pi skills.

```bash
task-factory skill list
```

### `task-factory skill get <skill-id>`

Get skill details.

```bash
task-factory skill get <skill-id>
```

---

## Factory Skill Commands

Manage factory (post-execution) skills.

### `task-factory factory-skill list`

List factory skills.

```bash
task-factory factory-skill list
```

### `task-factory factory-skill reload`

Reload factory skills.

```bash
task-factory factory-skill reload
```

---

## Server Commands

These commands control the Task Factory server/daemon.

### `task-factory daemon start`

Start the Task Factory daemon.

```bash
task-factory daemon start [--port <port>] [--host <host>]
```

**Options:**
- `--port <port>` - Port to bind (default: 3000)
- `--host <host>` - Host to bind (default: 127.0.0.1)

### `task-factory daemon stop`

Stop the Task Factory daemon.

```bash
task-factory daemon stop
```

### `task-factory daemon restart`

Restart the Task Factory daemon.

```bash
task-factory daemon restart [--port <port>] [--host <host>]
```

### `task-factory daemon status`

Check daemon status.

```bash
task-factory daemon status
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `127.0.0.1` | Bind host (`0.0.0.0` exposes to network) |
| `DEBUG` | unset | Enables debug logging |
| `PI_FACTORY_SERVER_LOG_PATH` | `~/.taskfactory/logs/server.jsonl` | Structured server log file path |
| `WS_HEARTBEAT_INTERVAL_MS` | `30000` | WebSocket heartbeat interval |

---

## Examples

### Workflow Examples

```bash
# Create a task, start planning, and monitor
task-factory task create --workspace ws-abc123 --title "Implement feature"
task-factory planning status ws-abc123
task-factory planning message ws-abc123 "Focus on the API layer"

# Execute and monitor
task-factory task execute task-abc123
task-factory task conversation task-abc123 --follow

# Review and update criteria
task-factory task criteria check task-abc123 0 pass
task-factory task criteria check task-abc123 1 pass
```

### Automation Setup

```bash
# Configure automation for a workspace
task-factory automation set ws-abc123 --ready-limit 5 --executing-limit 2
task-factory automation enable ws-abc123

# Check status
task-factory automation get ws-abc123
```

### Working with Ideas

```bash
# Add ideas and reorder
task-factory idea add ws-abc123 "New dashboard feature"
task-factory idea add ws-abc123 "Performance optimization"
task-factory idea reorder ws-abc123 --order "idea-2,idea-1"

# Promote to tasks
task-factory shelf show ws-abc123
task-factory shelf push ws-abc123 draft-abc123
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Validation error |

---

## Related Documentation

- [Getting Started](./getting-started.md)
- [Workflow and Queue](./workflow-and-queue.md)
- [API Documentation](./api.md)
