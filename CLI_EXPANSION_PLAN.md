# Task Factory CLI Expansion Plan

## Overview
This document outlines a comprehensive plan to expand the `task-factory` CLI to achieve parity with UI functionality. The goal is that everything achievable through the web interface should also be possible via CLI commands.

## Implementation Progress

| Phase | Status | Tests | Coverage |
|-------|--------|-------|----------|
| Phase 1: Core Task Management | ✅ Complete | 22 | 100% |
| Phase 2: Activity & Messaging | ✅ Complete | 20 | 100% |
| Phase 3: Attachment Management | ✅ Complete | 8 | 100% |
| Phase 4: Planning Session Management | ✅ Complete | 14 | 100% |
| Phase 5: Shelf & Idea Backlog | ✅ Complete | 12 | 100% |
| Phase 6: Workspace Configuration | ✅ Complete | 8 | 100% |
| Phase 7: Pi/Agent Configuration | ✅ Complete | 18 | 100% |
| Phase 8: Workflow Automation | ✅ Complete | 6 | 100% |
| Phase 9: Extensions & Skills | ✅ Complete | 8 | 100% |
| Phase 10: Post-Execution Summary | ✅ Complete | 4 | 100% |
| Phase 11: Model Management | ✅ Complete | 3 | 100% |
| Phase 12: Utility & Advanced | ✅ Complete | 5 | 100% |

**ApiClient Implementation: ✅ COMPLETE**
- 82 unit tests passing
- All API methods implemented
- Error handling covered
- Network failure handling covered

**Command Handlers Implementation: ✅ COMPLETE**
- Task commands: list, show, update, conversation, activity, message, steer, follow-up
- Task plan: regenerate
- Task criteria: regenerate, check
- Planning: status, messages, message, stop, reset
- Q&A: pending, respond, abort
- Shelf: show, push, push-all, update, remove, clear
- Ideas: list, add, update, delete, reorder
- Attachments: list, upload, download, delete
- Automation: get, set, enable, disable
- Settings: get, set, pi-get, pi-models
- Defaults: get, set, workspace-get, workspace-set
- Auth: status, set-key, clear
- Skills: list, get
- Factory skills: list, reload

**CLI Integration: ✅ COMPLETE**
- All commands registered with Commander
- Options and aliases configured
- Help text available

**Build: ✅ COMPLETE**
- TypeScript compilation successful
- Output in `packages/cli/dist/`

**Package Structure:**
```
packages/cli/
├── src/
│   ├── api/
│   │   └── api-client.ts       # HTTP client with 82 tested methods
│   ├── commands/
│   │   ├── task.ts             # Task management commands
│   │   ├── planning.ts         # Planning session commands
│   │   ├── shelf.ts            # Shelf & ideas commands
│   │   ├── attachment.ts       # File attachment commands
│   │   ├── automation.ts       # Workflow automation commands
│   │   └── settings.ts         # Settings & auth commands
│   ├── utils/
│   │   └── format.ts           # Output formatting utilities
│   ├── types/
│   │   └── index.ts            # TypeScript type definitions
│   ├── cli.ts                  # Main CLI entry point
│   └── index.ts                # Public API exports
├── tests/
│   └── api-client.test.ts      # 82 unit tests (all passing)
├── dist/                       # Compiled output
└── package.json
```

**Commands Implemented:**
| Category | Commands | Count |
|----------|----------|-------|
| Task | update, plan regenerate, criteria regenerate/check, conversation, activity, message, steer, follow-up | 11 |
| Planning | status, messages, message, stop, reset | 5 |
| Q&A | pending, respond, abort | 3 |
| Shelf | show, push, push-all, update, remove, clear | 6 |
| Ideas | list, add, update, delete, reorder | 5 |
| Attachments | list, upload, download, delete | 4 |
| Automation | get, set, enable, disable | 4 |
| Settings | get, set, pi-get, pi-models | 4 |
| Defaults | get, set, workspace-get, workspace-set | 4 |
| Auth | status, set-key, clear | 3 |
| Skills | list, get | 2 |
| Factory Skills | list, reload | 2 |
| **TOTAL** | | **53 commands** |

**Implementation Complete! ✅**

