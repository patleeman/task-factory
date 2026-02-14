---
name: capture-screenshot
description: Capture a browser screenshot for task validation and attach it to the active task using attach_task_file.
allowed-tools: Bash(agent-browser:*), attach_task_file
metadata:
  author: pi-factory
  version: "1.0"
  type: follow-up
  hooks: post
---

# Capture Screenshot

Capture visual proof of the current app state and attach it to the task.

## Workflow

1. **Open the app**
   - Prefer `http://localhost:3000` unless task context specifies another URL.
   - If needed, start the app first and wait until it is reachable.

2. **Take screenshot to a known path**

```bash
mkdir -p .pi/tmp/screenshots
agent-browser open http://localhost:3000
agent-browser wait --load networkidle
agent-browser screenshot .pi/tmp/screenshots/validation-$(date +%s).png
```

3. **Attach screenshot to task**
   - Use `attach_task_file` with the screenshot path.
   - Include `taskId` if you can read it from the task context; otherwise omit it.

Example tool call:

```text
attach_task_file({
  path: ".pi/tmp/screenshots/validation-12345.png",
  taskId: "<TASK_ID>",
  filename: "validation-screenshot.png"
})
```

4. **Report result**
   - Confirm which URL was captured.
   - Confirm the attachment filename/ID returned by `attach_task_file`.

## Notes

- Use a deterministic screenshot path (don’t rely on unknown temp output paths).
- If capture or attach fails, explain exactly what failed and stop.
- You may take multiple screenshots if needed, but attach at least one clear validation image.
