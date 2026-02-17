# Task Factory: Agent Work Queue System

## Vision

Task Factory is a **lean manufacturing-inspired** task queue system for AI agents. It applies Toyota Production System (TPS) principles to software development workflows, creating a continuous flow of work where agents pull tasks, execute them, and move them to completion with minimal waste and maximum visibility.

The system has two modes of operation:

1. **Planning Mode** — A conversational agent helps the user research, decompose, and stage work before it hits the production line.
2. **Task Mode** — Focused task agents execute well-defined work items through a kanban pipeline.

## Core Philosophy: TPS Principles Applied to Agent Work

### 1. **Just-In-Time (JIT) Production**
- Agents pull work only when they have capacity
- No overproduction of planned tasks
- Tasks flow through the system as needed

### 2. **Kanban (Visual Signaling)**
- Pipeline bar showing work in progress across all phases
- WIP limits to prevent overload
- Cards represent units of work moving through stages

### 3. **Jidoka (Autonomation / Stop and Fix)**
- Tasks that fail acceptance criteria stop the line
- Quality built into the process, not inspected at the end
- Clear escalation paths for blocked work

### 4. **Kaizen (Continuous Improvement)**
- Metrics on cycle time, throughput, blockers
- Retrospective data for process improvement
- Template evolution based on what works

### 5. **Heijunka (Level Loading)**
- Balance task types and complexity
- Prevent batching of similar work
- Smooth flow through the system

## UI Architecture

### Layout: Two Modes, One Interface

The UI has three permanent regions:

- **Left pane** — Always a chat interface. The agent you're talking to depends on the mode.
- **Right pane** — Contextual output. What's shown depends on the mode.
- **Pipeline bar** — Always visible at the bottom. Shows all tasks flowing through phases. Acts as the mode switch.

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER                                                       │
├──────────────────────────┬───────────────────────────────────┤
│                          │                                   │
│  CHAT                    │  CONTEXTUAL OUTPUT                │
│  (left pane)             │  (right pane)                     │
│                          │                                   │
│                          │                                   │
│                          │                                   │
│  [input...]              │                                   │
├──────────────────────────┴───────────────────────────────────┤
│ PIPELINE BAR                                                 │
│ [backlog] [planning] [ready] [executing] [complete]          │
└──────────────────────────────────────────────────────────────┘
```

### Planning Mode (no task selected)

The default state. The user converses with a **planning agent** that has broad context — it knows about all tasks, projects, and can do research, decompose goals, and create work items.

```
PLANNING MODE
┌───────────────────────┬──────────────────────────────┐
│                       │                              │
│  CHAT                 │  WORKSPACE / SHELF           │
│  "Task Factory Agent" │                              │
│                       │  ┌────────────────────────┐  │
│  You: I want to add   │  │ Draft Task 1     [edit]│  │
│  OAuth to the app     │  │ Set up OAuth provider  │  │
│                       │  └────────────────────────┘  │
│  Agent: I'd break     │  ┌────────────────────────┐  │
│  that into 3 tasks... │  │ Draft Task 2     [edit]│  │
│                       │  │ Login/callback routes   │  │
│                       │  └────────────────────────┘  │
│                       │  ┌────────────────────────┐  │
│                       │  │ Artifact: Research  [▸]│  │
│                       │  │ OAuth comparison table  │  │
│                       │  └────────────────────────┘  │
│                       │                              │
│                       │  [Send all to backlog →]     │
│  [Ask anything...]    │                              │
└───────────────────────┴──────────────────────────────┘
```

**Left pane (Chat):**
- Conversational interface with the planning agent
- Agent can research, answer questions, help decompose work
- Agent creates draft tasks and artifacts as side effects of conversation

**Right pane (Workspace / Shelf):**
- **Draft tasks** — Proposed task cards staged before hitting the backlog. User can review, edit, reorder, remove. Push to backlog individually or in batch.
- **Artifacts** — Rendered HTML outputs from the agent (research summaries, architecture diagrams, comparison tables, mockups, interactive prototypes). Displayed in a sandboxed iframe when focused.
- Items listed in creation order. Click to expand/focus an artifact or edit a draft task.

The shelf is a staging area — the agent proposes, the user reviews and approves before work enters the production line.

### Task Mode (task selected from pipeline bar)

Clicking a task in the pipeline bar switches to task mode. The chat swaps to that task's agent conversation and the right pane shows task details.

```
TASK MODE
┌───────────────────────┬──────────────────────────────┐
│                       │                              │
│  CHAT                 │  TASK DETAIL                 │
│  "TASK-042"           │                              │
│  ← Back to general    │  Phase: executing            │
│                       │  AC: ☐ ☐ ☐                   │
│  Agent: Installing    │  Quality: 🟡 🔴              │
│  dependencies...      │  Branch: feat/TASK-042       │
│                       │                              │
│  You: Use flexbox     │                              │
│  for the layout       │                              │
│                       │                              │
│  Agent: Updated,      │                              │
│  pushing now...       │                              │
│                       │                              │
│  [Steer TASK-042...]  │                              │
└───────────────────────┴──────────────────────────────┘
```

**Left pane (Chat):**
- Shows the task agent's conversation history (execution log)
- User can steer/follow-up with the task agent
- Clear header showing task ID and title
- "Back to general" button to return to planning mode

**Right pane (Task Detail):**
- Task metadata: phase, priority, type, timestamps
- Acceptance criteria with check states
- Branch, PR link, commits
- Blocker status
- Phase transition controls

### Mode Switching

- **Pipeline bar** is the mode switch. Deselect all tasks → planning mode. Click a task → task mode.
- **Conversation histories are independent.** Switching back to planning mode shows the planning conversation where you left off. Switching to a task shows that task's log.
- **Visual differentiation:**
  - Header context bar: "Task Factory Agent" vs "TASK-042: Implement auth"
  - Input placeholder: "Ask anything..." vs "Steer TASK-042..."
  - Subtle background tint difference between modes

### Planning Agent vs Task Agent

These are fundamentally different agents with different scopes:

| | Planning Agent | Task Agent |
|---|---|---|
| **Scope** | Broad — all tasks, projects, research | Narrow — one task, one workspace |
| **Purpose** | Decompose, research, plan, create tasks | Execute a specific task |
| **Capabilities** | Web research, task creation, artifact generation, status overview | Code generation, file editing, testing, git operations |
| **Context** | All tasks, project history, user goals | Task AC, workspace files, task-specific instructions |
| **Output** | Draft tasks, HTML artifacts, answers | Code changes, commits, PRs |
| **Behavior** | Conversational, collaborative | Autonomous worker, steerable |

## Task Lifecycle (The Flow)

```
                    ┌─────────────────────────────────────────┐
                    │         PLANNING MODE (shelf)           │
                    │  Draft tasks staged by planning agent   │
                    └────────────────┬────────────────────────┘
                                     │ User approves
                                     ▼
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ BACKLOG │───→│ PLANNING │───→│  READY    │───→│ EXECUTING│───→│ COMPLETE │───→│ ARCHIVED │
│         │    │          │    │           │    │          │    │          │    │          │
│ Ideas   │    │ Define   │    │ Approved  │    │ Agent    │    │ Done     │    │ History  │
│ Incoming│    │ AC, Plan │    │ Queued    │    │ Working  │    │ QA       │    │          │
└─────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │                │               │
     │          [WIP: 3]         [WIP: 5]          [WIP: 1]           │
     │               │               │                │               │
     └───────────────┴───────────────┴────────────────┴───────────────┘
                                    PULL SYSTEM
```

### Phase Definitions

| Phase | Purpose | Entry Criteria | Exit Criteria | WIP Limit |
|-------|---------|----------------|---------------|-----------|
| **Backlog** | Capture ideas and requests | Task created or pushed from shelf | Prioritized, has basic description | ∞ |
| **Planning** | Define acceptance criteria, testing approach | Has description | AC defined, tests specified, estimated | 3 |
| **Ready** | Approved work waiting for agent | Planning complete | Agent has capacity | 5 |
| **Executing** | Active agent work | Agent pulls from Ready | Implementation complete | 1 per agent |
| **Complete** | Review and QA | Code complete | AC verified, tests pass, merged | ∞ |
| **Archived** | History and metrics | All exit criteria met | - | - |

## Task Structure

Each task is a markdown file with YAML frontmatter:

```yaml
---
id: TASK-001
title: "Implement user authentication"
phase: executing
type: feature  # feature, bug, refactor, research, spike
priority: high  # critical, high, medium, low
created: 2026-02-10T10:00:00Z
updated: 2026-02-10T14:30:00Z
assigned: agent-1
workspace: /Users/patrick/workingdir/myproject
project: myproject