**Legend:**
- ⏳ Pending: Not started
- 🚧 In Progress: Currently implementing
- ✅ Complete: Implemented with tests passing
- 🔄 Refactoring: Code complete, optimizing

**Overall Coverage Target:** 90%+

---

---

## Current CLI State

### Existing Commands
| Category | Commands | Status |
|----------|----------|--------|
| **Daemon** | `start`, `stop`, `restart`, `status` | ✅ Implemented |
| **Workspaces** | `list`, `create`, `delete`, `show`, `export`, `import` | ✅ Implemented |
| **Tasks** | `list`, `create`, `show`, `move`, `delete`, `execute`, `stop`, `export`, `import` | ✅ Implemented |
| **Queue** | `status`, `start`, `stop` | ✅ Implemented |
| **Logs** | `logs` (with `--follow`, `--lines`) | ✅ Implemented |
| **Config** | `get`, `set`, `list` | ✅ Implemented |

---

## Phase 1: Core Task Management Enhancements

### 1.1 Task Update Operations
**Priority: HIGH** - Essential for task management

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task update <task-id>` | Update task fields interactively | `PATCH /api/workspaces/:id/tasks/:taskId` |
| `task update <task-id> --title "New Title"` | Update title directly | `PATCH ...` |
| `task update <task-id> --content "Description"` | Update content | `PATCH ...` |
| `task update <task-id> --acceptance-criteria "criteria1,criteria2"` | Update acceptance criteria | `PATCH ...` |
| `task update <task-id> --file task.md` | Update from markdown file | `PATCH ...` |

**Options to support:**
- `--title`, `--content`, `-c`
- `--acceptance-criteria`, `-a` (array or comma-separated)
- `--pre-execution-skills` (array)
- `--post-execution-skills` (array)
- `--file` (read from markdown file)

### 1.2 Task Reordering
**Priority: MEDIUM** - Important for backlog grooming

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task reorder <workspace-id> --phase <phase>` | Interactive reorder via TUI | `POST /api/workspaces/:id/tasks/reorder` |
| `task reorder <workspace-id> --phase <phase> --tasks id1,id2,id3` | Direct reorder | `POST ...` |

### 1.3 Task Plan Management
**Priority: HIGH** - Core planning feature

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task plan regenerate <task-id>` | Regenerate plan for task | `POST /api/workspaces/:id/tasks/:taskId/plan/regenerate` |
| `task plan show <task-id>` | Display task plan | `GET /api/workspaces/:id/tasks/:taskId` |
| `task plan skip <task-id>` | Skip planning (create without plan) | (via create --skip-planning) |

### 1.4 Acceptance Criteria Management
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task criteria regenerate <task-id>` | Regenerate acceptance criteria | `POST /api/workspaces/:id/tasks/:taskId/acceptance-criteria/regenerate` |
| `task criteria list <task-id>` | List acceptance criteria | `GET /api/workspaces/:id/tasks/:taskId` |
| `task criteria check <task-id> --index <n> --status pass|fail|pending` | Update criterion status | `PATCH /api/workspaces/:id/tasks/:taskId/summary/criteria/:index` |

---

## Phase 2: Activity & Messaging

### 2.1 Activity Log Commands
**Priority: HIGH** - Essential for seeing task history

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `activity list --workspace <id>` | List workspace activity | `GET /api/workspaces/:id/activity` |
| `activity list --task <task-id>` | List task activity | `GET /api/workspaces/:id/tasks/:taskId/activity` |
| `activity list --limit 50` | Limit number of entries | Query param |
| `activity show <entry-id>` | Show single activity entry | From list response |

### 2.2 Messaging Commands
**Priority: HIGH** - Required for chat interaction

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `message send <task-id> "Message content"` | Send message to task | `POST /api/workspaces/:id/activity` |
| `message send <task-id> --file message.md` | Send message from file | `POST ...` |
| `message send <task-id> --attachment <path>` | Send with attachment | `POST ...` + upload |
| `task steer <task-id> "Instruction"` | Send steering message | `POST /api/workspaces/:id/tasks/:taskId/steer` |
| `task follow-up <task-id> "Message"` | Queue follow-up message | `POST /api/workspaces/:id/tasks/:taskId/follow-up` |

