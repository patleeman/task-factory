# State Contract (Canonical)

This is the canonical reference for Task Factory lifecycle state.

Code sources:

- Contract + mode resolution: `packages/server/src/state-contract.ts`
- Transition event logging: `packages/server/src/state-transition.ts`
- Phase transition validation: `packages/server/src/task-service.ts` (`canMoveToPhase`)

## 1) State tuple

Runtime task state is tracked as a tuple:

- `phase`: pipeline column (`backlog | ready | executing | complete | archived`)
- `planningStatus`: planning lifecycle (`running | completed | error | none`)
- `mode`: agent capability contract (`foreman | task_planning | task_execution | task_complete`)

The server injects this as `<state_contract version="2">...</state_contract>` on agent turns.

## 2) Mode contracts

| Mode | Meaning | Allowed | Forbidden | Completion rule |
|---|---|---|---|---|
| `foreman` | Workspace planning agent | `read`, `bash`, `web_search`, `web_fetch`, `ask_questions`, `create_draft_task`, `create_artifact`, `manage_shelf`, `manage_new_task`, `factory_control` | `edit`, `write`, `save_plan`, `task_complete` | Provide planning output and stop unless asked for more. |
| `task_planning` | Task-level planning run | `read`, `bash`, `save_plan` | `edit`, `write`, `task_complete`, `web_search`, `web_fetch` | Call `save_plan` exactly once, then stop. |
| `task_execution` | Task implementation run | `read`, `bash`, `edit`, `write`, `task_complete`, `attach_task_file` | `save_plan`, `web_search`, `web_fetch` | Call `task_complete` only when done. |
| `task_complete` | Post-completion chat/rework | `read`, `bash`, `edit`, `write`, `attach_task_file` | `save_plan`, `task_complete`, `web_search`, `web_fetch` | Respond conversationally; do not call lifecycle tools. |

## 3) Mode resolution rules

Server function: `resolveTaskMode(frontmatter)`.

| Condition | Resolved mode |
|---|---|
| Workspace-level Foreman turn | `foreman` |
| `phase=backlog` AND `planningStatus=running` AND no plan | `task_planning` |
| `phase=executing` | `task_execution` |
| `phase=complete` | `task_complete` |
| `phase in {backlog(with plan or error), ready, archived}` | `task_complete` |

Implication: most non-executing task chats run in `task_complete` mode, which intentionally locks planning and lifecycle tools.

## 4) Phase transition rules

Validation source: `canMoveToPhase`.

### Allowed phase moves

| From | Allowed targets |
|---|---|
| `backlog` | `ready`, `complete`, `archived` |
| `ready` | `backlog`, `executing`, `archived` |
| `executing` | `backlog`, `ready`, `complete`, `archived` |
| `complete` | `ready`, `executing`, `archived` |
| `archived` | `backlog`, `complete` |

### Additional guards

- Move to `ready` requires at least one acceptance criterion.
- Move to `executing` is blocked while planning is still running with no saved plan.

## 5) Planning status transitions

### Nominal path

`none → running → completed`

- `running`: set when `planTask` starts.
- `completed`: set by `finalizePlan` when `save_plan` callback persists criteria + plan.

### Error path

`running → error`

Set when planning fails, times out, exceeds guardrails without saving a plan, or ends without `save_plan`.

### Recovery

On startup, interrupted planning tasks (`planningStatus=running` and no plan) are resumed unless already complete/archived. The same recovery path also picks up legacy unplanned backlog tasks (no status + no plan + non-empty description).

## 6) Transition logging contract

Every meaningful state change should emit a structured transition via `logTaskStateTransition` with:

- `from` snapshot
- `to` snapshot
- `source` (for example `task:move`, `planning:completed`, `queue:auto-assigned`)
- optional `reason`

These are persisted as activity system events with machine-readable metadata (`kind: state-transition`).

## 7) Change checklist

When changing lifecycle behavior, update all of:

1. `state-contract.ts` (mode rules, injected contract text)
2. `task-service.ts` transition validation (if phase rules changed)
3. `state-transition.ts` logging payload shape (if metadata changed)
4. tests:
   - `packages/server/tests/state-contract.test.ts`
   - `packages/server/tests/state-transition.test.ts`

## Related docs

- [System Architecture](./system-architecture.md)
- [Runtime Flows](./runtime-flows.md)
- [Developer Commands Reference](../contribution/developer-commands.md)
