---
name: tdd-test-first
description: Enforce test-first behavior before implementation by writing or updating tests and running them in pre-execution.
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
  hooks: pre
  workflow-id: tdd
  pairs-with: tdd-verify-tests
---

# TDD Test-First (Pre-Execution)

Use this before main implementation work.

## Requirements

1. Identify all behavior changes required by the task.
2. Write or update all required tests before implementing production code.
3. Run the relevant tests in this pre-execution phase.
4. If tests unexpectedly pass, tighten them so they fail for missing behavior.
5. Do not implement production code in this pre-execution step.

## Output

- Summarize which tests were added or updated.
- Report the test command(s) executed and current test status.
- Hand off implementation changes to the main execution phase.
