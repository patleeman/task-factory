---
name: checkpoint
description: Commit and push the agent's current work without opening a PR. Stages only files modified by the agent, creates a descriptive commit message, and pushes to the current branch.
metadata:
  author: task-factory
  version: "1.0"
  type: follow-up
  hooks: post
---

# Checkpoint

Commit and push the agent's work in progress — no PR, no branch creation.

## What This Does

1. Review git status to see modified files
2. Stage only files the agent modified during this session
3. Review staged changes
4. Create a descriptive commit message based on changes
5. Commit and push to current branch

## Workflow

### 1. Check Current State

```bash
git status
git diff --stat
```

Identify which files were modified by the agent vs. user.

### 2. Stage Agent's Changes

Only stage files the agent modified:
```bash
git add <file1> <file2> <file3>
```

**Do NOT use `git add .` or `git add -A`** — only stage specific files you changed.

### 3. Review Staged Changes

```bash
git diff --cached --stat
```

Confirm only intended files are staged.

### 4. Create Commit Message

Analyze the changes and write a clear, concise commit message:

```
<type>: <brief description>

<optional detailed explanation if needed>
```

**Types:**
- `feat:` — New feature
- `fix:` — Bug fix
- `refactor:` — Code restructuring
- `docs:` — Documentation
- `test:` — Tests
- `chore:` — Maintenance

### 5. Commit & Push

```bash
git commit -m "<commit message>"
git push
```

If branch has no upstream:
```bash
git push -u origin $(git branch --show-current)
```

## Important Notes

- **Only commit agent's changes** — Don't stage unrelated files
- **Don't use --no-verify** — Let hooks run
- **Check for conflicts** — If push fails due to remote changes, inform user
- **Never force push** — Use regular push only
- **Keep commits focused** — One logical change per checkpoint

## What Not to Checkpoint

Don't commit:
- Broken/incomplete code (unless explicitly WIP)
- Files with merge conflicts
- Sensitive files (.env, credentials, secrets)
- Build artifacts, node_modules, etc.

If these are staged, warn the user and ask before proceeding.
