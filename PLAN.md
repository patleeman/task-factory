# Pi-Factory: Agent Work Queue System

## Vision

Pi-Factory is a **lean manufacturing-inspired** task queue system for AI agents. It applies Toyota Production System (TPS) principles to software development workflows, creating a continuous flow of work where agents pull tasks, execute them, and move them to completion with minimal waste and maximum visibility.

## Core Philosophy: TPS Principles Applied to Agent Work

### 1. **Just-In-Time (JIT) Production**
- Agents pull work only when they have capacity
- No overproduction of planned tasks
- Tasks flow through the system as needed

### 2. **Kanban (Visual Signaling)**
- Visual board showing work in progress
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

## Task Lifecycle (The Flow)

```
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ BACKLOG │───→│ PLANNING │───→│  READY    │───→│ EXECUTING│───→│  WRAPUP  │───→│ COMPLETE │
│         │    │          │    │           │    │          │    │          │    │          │
│ Ideas   │    │ Define   │    │ Approved  │    │ Agent     │    │ Review   │    │ Done     │
│ Incoming│    │ AC, Tests│    │ Queued    │    │ Working  │    │ Merge    │    │ Archive  │
└─────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │                │               │               │
     │          [WIP: 3]         [WIP: 5]          [WIP: 1]        [WIP: 2]            │
     │               │               │                │               │               │
     └───────────────┴───────────────┴────────────────┴───────────────┴───────────────┘
                                    PULL SYSTEM
```

### Phase Definitions

| Phase | Purpose | Entry Criteria | Exit Criteria | WIP Limit |
|-------|---------|----------------|---------------|-----------|
| **Backlog** | Capture ideas and requests | Task created | Prioritized, has basic description | ∞ |
| **Planning** | Define acceptance criteria, testing approach | Has description | AC defined, tests specified, estimated | 3 |
| **Ready** | Approved work waiting for agent | Planning complete | Agent has capacity | 5 |
| **Executing** | Active agent work | Agent pulls from Ready | Implementation complete | 1 per agent |
| **Wrapup** | Review, test, merge | Code complete | AC verified, tests pass, merged | 2 |
| **Complete** | Archive and metrics | All exit criteria met | - | - |

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
assigned: agent-1  # null if unassigned
workspace: /Users/patrick/workingdir/myproject
project: myproject

# TPS-inspired metrics
cycle_time: null  # calculated on completion
blocked_count: 0
blocked_duration: 0  # seconds

# Planning fields (filled in Planning phase)
acceptance_criteria:
  - "User can login with email/password"
  - "Session persists for 24 hours"
  - "Invalid credentials show error message"

testing_instructions:
  - "Run: npm test auth"
  - "Verify login flow manually"
  - "Check session cookie expiration"

estimated_effort: 4h  # t-shirt sizes or hours
complexity: medium  # low, medium, high

# Execution fields
branch: feat/TASK-001-auth
commits: []
pr_url: null

# Quality gates
quality_checks:
  tests_pass: false
  lint_pass: false
  review_done: false

# Blocker tracking
blocked:
  is_blocked: false
  reason: null
  since: null
---

# Description

Implement a secure user authentication system...

## Context

The application needs user authentication before...

## Notes

- Consider using bcrypt for password hashing
- JWT for session management
```

## System Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PI-FACTORY                                      │
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
│                           │                                                │
│                    ┌──────┴──────┐                                         │
│                    │  Task Files │                                         │
│                    │  (Markdown) │                                         │
│                    └─────────────┘                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Web UI (React + Vite)
- **Kanban Board**: Main interface, columns for each phase
- **Task Detail View**: Full task information, chat interface
- **Workspace Selector**: Switch between projects
- **Metrics Dashboard**: Cycle time, throughput, WIP charts
- **Agent Console**: Real-time agent activity, logs

#### 2. API Server (Express + WebSocket)
- REST API for CRUD operations
- WebSocket for real-time updates
- File system watcher for task files
- Git integration for branch/PR tracking

#### 3. Job Engine
- Phase transition logic
- WIP limit enforcement
- Quality gate validation
- Metrics calculation

#### 4. Agent SDK (Pi SDK Integration)
- Task claiming mechanism
- Progress reporting
- Chat log persistence
- Automatic phase transitions

### Data Model

```typescript
// Core entities
interface Task {
  id: string;
  frontmatter: TaskFrontmatter;
  content: string;  // markdown body
  chatLog: Message[];
  history: PhaseTransition[];
}

interface Workspace {
  path: string;
  name: string;
  config: WorkspaceConfig;
  agents: Agent[];
}

interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'blocked' | 'offline';
  currentTask: string | null;
  capabilities: string[];
}

