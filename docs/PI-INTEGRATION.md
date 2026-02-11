# Pi Integration Design

## Overview
Integrate Pi settings, extensions, and skills into pi-factory so agents can use the full Pi ecosystem while working on tasks.

## Pi Configuration Structure

```
~/.pi/agent/
├── settings.json          # User preferences (theme, default model, etc.)
├── models.json            # Available models and providers
├── auth.json              # API keys and credentials
├── AGENTS.md              # Global agent instructions
├── extensions/            # UI extensions
│   ├── context-bar-footer/
│   ├── custom-status-bar/
│   ├── jobs/             # Job management extension
│   ├── review/           # Code review extension
│   └── web-tools/        # Web tools extension
├── skills/               # Agent skills
│   ├── agent-browser/    # Browser automation
│   ├── security-review/  # Security auditing
│   ├── tdd-feature/      # TDD workflow
│   └── ...
└── themes/               # UI themes
```

## Integration Points

### 1. Settings Panel (UI)
Embed Pi settings in a settings panel accessible from the header:

```
┌─────────────────────────────────────────────────────────────────┐
│ PI-FACTORY                              [⚙️ Settings] [+ Task]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Settings Modal:                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  General | Models | Extensions | Skills | Themes        │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │                                                         │   │
│  │  Default Provider: [kimi-coding ▼]                     │   │
│  │  Default Model:    [k2p5 ▼]                            │   │
│  │  Thinking Level:   [off ▼]                             │   │
│  │  Theme:            [cobalt2 ▼]                         │   │
│  │                                                         │   │
│  │  [Save Settings]                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Extensions Integration
Load Pi extensions as plugins in pi-factory:

- **context-bar-footer**: Add to activity log footer
- **custom-status-bar**: Add to header status area
- **jobs**: Integrate with task execution
- **review**: Add to wrapup phase
- **web-tools**: Available in executing phase

### 3. Skills Integration
Make Pi skills available to agents working on tasks:

Each task can specify which skills are available:
```yaml
---
id: TASK-001
title: "Implement authentication"
skills:
  - agent-browser      # For testing login flow
  - security-review    # For auditing auth code
  - tdd-feature        # For test-driven development
---
```

### 4. Agent Context
When an agent claims a task, inject:
- Global AGENTS.md rules
- Task-specific context
- Available skills with their SKILL.md content
- Extension capabilities

## Implementation Plan

### Phase 1: Settings API
- [ ] Read/write `~/.pi/agent/settings.json`
- [ ] Read `~/.pi/agent/models.json`
- [ ] Settings UI panel

### Phase 2: Extensions API
- [ ] Scan `~/.pi/agent/extensions/`
- [ ] Load extension manifests
- [ ] Extension UI slots (header, footer, task view)

### Phase 3: Skills API
- [ ] Scan `~/.pi/agent/skills/`
- [ ] Parse SKILL.md files
- [ ] Make skills available per-task
- [ ] Inject skill context into agent prompts

### Phase 4: Agent Integration
- [ ] Pi SDK integration for task execution
- [ ] Context injection (AGENTS.md + skills)
- [ ] Activity log streaming

## API Design

```typescript
// Settings
interface PiSettings {
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: 'off' | 'low' | 'medium' | 'high';
  theme: string;
}

// Extension
interface PiExtension {
  id: string;
  name: string;
  version: string;
  entryPoint: string;
  slots: ('header' | 'footer' | 'task-panel' | 'activity-log')[];
}

// Skill
interface PiSkill {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  content: string; // Full SKILL.md content
}

// Agent Context
interface AgentContext {
  globalRules: string; // AGENTS.md
  task: Task;
  availableSkills: PiSkill[];
  workspace: Workspace;
}
```

## UI Components

### SettingsButton
- Gear icon in header
- Opens settings modal

### SettingsModal
- Tabbed interface
- General: Provider, model, thinking level
- Extensions: Enable/disable, configure
- Skills: View available skills
- Themes: Select UI theme

### ExtensionSlot
- Named slots for extensions to render into
- `header-right`, `activity-log-footer`, `task-panel-sidebar`

### SkillBadge
- Shows available skills on task card
- Click to view skill details
