---
name: checkpoint-pr
description: Create a branch, commit all agent changes, push, and open a pull request. Use when work is ready for review and should be submitted as a PR rather than just checkpointed.
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
  hooks: post
---

# Checkpoint & PR

Create a branch, commit changes, push, and open a pull request.

## What This Does

1. Create a feature branch from the current state
2. Stage only files the agent modified
3. Commit with a descriptive message
4. Push the branch
5. Open a PR with a clear title and description

## Workflow

### 1. Check Current State

```bash
git status
git diff --stat
git branch --show-current
```

Understand what's changed and what branch we're on.

### 2. Create Feature Branch

If already on a feature branch, stay on it. If on main/master, create a new branch:

```bash
git checkout -b <branch-name>
```

Branch naming conventions:
- `feat/<description>` — New features
- `fix/<description>` — Bug fixes
- `refactor/<description>` — Refactoring
- `docs/<description>` — Documentation
- `security/<description>` — Security fixes

Use short, descriptive kebab-case names. Example: `feat/add-user-search-api`

### 3. Stage Agent's Changes

Only stage files the agent modified:
```bash
git add <file1> <file2> <file3>
```

**Do NOT use `git add .` or `git add -A`** — only stage specific files you changed.

### 4. Review Staged Changes

```bash
git diff --cached --stat
```

Confirm only intended files are staged.

### 5. Commit

Create a clear commit message summarizing all changes:

```bash
git commit -m "<type>: <brief description>"
```

If multiple logical changes, create multiple commits — one per logical unit.

### 6. Push Branch

```bash
git push -u origin $(git branch --show-current)
```

### 7. Create Pull Request

```bash
gh pr create --title "<PR title>" --body "$(cat <<'EOF'
## Summary

<2-3 sentence summary of what this PR does>

## Changes

- <change 1>
- <change 2>
- <change 3>

## Testing

- [ ] Tests pass
- [ ] Manual testing completed

EOF
)"
```

**PR Title Format:**
- `feat: Add user search API endpoint`
- `fix: Correct SQL injection in user search`
- `refactor: Simplify authentication middleware`

**PR Description:**
- Clear summary of what changed and why
- Bullet list of specific changes
- Testing checklist
- Mention breaking changes if any

## Important Notes

- **Only commit agent's changes** — Don't stage unrelated files
- **Don't use --no-verify** — Let hooks run
- **Never force push** — Use regular push only
- **Check for `gh` CLI** — If `gh` is not available, print the URL to create a PR manually
- **Keep PRs focused** — One logical change per PR (< 500 lines ideal)
- **Base on main** — PR should target the default branch

## What Not to Include

Don't commit:
- Broken/incomplete code
- Files with merge conflicts
- Sensitive files (.env, credentials, secrets)
- Build artifacts, node_modules, etc.
- Debug/console.log statements

If these are found, clean them up before creating the PR.

## Fallback (no `gh` CLI)

If `gh` is not installed:

```bash
echo "Create a PR at: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/.git$//')/compare/$(git branch --show-current)"
```

Provide the user with the URL and suggested title/description.
