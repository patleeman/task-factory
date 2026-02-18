---
name: update-docs
description: Review implementation changes and update impacted repository documentation before task completion.
metadata:
  author: task-factory
  version: "1.0"
  type: follow-up
  hooks: pre-planning,pre,post
---

# Update Repository Documentation

Review the completed task changes and keep repository documentation in sync.

## Instructions

1. Inspect the task's code/config/test changes and identify documentation impact.
2. Update only docs that are affected by those changes:
   - `README.md` for user-facing behavior, setup, or command changes.
   - `docs/**` pages for workflow, architecture, API, or contribution behavior changes.
   - `CHANGELOG.md` under `[Unreleased]` when the task introduces a user-visible or contributor-visible change.
3. Keep documentation edits concise, factual, and consistent with existing tone/structure.
4. Do not modify unrelated docs or rewrite large sections without clear need.
5. If no documentation updates are required, explicitly report: `No documentation updates were needed for this task.`

## Output requirements

- Briefly list each documentation file updated and why.
- If no files were updated, include the explicit no-op statement above.