interface PhaseTransition {
  from: Phase;
  to: Phase;
  timestamp: Date;
  actor: 'user' | 'agent' | 'system';
  reason?: string;
}
```

## UI Design Concept: "Industrial Minimalism"

### Aesthetic Direction
- **Inspiration**: Factory floor control room, Toyota Andon boards, industrial dashboards
- **Color palette**: Safety orange, slate grays, status colors (green/yellow/red)
- **Typography**: Monospace for data, clean sans-serif for UI
- **Visual language**: Card-based kanban, clear status indicators, WIP limit warnings

### Key Screens

#### 1. Kanban Board (Main View)
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ PI-FACTORY  [Project: myapp]  [Agent: online]              [+ New Task] [⚙️]  │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  BACKLOG        PLANNING [3/3]    READY [4/5]     EXECUTING    WRAPUP [1/2]   │
│  ───────        ─────────────     ───────────     ─────────    ────────────   │
│  ┌─────────┐    ┌─────────┐       ┌─────────┐     ┌─────────┐  ┌─────────┐    │
│  │TASK-003 │    │TASK-001 │       │TASK-005 │     │TASK-002 │  │TASK-004 │    │
│  │Auth     │    │Database │       │API Docs │     │[AGENT-1]│  │Review   │    │
│  │medium   │    │schema   │       │low      │     │Login    │  │needed   │    │
│  │         │    │high     │       │         │     │2h elapsed│ │         │    │
│  └─────────┘    └─────────┘       └─────────┘     └─────────┘  └─────────┘    │
│  ┌─────────┐    ┌─────────┐       ┌─────────┐                                  │
│  │TASK-006 │    │TASK-007 │       │TASK-008 │                                  │
│  │Email    │    │Tests    │       │Refactor │                                  │
│  │low      │    │medium   │       │medium   │                                  │
│  └─────────┘    └─────────┘       └─────────┘                                  │
│                 ┌─────────┐                                                    │
│                 │ ⚠️ WIP  │                                                    │
│                 │ LIMIT   │                                                    │
│                 └─────────┘                                                    │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

#### 2. Main Layout (Kanban + Unified Activity Log)
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ PI-FACTORY                              [Project: myapp]         [+ New Task] [⚙️]     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  ┌──────────────────────────────────────────────────────┐  ┌─────────────────────────┐ │
│  │ KANBAN BOARD                                         │  │ ACTIVITY LOG            │ │
│  │                                                      │  │                         │ │
│  │  BACKLOG   PLANNING[3]  READY[4]  EXECUTING  WRAPUP  │  │ ┌─────────────────────┐ │ │
│  │  ───────   ───────────  ────────  ─────────  ──────  │  │ │ ▓▓▓ TASK-002 ▓▓▓    │ │ │
│  │  ┌─────┐   ┌─────┐     ┌─────┐   ┌─────┐            │  │ │ Login page styling  │ │ │
│  │  │003  │   │001  │     │005  │   │002  │            │  │ ├─────────────────────┤ │ │
│  │  │Auth │   │DB   │     │Docs │   │[AG1]│            │  │ │ Agent: Starting...  │ │ │
│  │  │med  │   │high │     │low  │   │Login│            │  │ │                     │ │ │
│  │  └─────┘   └─────┘     └─────┘   │2h   │            │  │ │ User: Use flexbox   │ │ │
│  │  ┌─────┐   ┌─────┐               └─────┘            │  │ │                     │ │ │
│  │  │006  │   │007  │                                  │  │ │ Agent: ✅ Done      │ │ │
│  │  │Email│   │Test │                                  │  │ │                     │ │ │
│  │  │low  │   │med  │                                  │  │ ├─────────────────────┤ │ │
│  │  └─────┘   └─────┘                                  │  │ │ ▓▓▓ TASK-003 ▓▓▓    │ │ │
│  │                                                      │  │ │ API integration     │ │ │
│  │                                                      │  │ ├─────────────────────┤ │ │
│  │                                                      │  │ │ Agent: Starting...  │ │ │
│  │                                                      │  │ │                     │ │ │
│  │                                                      │  │ │ [Type message...] ↵ │ │ │
│  │                                                      │  │ └─────────────────────┘ │ │
│  └──────────────────────────────────────────────────────┘  └─────────────────────────┘ │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 3. Task Detail View (Modal/Panel)
```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ← Back to Board                                    [Edit] [Move] [Archive]    │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  TASK-001: Implement user authentication                    [executing]        │
│  ═══════════════════════════════════════════════════════════════════════       │
│                                                                                │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐     │
│  │ ACCEPTANCE CRITERIA             │  │ TESTING INSTRUCTIONS            │     │
│  │ ─────────────────────────────   │  │ ─────────────────────────────   │     │
│  │ ☐ User can login with email     │  │ • Run: npm test auth            │     │
│  │ ☐ Session persists 24h          │  │ • Verify login flow manually    │     │
│  │ ☐ Invalid creds show error      │  │ • Check cookie expiration       │     │
│  │                                 │  │                                 │     │
│  │ Estimated: 4h | Complexity: med │  │ Branch: feat/TASK-001-auth      │     │
│  └─────────────────────────────────┘  └─────────────────────────────────┘     │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ QUALITY GATES                                                           │  │
│  │ ─────────────────────────────────────────────────────────────────────── │  │
│  │  🟡 Tests passing    🔴 Lint clean    ⬜ Code review                     │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  [View in Activity Log →]                                                      │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

