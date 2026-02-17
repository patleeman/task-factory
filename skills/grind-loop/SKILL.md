---
name: grind-loop
description: Repeatedly check if there is more work to do until the task is truly complete. Use after implementation to ensure nothing was missed against the acceptance criteria.
metadata:
  author: task-factory
  version: "1.0"
  type: loop
  hooks: post
  max-iterations: "5"
  done-signal: HOOK_DONE
config:
  - key: max-iterations
    label: Max Iterations
    type: number
    default: "5"
    description: Maximum number of grind loop iterations
    validation:
      min: 1
      max: 20
---

# Grind Loop

Review everything you have done for this task. Check your work against the acceptance criteria and testing instructions.

## Checklist

- Are ALL acceptance criteria fully met?
- Do all tests pass?
- Is error handling complete?
- Are there any TODOs or placeholder code left behind?
- Did you miss any files that need updating?
- Does the code compile and run without warnings?

## Instructions

If everything is truly complete and correct, respond with exactly:

HOOK_DONE

Otherwise, fix what is needed and continue working. Do not respond with HOOK_DONE until you are confident the task is fully complete.