# Planning fields
acceptance_criteria:
  - "User can login with email/password"
  - "Session persists for 24 hours"
  - "Invalid credentials show error message"

testing_instructions:
  - "Run: npm test auth"
  - "Verify login flow manually"

estimated_effort: 4h
complexity: medium  # low, medium, high

# Execution fields
branch: feat/TASK-001-auth
commits: []
pr_url: null

# Metrics
cycle_time: null
blocked_count: 0
blocked_duration: 0
---

# Description

Implement a secure user authentication system...
```

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             TASK FACTORY                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Web UI     │  │   API Server │  │  Job Engine  │  │   Agent SDK  │    │
│  │  (React)     │  │   (Express)  │  │   (Node)     │  │   (Pi SDK)   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │            │
│         └─────────────────┴─────────────────┴─────────────────┘            │
│                           │                                                │
│                    ┌──────┴──────┐                                         │
│                    │   SQLite    │                                         │
│                    │   (State)   │                                         │
│                    └─────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Web UI (React + Vite)
- **Chat Pane**: Primary interface, always visible on the left. Switches between planning agent and task agent based on selection.
- **Workspace/Shelf Pane**: Right pane in planning mode. Shows draft tasks and rendered HTML artifacts.
- **Task Detail Pane**: Right pane in task mode. Shows task metadata, acceptance criteria, and execution details.
- **Pipeline Bar**: Bottom bar showing all tasks across phases. Drag-and-drop. Mode switch.

#### 2. API Server (Express + WebSocket)
- REST API for CRUD operations
- WebSocket for real-time updates
- Planning agent endpoints (chat, create drafts, generate artifacts)
- Task agent endpoints (execute, steer, follow-up)
- File system watcher for task files

#### 3. Job Engine
- Phase transition logic
- WIP limit enforcement
- Queue processing (pull tasks from ready → executing)
- Metrics calculation

#### 4. Agent SDK (Pi SDK Integration)
- Task claiming and execution
- Progress reporting
- Chat log persistence
- Automatic phase transitions

### Planning Agent

The planning agent is a general-purpose conversational agent with these capabilities:

- **Research**: Web search, read documentation, analyze codebases
- **Decomposition**: Break large goals into factory-ready tasks
- **Disambiguation**: Ask clarifying questions, explore tradeoffs
- **Draft task creation**: Propose tasks that land on the shelf for user review
- **Artifact generation**: Produce rendered HTML outputs (tables, diagrams, summaries, mockups)
- **Status awareness**: Know about all current tasks, their phases, blockers

#### Shelf / Staging Area

Draft tasks and artifacts created by the planning agent live on a shelf before entering the production line:

- **Draft tasks**: Structured task data (title, description, AC) displayed as editable cards. User can edit, reorder, remove. Push to backlog individually or batch.
- **Artifacts**: Named HTML blobs rendered in a sandboxed iframe. Research outputs, comparison tables, architecture diagrams, UI mockups, etc.

#### Artifact Rendering

Artifacts are rendered HTML that the planning agent outputs:
- Displayed in a sandboxed `<iframe>` in the right pane
- Agent outputs raw HTML — no special format or component system needed
- Can contain inline CSS, SVG, interactive elements
- Sandboxed for security (no access to parent app state)

### Data Model

```typescript
interface Task {
  id: string
  frontmatter: TaskFrontmatter
  content: string
  chatLog: Message[]
  history: PhaseTransition[]
}

interface DraftTask {
  id: string  // temporary ID, replaced on creation
  title: string
  content: string
  acceptance_criteria: string[]
  type: TaskType
  priority: Priority
  complexity: Complexity
}

interface Artifact {
  id: string
  name: string
  html: string  // raw HTML to render in iframe
  created: string
  taskContext?: string  // optional link to related planning discussion
}

interface Shelf {
  draftTasks: DraftTask[]
  artifacts: Artifact[]
}

interface Workspace {
  path: string
  name: string
  config: WorkspaceConfig
  agents: Agent[]
  shelf: Shelf
}

interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'blocked' | 'offline'
  currentTask: string | null
  capabilities: string[]
}

interface PhaseTransition {
  from: Phase
  to: Phase
  timestamp: Date
  actor: 'user' | 'agent' | 'system'
  reason?: string
}
```

## File Structure

```
task-factory/
├── PLAN.md                    # This document
├── package.json               # Root package, workspaces
├── bin/
│   └── task-factory.js         # CLI entry point
├── packages/
│   ├── client/               # React frontend
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── WorkspacePage.tsx     # Main layout, mode switching
│   │   │   │   ├── ChatPane.tsx          # Left pane — unified chat
│   │   │   │   ├── ShelfPane.tsx         # Right pane — planning mode
│   │   │   │   ├── TaskDetailPane.tsx    # Right pane — task mode
│   │   │   │   ├── PipelineBar.tsx       # Bottom pipeline bar
│   │   │   │   ├── DraftTaskCard.tsx     # Editable draft task on shelf
│   │   │   │   ├── ArtifactViewer.tsx    # Sandboxed HTML artifact renderer
│   │   │   │   ├── TaskCard.tsx          # Pipeline task card
│   │   │   │   └── ...
│   │   │   ├── hooks/
│   │   │   └── styles/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── server/               # Express backend
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── task-service.ts
│   │   │   ├── workspace-service.ts
│   │   │   ├── agent-service.ts
│   │   │   ├── planning-agent.ts    # Planning agent orchestration
│   │   │   ├── shelf-service.ts     # Draft tasks and artifacts
│   │   │   ├── kanban-engine.ts
│   │   │   └── websocket.ts
│   │   ├── package.json
│   │   └── tests/
│   │
│   └── shared/               # Shared types and utilities
│       ├── src/
│       │   ├── types.ts
│       │   └── constants.ts
│       └── package.json
│
├── scripts/
├── docs/
└── skills/
```

## Implementation Phases

### Phase 1: Planning Agent & Shelf ✅
- [x] Design planning agent API (chat endpoint, streaming)
- [x] Implement shelf data model (draft tasks, artifacts)
- [x] Build ChatPane component (replaces ActivityLog)
- [x] Build ShelfPane component (draft tasks + artifact list)
- [x] Build ArtifactViewer (sandboxed iframe renderer)
- [x] Build DraftTaskCard (editable, push-to-backlog action)
- [x] Wire up mode switching in WorkspacePage (planning ↔ task)
- [x] Planning agent: basic chat capability
- [x] Planning agent: create draft tasks → shelf
- [x] Planning agent: generate HTML artifacts → shelf

### Phase 2: Mode Switching Polish ✅
- [x] Visual differentiation between planning and task modes
- [x] Header context bar (agent name / task ID)
- [x] Input placeholder changes per mode
- [x] Smooth transitions when switching modes
- [x] Preserve planning conversation when switching to task and back
- [x] Back-to-general navigation from task mode

### Phase 3: Planning Agent Capabilities ✅
- [x] Web research integration (via Pi SDK web_search/web_fetch tools)
- [x] Codebase analysis (via Pi SDK read/bash/edit tools)
- [x] Task decomposition prompts and patterns (system prompt guides decomposition)
- [x] Batch push from shelf to backlog (push-all endpoint + UI button)
- [x] Status awareness (system prompt includes current tasks and shelf state)

### Phase 4: Quality & Metrics ✅
- [x] Metrics calculation (cycle time, lead time — calculated on phase transition)
- [x] Metrics accessible via planning agent (system prompt includes aggregate stats)
- [x] Blocker tracking and escalation (blocker status shown in system prompt)

### Phase 5: Polish & Release
- [x] UI refinement and animations (mode transitions, styling)
- [x] Keyboard shortcuts (Esc=deselect, ⌘N=new task, ⌘K=focus chat)
- [ ] CLI improvements
- [ ] Documentation
- [ ] npm publishing

## Success Metrics

1. **Flow Efficiency**: % of time tasks are actively being worked vs waiting
2. **Cycle Time**: Average time from Ready → Complete
3. **Throughput**: Tasks completed per week
4. **Quality**: Rework rate — % of tasks that need to go back to executing
5. **Agent Utilization**: % of time agents are working vs idle
6. **Planning Efficiency**: Time from goal → factory-ready tasks on shelf