### 2.3 Conversation Viewing ⭐ NEW
**Priority: HIGH** - View chat history and agent conversations

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task conversation <task-id>` | Show full conversation history | `GET /api/workspaces/:id/tasks/:taskId/activity` |
| `task chat <task-id>` | Alias for `task conversation` | `GET ...` |
| `task conversation <task-id> --limit 20` | Show last N messages | Query param |
| `task conversation <task-id> --since "2h ago"` | Show messages since time | Filter client-side |
| `task conversation <task-id> --follow` | Real-time updates (like `tail -f`) | WebSocket/polling |
| `task conversation <task-id> --export chat.md` | Export to markdown file | Client-side export |
| `task conversation <task-id> --json` | Output as JSON | Format option |
| `task conversation <task-id> --only agent` | Filter by role (user/agent) | Client-side filter |
| `task conversation <task-id> --search "keyword"` | Search in messages | Client-side filter |

**Output Format Options:**

1. **Pretty format (default)** - Chat-like view:
   ```
   📋 Task: Implement user authentication
   
   🧑 User (2:34 PM)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Let's add JWT-based authentication to the API
   
   🤖 Agent (2:35 PM)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   I'll help you implement JWT authentication. Let me start by examining the current codebase structure.
   
   [Examining codebase...]
   
   I found the Express server setup. Now I'll add the authentication middleware...
   ```

2. **Compact format** (`--compact`):
   ```
   [2:34 PM] user: Let's add JWT-based authentication...
   [2:35 PM] agent: I'll help you implement JWT...
   [2:36 PM] agent: ✅ Created auth/middleware.ts
   ```

3. **Markdown format** (`--markdown`):
   ```markdown
   # Conversation: Implement user authentication
   
   ## User (2024-01-15 14:34)
   Let's add JWT-based authentication to the API
   
   ## Agent (2024-01-15 14:35)
   I'll help you implement JWT authentication...
   ```

**Key Features:**
- Color-coded by role (user=blue, agent=green, system=gray)
- Timestamps relative ("2 minutes ago") or absolute
- Show attachment references inline
- Indicate message type (steer, follow-up, normal)
- Pagination for long conversations
- Handle markdown rendering in terminal (basic)

---

## Phase 3: Attachment Management

### 3.1 Task Attachments
**Priority: MEDIUM** - Important for file-based workflows

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `attachment list <task-id>` | List task attachments | `GET /api/workspaces/:id/tasks/:taskId/attachments` |
| `attachment upload <task-id> <file-path>` | Upload attachment | `POST /api/workspaces/:id/tasks/:taskId/attachments` |
| `attachment upload <task-id> --files file1,file2,file3` | Upload multiple | `POST ...` (multipart) |
| `attachment download <task-id> <attachment-id>` | Download attachment | `GET /api/workspaces/:id/tasks/:taskId/attachments/:name` |
| `attachment delete <task-id> <attachment-id>` | Delete attachment | `DELETE /api/workspaces/:id/tasks/:taskId/attachments/:id` |

### 3.2 Planning Attachments
**Priority: LOW** - Nice to have

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `attachment list-planning <workspace-id>` | List planning attachments | `GET /api/workspaces/:id/planning/attachments` |
| `attachment upload-planning <workspace-id> <file>` | Upload planning attachment | `POST /api/workspaces/:id/planning/attachments` |

---

## Phase 4: Planning Session Management

### 4.1 Planning Control
**Priority: HIGH** - Core planning workflow

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `planning status <workspace-id>` | Get planning status | `GET /api/workspaces/:id/planning/status` |
| `planning messages <workspace-id>` | Get planning messages | `GET /api/workspaces/:id/planning/messages` |
| `planning message <workspace-id> "Message"` | Send planning message | `POST /api/workspaces/:id/planning/message` |
| `planning stop <workspace-id>` | Stop active planning | `POST /api/workspaces/:id/planning/stop` |
| `planning reset <workspace-id>` | Reset planning session | `POST /api/workspaces/:id/planning/reset` |

### 4.2 Q&A (Question/Answer) Flow
**Priority: MEDIUM** - Required for interactive planning

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `qa pending <workspace-id>` | Get pending Q&A request | `GET /api/workspaces/:id/qa/pending` |
| `qa respond <workspace-id> --answers "answer1,answer2"` | Submit Q&A answers | `POST /api/workspaces/:id/qa/respond` |
| `qa abort <workspace-id>` | Abort Q&A request | `POST /api/workspaces/:id/qa/abort` |

---

## Phase 5: Shelf & Idea Backlog

### 5.1 Shelf Commands (Draft Tasks)
**Priority: MEDIUM** - Important for task ideation

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `shelf show <workspace-id>` | Show shelf contents | `GET /api/workspaces/:id/shelf` |
| `shelf push <workspace-id> <draft-id>` | Promote draft to task | `POST /api/workspaces/:id/shelf/drafts/:draftId/push` |
| `shelf push-all <workspace-id>` | Promote all drafts | `POST /api/workspaces/:id/shelf/push-all` |
| `shelf update <workspace-id> <draft-id> --content "New content"` | Update draft | `PATCH /api/workspaces/:id/shelf/drafts/:draftId` |
| `shelf remove <workspace-id> <item-id>` | Remove shelf item | `DELETE /api/workspaces/:id/shelf/items/:itemId` |
| `shelf clear <workspace-id>` | Clear all shelf items | `DELETE /api/workspaces/:id/shelf` |

### 5.2 Idea Backlog Commands
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `idea list <workspace-id>` | List ideas | `GET /api/workspaces/:id/idea-backlog` |
| `idea add <workspace-id> "Idea description"` | Add new idea | `POST /api/workspaces/:id/idea-backlog/items` |
| `idea update <workspace-id> <idea-id> "New description"` | Update idea | `PATCH /api/workspaces/:id/idea-backlog/items/:ideaId` |
| `idea delete <workspace-id> <idea-id>` | Delete idea | `DELETE /api/workspaces/:id/idea-backlog/items/:ideaId` |
| `idea reorder <workspace-id> --order id1,id2,id3` | Reorder ideas | `POST /api/workspaces/:id/idea-backlog/reorder` |

---

## Phase 6: Workspace Configuration & Settings

### 6.1 Workspace Config Management
**Priority: HIGH** - Essential for workspace setup

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `workspace config get <workspace-id>` | Get workspace config | `GET /api/workspaces/:id` |
| `workspace config set <workspace-id> --key value` | Set config value | `PATCH /api/workspaces/:id/config` |
| `workspace open <workspace-id>` | Open workspace in file explorer | `POST /api/workspaces/:id/archive/open-in-explorer` |
| `workspace attention` | Show attention summary across workspaces | `GET /api/workspaces/attention` |

### 6.2 Workspace Storage Migration
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `workspace migration status <workspace-id>` | Check migration status | `GET /api/workspaces/:id/local-storage-migration/status` |
| `workspace migration move <workspace-id>` | Move local storage to global | `POST /api/workspaces/:id/local-storage-migration/move` |
| `workspace migration leave <workspace-id>` | Leave storage as-is | `POST /api/workspaces/:id/local-storage-migration/leave` |
| `workspace artifact-dir <workspace-id> --path /path/to/dir` | Set artifact directory | `PATCH /api/workspaces/:id/artifact-dir` |

### 6.3 Shared Context
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `workspace context get <workspace-id>` | Get shared context | `GET /api/workspaces/:id/shared-context` |
| `workspace context set <workspace-id> --file context.md` | Set shared context from file | `PUT /api/workspaces/:id/shared-context` |
| `workspace context edit <workspace-id>` | Edit context in $EDITOR | `PUT ...` |

---

## Phase 7: Pi/Agent Configuration

### 7.1 Settings Management
**Priority: HIGH** - Required for agent configuration

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `settings get` | Get global settings | `GET /api/settings` |
| `settings set --key value` | Set global setting | `POST /api/settings` |
| `settings pi get` | Get Pi settings | `GET /api/pi/settings` |
| `settings pi models` | Get Pi models config | `GET /api/pi/models` |
| `settings agents-md` | Get AGENTS.md content | `GET /api/pi/agents-md` |

### 7.2 Task Defaults
**Priority: HIGH**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `defaults get` | Get global task defaults | `GET /api/task-defaults` |
| `defaults set --model <model>` | Set default model | `POST /api/task-defaults` |
| `defaults set --pre-execution-skills skill1,skill2` | Set default skills | `POST ...` |
| `defaults workspace <workspace-id> get` | Get workspace defaults | `GET /api/workspaces/:id/task-defaults` |
| `defaults workspace <workspace-id> set --model <model>` | Set workspace defaults | `POST /api/workspaces/:id/task-defaults` |

### 7.3 Auth Management
**Priority: MEDIUM** - Needed for provider setup

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `auth status` | Get auth overview | `GET /api/pi/auth` |
| `auth set-key <provider> <api-key>` | Set API key | `PUT /api/pi/auth/providers/:provider/api-key` |
| `auth clear <provider>` | Clear credential | `DELETE /api/pi/auth/providers/:provider` |

### 7.4 OAuth Login Flow
**Priority: MEDIUM** (CLI may need browser integration)

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `auth oauth start <provider>` | Start OAuth flow | `POST /api/pi/auth/login/start` |
| `auth oauth status <session-id>` | Check login status | `GET /api/pi/auth/login/:sessionId` |
| `auth oauth input <session-id> <request-id> <value>` | Submit input | `POST .../input` |
| `auth oauth cancel <session-id>` | Cancel login | `POST .../cancel` |

### 7.5 Pi Migration
**Priority: LOW** (One-time operation)

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `pi-migration status` | Get migration status | `GET /api/pi-migration/status` |
| `pi-migration run --auth --skills --extensions` | Run migration | `POST /api/pi-migration/migrate` |
| `pi-migration skip` | Skip migration | `POST /api/pi-migration/skip` |

---

## Phase 8: Workflow Automation

### 8.1 Automation Settings
**Priority: HIGH** - Core queue functionality

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `automation get <workspace-id>` | Get automation settings | `GET /api/workspaces/:id/automation` |
| `automation set <workspace-id> --ready-limit 5` | Set ready queue limit | `PATCH /api/workspaces/:id/automation` |
| `automation set <workspace-id> --executing-limit 3` | Set executing limit | `PATCH ...` |
| `automation set <workspace-id> --backlog-to-ready true` | Enable backlog→ready | `PATCH ...` |
| `automation set <workspace-id> --ready-to-executing true` | Enable ready→executing | `PATCH ...` |
| `automation enable <workspace-id>` | Enable all automation | `PATCH ...` |
| `automation disable <workspace-id>` | Disable all automation | `PATCH ...` |

---

## Phase 9: Extensions & Skills

### 9.1 Extension Management
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `extension list` | List global extensions | `GET /api/pi/extensions` |
| `extension list --factory` | List factory extensions | `GET /api/factory/extensions` |
| `extension reload` | Reload factory extensions | `POST /api/factory/extensions/reload` |
| `extension get-enabled <workspace-id>` | Get enabled extensions for workspace | `GET /api/workspaces/:id/extensions` |

### 9.2 Skill Management (Agent Skills)
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `skill list` | List Pi skills | `GET /api/pi/skills` |
| `skill get <skill-id>` | Get skill details | `GET /api/pi/skills/:skillId` |
| `skill discovered <workspace-id>` | List discovered skills | `GET /api/workspaces/:id/skills/discovered` |
| `skill enabled <workspace-id>` | Get enabled skills | `GET /api/workspaces/:id/skills` |

### 9.3 Post-Execution Skills (Factory Skills)
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `factory-skill list` | List post-execution skills | `GET /api/factory/skills` |
| `factory-skill get <skill-id>` | Get skill details | `GET /api/factory/skills/:id` |
| `factory-skill create --file skill.json` | Create skill | `POST /api/factory/skills` |
| `factory-skill update <skill-id> --file skill.json` | Update skill | `PUT /api/factory/skills/:id` |
| `factory-skill delete <skill-id>` | Delete skill | `DELETE /api/factory/skills/:id` |
| `factory-skill import --file SKILL.md` | Import from SKILL.md | `POST /api/factory/skills/import` |
| `factory-skill reload` | Reload skills | `POST /api/factory/skills/reload` |

---

## Phase 10: Post-Execution Summary

### 10.1 Summary Management
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `summary show <task-id>` | Get post-execution summary | `GET /api/workspaces/:id/tasks/:taskId/summary` |
| `summary generate <task-id>` | Generate summary | `POST /api/workspaces/:id/tasks/:taskId/summary/generate` |
| `summary regenerate <task-id>` | Regenerate summary | `POST /api/workspaces/:id/tasks/:taskId/summary/regenerate` |
| `summary update <task-id> --field value` | Update summary fields | `PATCH ...` |
| `summary criteria <task-id>` | List criteria validation | From summary endpoint |
| `summary artifacts <task-id>` | List generated artifacts | From summary endpoint |

---

## Phase 11: Model Management

### 11.1 Model Operations
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `model list` | List available models | `GET /api/pi/available-models` |
| `model profiles get` | Get model profiles | From settings |
| `model profiles set --file profiles.json` | Set model profiles | `POST /api/settings` |
| `model foreman get <workspace-id>` | Get foreman model | `GET /api/workspaces/:id/foreman-model` |
| `model foreman set <workspace-id> --provider <p> --model <m>` | Set foreman model | `PUT /api/workspaces/:id/foreman-model` |

---

## Phase 12: Utility & Advanced Commands

### 12.1 Task Form Bridge (for external editors)
**Priority: LOW** - Niche use case

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task-form open <workspace-id>` | Open task form bridge | `POST /api/workspaces/:id/task-form/open` |
| `task-form sync <workspace-id>` | Sync form updates | `PATCH /api/workspaces/:id/task-form` |
| `task-form close <workspace-id>` | Close task form bridge | `POST /api/workspaces/:id/task-form/close` |

