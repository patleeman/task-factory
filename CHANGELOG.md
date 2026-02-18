# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Idea backlog items can now be edited inline: clicking an idea's text opens an editable input; Enter or blur saves, Escape cancels. Backed by a new `PATCH /api/workspaces/:workspaceId/idea-backlog/items/:ideaId` endpoint.
- Starter post-execution skill `update-docs` to keep `README.md`, `docs/**`, and `CHANGELOG.md` aligned with implementation changes.
- Execution reliability telemetry signals in task activity metadata for turn lifecycle timing, stall recovery, provider retry outcomes, and compaction outcomes.
- Regression coverage for execution reliability telemetry and failure-path watchdog recovery behavior.
- Provider/model execution circuit breaker for queue automation, including cooldown status in queue APIs/events and manual resume override via queue start.
- Reusable model profiles in Settings (named planning+execution model/thinking presets), with New Task profile dropdown that applies and locks model selectors when selected.

### Changed
- Browser tab title now reflects the active workspace name (e.g. `my-project | Task Factory`), reverting to `Task Factory` when no workspace is open.
- Added pre-planning hook support (`prePlanningSkills` / `pre-planning`) across task defaults, task forms, and planning lifecycle execution.
- Skill lane assignment is now universal: any discovered skill can be used in pre-planning, pre-execution, or post-execution lanes without hook-compatibility filtering.
- Default post-execution skill order now includes `update-docs` for new tasks.
- Runtime/API docs now define reliability query patterns and alert thresholds for stall ratio and repeated provider failures.
- Foreman Q&A lifecycle is now more resilient across workspace switches: pending prompts recover on workspace resume via persisted-history + `/qa/pending` fallback, and the Q&A panel dismisses immediately after successful `/qa/respond` and `/qa/abort` calls while WS events continue idempotent reconciliation.

### Fixed
- Creating a new task no longer auto-redirects the UI; after submission, navigation stays on the current route unless the user explicitly opens a task.
- Late task-create completions from a previously active workspace no longer mutate the current workspace UI or pull focus back.
- Deleting a running task now stops active planning/execution sessions before file removal, and late callbacks no longer recreate deleted task files.
## [0.2.0] - 2026-02-17

### Added
- `create_extension` tool for foreman to create new TypeScript extensions
- `create_skill` tool for foreman to create execution skills

### Fixed
- Dark mode background for dismissed "Won't Do" draft cards

### Changed
- Renamed pi-factory to task-factory across codebase

### Fixed (Code Quality)
- Fixed lint error: replaced `require()` with ES module import in planning-agent-service.ts
- Fixed type errors: made `registerTaskCallbacks` and `registerMessageAgentCallbacks` async
- Fixed `moveTask` callback signature to match `moveTaskToPhase` API
- Fixed iconography regression: removed emoji glyphs from create-extension.ts

## [0.1.0] - Initial Release

### Added
- Initial release of task-factory
- Lean manufacturing-inspired task queue system for AI agents
- CLI tool for managing tasks
- Web UI for visual task management
- Extension system for custom tools
- Skill system for execution prompts
- Planning agent for task decomposition
- Queue manager for task automation
- Workspace management
- Task lifecycle: backlog → ready → executing → complete/archived

[Unreleased]: https://github.com/patleeman/task-factory/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/patleeman/task-factory/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/patleeman/task-factory/releases/tag/v0.1.0