#### 4. Activity Log Detail
- **Unified Timeline**: All agent interactions across all tasks in chronological order
- **Task Separators**: Visual headers when agent switches to a new task
  - Shows task ID, title, and phase
  - Color-coded by task type (feature=blue, bug=red, etc.)
  - Timestamp of when work started on that task
- **Message Types**:
  - `user`: User messages (right-aligned, different color)
  - `agent`: Agent responses (left-aligned)
  - `system`: Phase transitions, completions (center, muted)
- **Quick Actions**: From any message, can:
  - Jump to task detail
  - View task in kanban board
  - Reply (continues that task's conversation)

## File Structure

```
pi-factory/
├── PLAN.md                    # This document
├── README.md                  # User documentation
├── package.json               # Root package, workspaces
├── bin/
│   └── pi-factory.js         # CLI entry point
├── packages/
│   ├── client/               # React frontend
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── KanbanBoard.tsx
│   │   │   │   ├── TaskCard.tsx
│   │   │   │   ├── TaskDetail.tsx
│   │   │   │   ├── PhaseColumn.tsx
│   │   │   │   ├── ChatInterface.tsx
│   │   │   │   ├── MetricsPanel.tsx
│   │   │   │   └── WorkspaceSelector.tsx
│   │   │   ├── hooks/
│   │   │   ├── contexts/
│   │   │   └── styles/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── server/               # Express backend
│   │   ├── src/
│   │   │   ├── index.ts      # Main server
│   │   │   ├── task-service.ts
│   │   │   ├── workspace-service.ts
│   │   │   ├── agent-service.ts
│   │   │   ├── metrics-service.ts
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
│   ├── build.js
│   └── install-service.sh
│
└── docs/
    ├── TPS-PRINCIPLES.md
    ├── TASK-LIFECYCLE.md
    └── API.md
```

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Project setup (monorepo, TypeScript, build system)
- [ ] Core data models and types
- [ ] Task file format and parsing
- [ ] Basic Express server with REST API
- [ ] SQLite schema for state management

### Phase 2: Kanban Core (Week 2)
- [ ] React frontend setup
- [ ] Kanban board UI with drag-and-drop
- [ ] Task card components
- [ ] Phase column with WIP limits
- [ ] WebSocket for real-time updates

### Phase 3: Task Management (Week 3)
- [ ] Task creation and editing
- [ ] Task detail view
- [ ] Markdown rendering
- [ ] File system watcher
- [ ] Git integration (branches, PRs)

### Phase 4: Agent Integration (Week 4)
- [ ] Agent SDK and claiming mechanism
- [ ] Chat interface in task view
- [ ] Progress reporting
- [ ] Automatic phase transitions
- [ ] Agent console view

### Phase 5: Quality & Metrics (Week 5)
- [ ] Quality gates implementation
- [ ] Metrics calculation (cycle time, throughput)
- [ ] Dashboard with charts
- [ ] Blocker tracking and escalation
- [ ] Export/reporting

### Phase 6: Polish & Release (Week 6)
- [ ] UI refinement and animations
- [ ] Keyboard shortcuts
- [ ] CLI improvements
- [ ] Documentation
- [ ] npm publishing

## Key Differentiators from pi-deck

| Feature | pi-deck | pi-factory |
|---------|---------|------------|
| **Primary UI** | Chat interface | Kanban board |
| **Work Model** | Reactive (user asks) | Proactive (pull queue) |
| **Task Structure** | Simple jobs | Rich TPS-inspired tasks |
| **Quality Focus** | Manual review | Built-in quality gates |
| **Metrics** | Basic | TPS metrics (cycle time, WIP) |
| **Agent Model** | Session-based | Continuous work queue |
| **Inspiration** | Terminal UI | Toyota Production System |

## Success Metrics

1. **Flow Efficiency**: % of time tasks are actively being worked vs waiting
2. **Cycle Time**: Average time from Ready → Complete
3. **Throughput**: Tasks completed per week
4. **Quality**: % of tasks passing all quality gates on first try
5. **Agent Utilization**: % of time agents are working vs idle

## Future Enhancements

- **Swimlanes**: Group tasks by project, priority, or agent
- **Automation Rules**: Auto-assign, auto-transition based on criteria
- **Multi-Agent**: Multiple agents working from same queue
- **Sprint Planning**: Time-boxed iterations with capacity planning
- **Integration**: GitHub Issues, Jira, Linear sync
- **AI Planning**: Automated task breakdown and estimation