### 12.2 Workspace Pi Config
**Priority: MEDIUM**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `workspace pi-config get <workspace-id>` | Get Pi config | `GET /api/workspaces/:id/pi-config` |
| `workspace pi-config set <workspace-id> --file config.json` | Set Pi config | `POST /api/workspaces/:id/pi-config` |

### 12.3 Agent Context
**Priority: LOW**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `context get --workspace <id>` | Get agent context | `GET /api/pi/context?workspace=<id>` |
| `context get --workspace <id> --skills skill1,skill2` | Get context with skills | `GET ...` |

### 12.4 Archived Tasks
**Priority: LOW**

| Command | Description | API Endpoint |
|---------|-------------|--------------|
| `task archived count <workspace-id>` | Get archived count | `GET /api/workspaces/:id/tasks/archived/count` |
| `task archived list <workspace-id>` | List archived tasks | `GET /api/workspaces/:id/tasks?scope=archived` |

---

## Implementation Priority Summary

### Tier 1: Critical (MVP)
Must-have for CLI parity with core workflows:

1. `task update` - Update task fields
2. `task plan regenerate` - Regenerate plans
3. `activity list` - View activity logs
4. **`task conversation`** - ⭐ View chat history and agent conversations
5. `message send` / `task steer` / `task follow-up` - Chat interaction
6. `planning *` - Planning session control
7. `qa *` - Q&A flow
8. `settings get/set` - Global settings
9. `defaults *` - Task defaults
10. `automation *` - Workflow automation

