# Task Factory Configuration Architecture

## Directory Structure

```
~/.pi/factory/                    # Task Factory specific config
├── settings.json                 # Task Factory settings (extends Pi settings)
├── workspaces/                   # Workspace-specific config
│   ├── {workspace-id}/
│   │   ├── settings.json        # Workspace overrides
│   │   ├── skills.json          # Enabled skills for this workspace
│   │   └── extensions.json      # Enabled extensions for this workspace
│   └── ...
└── cache/                        # Cached data
    ├── skills/                   # Cached skill content
    └── extensions/               # Cached extension bundles

~/.pi/agent/                      # Global Pi (read-only for Task Factory)
├── settings.json
├── skills/
├── extensions/
└── AGENTS.md
```

## Configuration Precedence

1. **Workspace settings** (highest priority)
2. **Task Factory global settings**
3. **Pi global settings** (fallback)

## Skills Integration

### Global Skills (from `~/.pi/agent/skills/`)
- Available to all workspaces
- Read-only
- Updated when Pi is updated

### Workspace-Specific Skills
- Enable/disable specific skills per workspace
- Configure skill defaults per workspace
- Add workspace-specific skill configurations

### Skills Configuration Format

```json
{
  "skills": {
    "enabled": [
      "agent-browser",
      "security-review",
      "tdd-feature"
    ],
    "config": {
      "agent-browser": {
        "defaultTimeout": 30000,
        "headless": true
      },
      "security-review": {
        "severityThreshold": "medium"
      }
    }
  }
}
```

## Extensions Integration

### Extension Slots in Task Factory

1. **header-right** - Next to the "+ New Task" button
2. **task-panel** - Inside task detail modal
3. **activity-log-footer** - Bottom of activity log
4. **kanban-column-header** - Above each kanban column
5. **workspace-sidebar** - Collapsible workspace panel

### Extension Configuration

```json
{
  "extensions": {
    "enabled": [
      "web-tools",
      "jobs"
    ],
    "config": {
      "web-tools": {
        "allowedOrigins": ["localhost", "*.github.com"]
      }
    }
  }
}
```

## Implementation Plan

### Phase 1: Task Factory Settings Directory
- [ ] Create `~/.pi/factory/` structure
- [ ] Move Task Factory settings from `~/.pi/agent/` to `~/.pi/factory/`
- [ ] Update server to read from new location

### Phase 2: Workspace-Specific Configuration
- [ ] Add workspace settings API
- [ ] Add workspace skills configuration
- [ ] Add workspace extensions configuration

### Phase 3: Extension Embedding
- [ ] Create extension slot system in React
- [ ] Load and render extensions in designated slots
- [ ] Extension communication API

### Phase 4: Skill Context Injection
- [ ] Inject enabled skills into agent context
- [ ] Skill-specific UI components
- [ ] Skill execution tracking
