---
name: tdd-verify-tests
description: Verify TDD completion after implementation by running tests and fixing failures until they pass.
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
  hooks: post
  workflow-id: tdd
  pairs-with: tdd-test-first
---

# TDD Verify Tests (Post-Execution)

Use this after main implementation work.

## Requirements

1. Run the relevant tests after implementation.
2. If any tests fail, fix implementation and/or tests until they pass.
3. Ensure tests added in the TDD pre-execution phase are included in the run.
4. Do not consider the task complete until the added tests are green.

## Output

- Report the exact test command(s) executed.
- Report final pass/fail status.
- If failures remain, explain what is still broken and why.