### Tier 2: Important
High-value features for power users:

10. `attachment *` - File management
11. `shelf *` - Draft task management
12. `idea *` - Idea backlog
13. `workspace context *` - Shared context
14. `auth *` - Authentication management
15. `task criteria *` - Acceptance criteria

### Tier 3: Nice to Have
Advanced/edge case features:

16. `extension *` - Extension management
17. `skill *` / `factory-skill *` - Skill management
18. `summary *` - Post-execution summaries
19. `workspace migration *` - Storage migration
20. `pi-migration *` - Legacy migration

### Tier 4: Future Considerations
21. `task-form *` - External editor bridge
22. Interactive TUI for reordering
23. Real-time log streaming improvements

---

## Technical Implementation Notes

### API Client Expansion
The `ApiClient` class needs methods for all new endpoints:

```typescript
// Task updates
updateTaskFields(workspaceId, taskId, fields)

// Planning
getPlanningStatus(workspaceId)
getPlanningMessages(workspaceId)
sendPlanningMessage(workspaceId, content)
stopPlanning(workspaceId)
resetPlanning(workspaceId)

// Q&A
getPendingQA(workspaceId)
respondToQA(workspaceId, answers)
abortQA(workspaceId)

// Activity & Conversations
getWorkspaceActivity(workspaceId, limit)
getTaskActivity(workspaceId, taskId, limit)
sendMessage(workspaceId, taskId, content, role)
getTaskConversation(workspaceId, taskId, limit)  // Filtered to chat messages only

// Attachments
listAttachments(workspaceId, taskId)
uploadAttachment(workspaceId, taskId, filePath)
downloadAttachment(workspaceId, taskId, attachmentId, outputPath)
deleteAttachment(workspaceId, taskId, attachmentId)

// Shelf
getShelf(workspaceId)
pushDraftToTask(workspaceId, draftId)
updateDraft(workspaceId, draftId, content)
removeShelfItem(workspaceId, itemId)
clearShelf(workspaceId)

// And many more...
```

