# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New `subagent` skill execution type. Skills with `metadata.type: subagent` run as a single prompt turn (like `follow-up`) and signal to the agent that it should use `message_agent` to delegate work via a subagent conversation. The type is selectable in the Skill Management UI, via the `create_skill` extension tool (`type: "subagent"`), and in `SKILL.md` frontmatter. Pipeline and task detail views now show distinct labels for `loop`, `subagent`, and default (`skill`/`gate`) types. Unknown `metadata.type` values in SKILL.md files continue to resolve safely to `follow-up`.
- Inline subagent chat navigation in task chat: when the foreman or an execution agent uses `message_agent` with `messageType: "chat"` to start or resume a conversation with another task, the parent chat timeline now shows a labeled, clickable **Subagent Chat** entry. Clicking it opens that task's conversation in the same panel without navigating away or creating a new task. A **Back** button in the subagent view header returns to the parent conversation. The `message_agent` extension now includes `targetTaskId` in tool result details for `chat` actions to enable this.

### Changed
- Backlog tasks with acceptance criteria can now be moved directly to Executing, skipping the Ready phase. Previously, backlog → executing moves were always rejected. The move is still blocked if planning is actively running without a saved plan, or if the task has no acceptance criteria.
- Global Settings page now uses a unified tab navigation: **Appearance**, Authentication, Task Defaults, and Skills. Appearance was previously always visible above the tab strip; it is now a first-class tab and the default landing tab. The Skills tab gained a callout that clarifies the distinction between skill library management (create/edit skills here) and default lane assignment (Task Defaults tab).
- Settings → Skills no longer shows the **Import SKILL.md** section (paste textarea, overwrite checkbox, file loader, and Import Skill button). Skills can still be created and managed directly in the panel.
- Workspace Configuration no longer includes an Extensions tab. Workspace skills are now auto-discovered from local `SKILL.md` files (`<workspace>/skills` and `<workspace>/.taskfactory/skills`) and are enabled by default until explicitly toggled.
- Task Defaults now support `defaultModelProfileId` for both global and workspace scope. Workspace Task Defaults now expose a default-profile selector (with a link to Global Settings for profile management), and Settings → Task Defaults includes a matching global default-profile selector.
- New Task default model resolution now follows: explicit form state → workspace default profile → global default profile → manual model defaults.
- Model profiles now support ordered planning/execution fallback model arrays. Planning and execution automatically fail over through those chains on retryable provider errors (rate limits and 5xx-style instability), and failover attempts are recorded in task activity.

### Fixed
- Multi-image requests no longer fail with an Anthropic `invalid_request_error` when any attached image exceeds 2000px in either dimension. The server now normalizes all image attachments (task prompts, chat/steer/follow-up messages, and foreman planning messages) to fit within the 2000×2000 px limit before sending to the provider. Images that cannot be normalized are skipped individually rather than aborting the entire request.
- Agent turns no longer fail with a provider `invalid_request_error` caused by unsupported image MIME types (e.g. `image/svg+xml`, `image/tiff`). The server now enforces an inline-image allowlist (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) and normalizes known aliases (e.g. `image/jpg` → `image/jpeg`) before dispatch. Unsupported image attachments are excluded from inline image payloads; in task execution contexts they appear as readable file-path references so the agent can still access the file. The foreman planning message endpoint now returns `400` with a descriptive error when a message contains only attachment references and none resolve to a supported image format.
- Task and draft attachment previews no longer render broken thumbnails for unsupported image MIME types (for example `image/heic`/`image/tiff`). The UI now only renders inline image previews for browser-safe formats (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) and falls back to file-style attachment links for other types.
- Task attachment download responses now use stored attachment MIME metadata when available, instead of relying only on extension inference; uncommon extensions are served with the correct `Content-Type`.
- Removed the duplicate theme switcher from the global Settings header; theme changes remain available from the workspace sidebar toggle and Settings → Appearance selector.
- Stale default model profile IDs are now safely ignored and cleared on save/load, preventing invalid profile selections from being returned or persisted.

## [0.3.0] - 2026-02-18

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
- Task chat slash autocomplete now renders a single ranked list that merges slash command registry entries with discovered hook skills as clickable `/skill:<id>` suggestions.
- Execution pipeline skill assignment now uses an explicit lane selector (pre-planning/pre-execution/post-execution) with lane-scoped skill options in the add control.
- Root package metadata now pins `pnpm` via `packageManager` for consistent tooling across environments.

### Fixed
- Creating a new task no longer auto-redirects the UI; after submission, navigation stays on the current route unless the user explicitly opens a task.
- Late task-create completions from a previously active workspace no longer mutate the current workspace UI or pull focus back.
- Deleting a running task now stops active planning/execution sessions before file removal, and late callbacks no longer recreate deleted task files.
- Slash autocomplete keyboard navigation now keeps the highlighted suggestion scrolled into view while moving through results.

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

[Unreleased]: https://github.com/patleeman/task-factory/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/patleeman/task-factory/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/patleeman/task-factory/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/patleeman/task-factory/releases/tag/v0.1.0
