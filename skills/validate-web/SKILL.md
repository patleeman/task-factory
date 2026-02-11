---
name: validate-web
description: Validate code changes by testing them in the browser using agent-browser. Use after implementing frontend changes, fixing UI bugs, or any task where visual/functional verification in a real browser is needed.
allowed-tools: Bash(agent-browser:*)
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
---

# Validate Web Changes

Open the app in a browser and verify your changes work correctly.

## When to Use

- After making frontend/UI changes
- After fixing a browser-visible bug
- After changing routes, forms, or interactive elements
- When acceptance criteria include user-facing behavior

## Workflow

### 1. Determine What to Test

Review the changes you just made. Identify:
- Which pages or components were affected
- What user-visible behavior changed
- What the expected outcome looks like

### 2. Start the App (if needed)

If the app isn't already running, start the dev server:

```bash
# Detect and run the appropriate dev command
# e.g. npm run dev, yarn dev, python manage.py runserver, etc.
```

Wait for the server to be ready before proceeding.

### 3. Open and Snapshot

Navigate to the affected page and take a snapshot:

```bash
agent-browser open http://localhost:<port>/<path>
agent-browser snapshot -i
```

### 4. Verify the Changes

Test the specific behavior that changed:

- **Visual check**: Take a screenshot to confirm layout/content is correct
  ```bash
  agent-browser screenshot
  ```
- **Interactive check**: Click buttons, fill forms, navigate — confirm it works
  ```bash
  agent-browser click @e1
  agent-browser wait --load networkidle
  agent-browser snapshot -i
  ```
- **Content check**: Read text from elements to verify correct data
  ```bash
  agent-browser get text @e1
  ```

### 5. Test Edge Cases

If applicable, also verify:
- Empty states (no data)
- Error states (invalid input, failed requests)
- Navigation flows (back/forward, links)
- Form validation messages

### 6. Report Results

After testing, summarize:
- **What you tested** — pages visited, actions performed
- **What passed** — expected behavior confirmed
- **What failed** — unexpected behavior found (fix before marking complete)

### 7. Clean Up

```bash
agent-browser close
```

## Important Notes

- Always `snapshot -i` after any navigation or DOM change — refs are invalidated
- If testing requires auth, use `agent-browser state save/load` to persist login
- Use `--headed` mode if you need the user to see the browser: `agent-browser --headed open <url>`
- If the dev server isn't running, start it in the background and wait for it to be ready before opening the browser