### File Handling
- File uploads should support multipart/form-data
- Downloads need progress indicators for large files
- Support for both single and batch operations

### Interactive Features
- Use `@clack/prompts` for interactive flows
- Support `--json` flag for scripting
- Support `--yes` / `-y` for non-interactive mode

### Error Handling
- Consistent error formatting
- Suggest fixes for common errors
- Exit codes for scripting (0 = success, 1 = error, 2 = validation error)

---

## Command Naming Conventions

### Pattern
```
task-factory <noun> <verb> [args] [options]
```

Examples:
- `task-factory task create` (noun=task, verb=create)
- `task-factory planning status` (noun=planning, verb=status)
- `task-factory attachment upload` (noun=attachment, verb=upload)

### Aliases
Keep aliases for common commands:
- `tf` alias for `task-factory`
- `workspace` / `workspaces` (both work)
- `task` / `tasks` (both work)
- `exec` for `execute`

---

## Future Ideas

1. **Watch Mode**: `task-factory watch --workspace <id>` - Real-time updates via WebSocket
2. **Shell Completion**: Auto-completion scripts for bash/zsh/fish
3. **Pipeline Integration**: `task-factory pipeline` - CI/CD integration helpers
4. **Bulk Operations**: `task-factory bulk` - CSV/JSON import/export for batch operations
5. **Notifications**: Desktop notifications for task completion
6. **History**: `task-factory history` - Command history across sessions

