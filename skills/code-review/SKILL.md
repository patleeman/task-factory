---
name: code-review
description: Review all code changes for bugs, edge cases, naming, complexity, and missing error handling. Use after completing implementation work to catch issues before marking a task complete.
metadata:
  author: task-factory
  version: "1.0"
  type: follow-up
  hooks: post
---

# Code Review

Review all the code changes you just made for this task. Be thorough and systematic.

## What to check

1. **Correctness**: Are there any bugs, logic errors, or off-by-one mistakes?
2. **Edge cases**: What happens with empty inputs, null values, boundary conditions?
3. **Error handling**: Are errors caught and handled appropriately? Are error messages helpful?
4. **Naming**: Are variables, functions, and files named clearly and consistently?
5. **Complexity**: Is there unnecessary complexity? Can anything be simplified?
6. **Duplication**: Is there copy-pasted code that should be extracted?
7. **Tests**: Are there adequate tests? Do they cover edge cases and error paths?
8. **Security**: Any obvious security issues (hardcoded secrets, unsanitized input, etc.)?

## Instructions

- Review each file you changed or created
- If you find issues, fix them immediately
- After fixing, verify the fix doesn't break anything
- Summarize what you found and what you changed
