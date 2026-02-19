# State Contract

## Scope

Canonical lifecycle contract for task modes, phases, planning status, and transition rules.

## Use when

- You are changing lifecycle behavior or tool permissions
- You need to verify what tools an agent may call in a given state
- You are debugging invalid phase moves or mode resolution

## Quick start

1. Locate current task tuple: `phase`, `planningStatus`, and resolved `mode`.
2. Validate allowed tools for that mode.
3. Validate proposed phase transition against allowed transitions.

## Reference

### State tuple

- `phase`: `backlog | ready | executing | complete | archived`
- `planningStatus`: `running | completed | error | none`
- `mode`: `foreman | task_planning | task_execution | task_complete`

### Mode contracts

| Mode | Allowed tools | Forbidden tools | Completion rule |
|---|---|---|---|
| `foreman` | `read`, `bash`, `web_search`, `web_fetch`, `ask_questions`, `create_draft_task`, `create_artifact`, `manage_new_task`, `factory_control` | `edit`, `write`, `save_plan`, `task_complete` | Provide planning output and stop unless asked for more |
| `task_planning` | `read`, `bash`, `save_plan` | `edit`, `write`, `task_complete`, `web_search`, `web_fetch` | Call `save_plan` exactly once, then stop |
| `task_execution` | `read`, `bash`, `edit`, `write`, `task_complete`, `attach_task_file` | `save_plan`, `web_search`, `web_fetch` | Call `task_complete` only when criteria are complete |
| `task_complete` | `read`, `bash`, `edit`, `write`, `attach_task_file` | `save_plan`, `task_complete`, `web_search`, `web_fetch` | Respond conversationally; do not call lifecycle tools |

### Mode resolution rules

| Condition | Mode |
|---|---|
| Workspace Foreman turn | `foreman` |
| `phase=backlog` + `planningStatus=running` + no plan | `task_planning` |
| `phase=executing` | `task_execution` |
| `phase=complete` | `task_complete` |
| `phase in {ready, archived, backlog(with plan/error)}` | `task_complete` |

### Allowed phase transitions

| From | Allowed to |
|---|---|
| `backlog` | `ready`, `executing`*, `complete`, `archived` |
| `ready` | `backlog`, `executing`, `archived` |
| `executing` | `backlog`, `ready`, `complete`, `archived` |
| `complete` | `ready`, `executing`, `archived` |
| `archived` | `backlog`, `complete` |

Additional guards:

- Move to `ready` requires at least one acceptance criterion.
- Move to `executing` is blocked when planning is still running and no plan exists.
- `backlog → executing`* (direct skip): also requires at least one acceptance criterion.

## Examples

```xml
<state_contract version="2">
  <mode>task_execution</mode>
  <phase>executing</phase>
  <planning_status>none</planning_status>
</state_contract>
```

## Related docs

- [Runtime Flows](./runtime-flows.md)
- [Workflow and Queue](./workflow-and-queue.md)
- [System Architecture](./system-architecture.md)