---

## Appendix A: Sample Implementation - Conversation Command

This shows what the `task conversation` command implementation might look like:

```typescript
// API Client method
async getTaskConversation(workspaceId: string, taskId: string, limit = 100): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/tasks/${taskId}/activity?limit=${limit}`)
  if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`)
  const entries = await res.json()
  // Filter to chat messages and system events relevant to conversation
  return entries.filter((e: ActivityEntry) => 
    e.type === 'chat-message' || 
    e.type === 'system-event' ||
    e.type === 'task-separator'
  )
}

// CLI Command Handler
async function taskConversation(taskId: string, options: {
  limit?: number
  since?: string
  follow?: boolean
  export?: string
  json?: boolean
  compact?: boolean
  only?: 'user' | 'agent' | 'all'
  search?: string
}) {
  const client = new ApiClient()
  
  // Find task across workspaces (same pattern as existing commands)
  const workspaces = await client.listWorkspaces()
  let workspaceId: string | null = null
  let foundTask = null
  
  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all')
      const task = tasks.find(t => t.id === taskId || t.id.startsWith(taskId))
      if (task) {
        workspaceId = ws.id
        foundTask = task
        break
      }
    } catch { /* continue */ }
  }
  
  if (!foundTask || !workspaceId) {
    console.error(chalk.red(`Task not found: ${taskId}`))
    process.exit(1)
  }
  
  // Fetch conversation
  const entries = await client.getTaskConversation(workspaceId, foundTask.id, options.limit)
  
  // Filter by role if specified
  let filtered = entries
  if (options.only && options.only !== 'all') {
    filtered = entries.filter(e => 
      e.type === 'chat-message' && e.role === options.only
    )
  }
  
  // Filter by search term
  if (options.search) {
    const searchLower = options.search.toLowerCase()
    filtered = filtered.filter(e => 
      e.content?.toLowerCase().includes(searchLower)
    )
  }
  
  // Filter by time if specified
  if (options.since) {
    const sinceDate = new Date(Date.now() - parseDuration(options.since))
    filtered = filtered.filter(e => new Date(e.timestamp) >= sinceDate)
  }
  
  // Output formats
  if (options.json) {
    console.log(JSON.stringify(filtered, null, 2))
    return
  }
  
  if (options.export) {
    const markdown = formatConversationAsMarkdown(foundTask, filtered)
    writeFileSync(options.export, markdown)
    console.log(chalk.green(`✓ Exported conversation to ${options.export}`))
    return
  }
  
  // Pretty print conversation
  console.log(chalk.bold(`\n📋 Task: ${foundTask.frontmatter.title}\n`))
  
  if (filtered.length === 0) {
    console.log(chalk.gray('No messages in conversation.'))
    return
  }
  
  for (const entry of filtered) {
    printConversationEntry(entry, options.compact)
  }
}

function printConversationEntry(entry: ActivityEntry, compact = false) {
  const time = formatRelativeTime(entry.timestamp)
  
  if (entry.type === 'chat-message') {
    const isUser = entry.role === 'user'
    const icon = isUser ? '🧑' : '🤖'
    const name = isUser ? 'User' : 'Agent'
    const color = isUser ? chalk.blue : chalk.green
    
    if (compact) {
      console.log(`[${time}] ${name.toLowerCase()}: ${entry.content.slice(0, 80)}${entry.content.length > 80 ? '...' : ''}`)
    } else {
      console.log(`${color.bold(`${icon} ${name} (${time})`)}`)
      console.log(chalk.gray('━'.repeat(50)))
      console.log(entry.content)
      console.log()
    }
  } else if (entry.type === 'system-event') {
    if (!compact) {
      console.log(chalk.gray(`⚙️  System: ${entry.content}`))
      console.log()
    }
  }
}

function formatConversationAsMarkdown(task: Task, entries: ActivityEntry[]): string {
  let md = `# Conversation: ${task.frontmatter.title}\n\n`
  md += `**Task ID:** ${task.id}\n`
  md += `**Exported:** ${new Date().toISOString()}\n\n`
  md += `---\n\n`
  
  for (const entry of entries) {
    if (entry.type === 'chat-message') {
      const role = entry.role === 'user' ? 'User' : 'Agent'
      md += `## ${role} (${entry.timestamp})\n\n`
      md += `${entry.content}\n\n`
    } else if (entry.type === 'system-event') {
      md += `*${entry.content}*\n\n`
    }
  }
  
  return md
}
```

**CLI Registration:**
```typescript
taskCmd
  .command('conversation <task-id>')
  .alias('chat')
  .description('View conversation history for a task')
  .option('-l, --limit <n>', 'Number of messages', parseInt, 50)
  .option('-s, --since <duration>', 'Show messages since (e.g., "2h", "1d")')
  .option('-f, --follow', 'Follow new messages in real-time')
  .option('-e, --export <file>', 'Export to markdown file')
  .option('--json', 'Output as JSON')
  .option('--compact', 'Compact output format')
  .option('--only <role>', 'Filter by role (user/agent)')
  .option('--search <keyword>', 'Search in message content')
  .action(taskConversation)
```

---

## Appendix B: Activity Entry Types Reference

When viewing conversations/activity, entries can have these types:

| Type | Description | Display |
|------|-------------|---------|
| `chat-message` | User or agent message | Primary content |
| `system-event` | System notifications | Gray/subdued |
| `task-separator` | Task boundary marker | Header style |
| `attachment` | File attachment | With download link |
| `phase-change` | Task moved between phases | System notification |

**Chat Message Roles:**
- `user` - Human user messages
- `agent` - AI agent responses

**Metadata fields to display:**
- `attachmentIds` - References to uploaded files
- `signal`/`outcome` - Execution reliability telemetry
- `fromPhase`/`toPhase` - For phase changes
