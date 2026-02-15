# Gondolin VM Sandbox Integration

## Overview

Integrate [Gondolin](https://github.com/earendil-works/gondolin) as an **optional** sandboxing layer for Task Factory task execution. When enabled, each executing task runs inside a lightweight QEMU micro-VM with controlled network egress, secret injection, and filesystem isolation.

**Status:** Planning (not yet implemented)
**Dependency:** `@earendil-works/gondolin` (v0.2.1, experimental)
**Requires:** QEMU installed on the host machine

## Why

Today, Task Factory task agents run with full host access — they can read/write any file, execute any command, and reach any network endpoint. This is fine for trusted local use but becomes a problem when:

- Agents run untrusted or generated code that could damage the host
- Tasks need API credentials (GitHub tokens, cloud keys) that shouldn't be visible to the agent
- You want network egress control (only allow access to specific APIs)
- You want per-task filesystem isolation (one task can't corrupt another's workspace)

Gondolin solves all of these with a TypeScript-native approach that fits Task Factory's stack.

## What Gondolin Provides

| Capability | How it works |
|---|---|
| **Compute isolation** | QEMU micro-VM — agent code runs in a real Linux guest, not on the host OS |
| **Network egress control** | JS-implemented Ethernet stack; only HTTP/TLS to allowlisted hosts |
| **Secret injection** | Guest gets random placeholders; real values substituted at the network layer by the host |
| **Programmable filesystem** | FUSE-backed VFS with providers (memory, real-fs, read-only, custom) |
| **Disk checkpoints** | qcow2 overlays for cheap fork-from-snapshot per task |
| **Fast boot** | Sub-second VM startup; optimized for spin-up/execute/tear-down |

## Integration Design

### Principle: Opt-in, per-workspace or per-task

Sandboxing is off by default. Users enable it at the workspace or task level. Users without QEMU installed are unaffected.

### Architecture

```
Task Factory server
  └── agent-execution-service.ts
        └── createTaskConversationSession()
              └── DefaultResourceLoader({ additionalExtensionPaths })
                    └── extensions/gondolin-sandbox/index.ts   ← NEW
                          ├── Boots Gondolin VM on session_start
                          ├── Overrides read/write/edit/bash tools
                          ├── Configures network policy from task/workspace config
                          ├── Mounts workspace at /workspace via RealFSProvider
                          └── Tears down VM on session_shutdown
```

The integration is a **Pi extension** in `extensions/gondolin-sandbox/`. This follows the existing pattern — Task Factory already discovers and loads repo extensions via `additionalExtensionPaths` in `agent-execution-service.ts`.

### Extension Behavior

The extension (`extensions/gondolin-sandbox/index.ts`) will:

1. **Check if sandboxing is enabled** for the current task/workspace (via env or config). If not, do nothing — all tools remain host-native.
2. **On `session_start`**: boot a Gondolin VM with:
   - Workspace mounted read-write at `/workspace` via `RealFSProvider`
   - Network policy from task config (allowed hosts, secrets)
   - Optional custom image path for pre-built environments
3. **Override Pi tools**: replace `read`, `write`, `edit`, `bash` with Gondolin-backed implementations that execute inside the VM (following the pattern from Gondolin's own [`pi-gondolin.ts` example](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts))
4. **Override `user_bash`**: route `!` commands through the VM
5. **Patch system prompt**: replace CWD with `/workspace` so the model sees the guest path
6. **On `session_shutdown`**: close the VM, clean up resources

### Configuration

#### Workspace-level config (`~/.taskfactory/workspaces/{id}/sandbox.json`)

```json
{
  "enabled": true,
  "allowedHosts": ["api.github.com", "registry.npmjs.org"],
  "secrets": {
    "GITHUB_TOKEN": {
      "hosts": ["api.github.com"],
      "envVar": "GITHUB_TOKEN"
    },
    "NPM_TOKEN": {
      "hosts": ["registry.npmjs.org"],
      "envVar": "NPM_TOKEN"
    }
  },
  "imagePath": null,
  "checkpointPath": null
}
```

#### Task-level override (frontmatter)

```yaml
---
id: TASK-042
title: "Implement OAuth flow"
sandbox:
  enabled: true
  allowedHosts:
    - api.github.com
    - accounts.google.com
  secrets:
    GITHUB_TOKEN:
      hosts: ["api.github.com"]
---
```

Task config merges with workspace config. Task-level `allowedHosts` extends (not replaces) the workspace list.

### New Types

```typescript
// packages/shared/src/types.ts

export interface SandboxSecretConfig {
  hosts: string[];        // which hosts this secret can be sent to
  envVar: string;         // host env var to read the real value from
}

export interface SandboxConfig {
  enabled: boolean;
  allowedHosts: string[];
  secrets: Record<string, SandboxSecretConfig>;
  imagePath?: string;     // custom guest image directory
  checkpointPath?: string; // qcow2 checkpoint to resume from
}
```

Add optional `sandbox?: Partial<SandboxConfig>` to `TaskFrontmatter`.

### Extension Code Structure

```
extensions/
  gondolin-sandbox/
    index.ts              # Pi extension entry point
```

Single file extension. The Gondolin `pi-gondolin.ts` example is ~200 lines and covers all tool overrides. Our version adds config resolution (merge workspace + task config) and conditional activation.

Key implementation details from the reference `pi-gondolin.ts`:

- **Path mapping**: `toGuestPath()` converts host absolute paths to `/workspace/...` relative paths
- **Read ops**: `cat` via `vm.exec()`, MIME detection via `file --mime-type`
- **Write ops**: base64 roundtrip to avoid shell quoting issues
- **Edit ops**: compose read + write ops
- **Bash ops**: `vm.exec(["/bin/bash", "-lc", command])` with streaming via `proc.output()`
- **Cancellation**: `AbortController` wired to Pi's signal
- **Timeout**: setTimeout-based abort

### Disk Checkpoints (Phase 2)

For workspaces that need specific tooling (Python, Rust, Go, etc.), pre-build a checkpoint:

```typescript
const base = await VM.create();
await base.exec("apk add git python3 py3-pip");
await base.exec("pip install pytest");
const checkpoint = await base.checkpoint("/path/to/dev-base.qcow2");
await base.close();

// Per-task: resume from checkpoint (cheap qcow2 overlay)
const taskVm = await checkpoint.resume({
  vfs: { mounts: { "/workspace": new RealFSProvider(workspacePath) } },
  httpHooks,
});
```

This avoids reinstalling tools on every task. The `checkpointPath` config field supports this.

## Data Flow

```
User creates task with sandbox enabled
  │
  ▼
Task moves to "executing"
  │
  ▼
agent-execution-service calls createTaskConversationSession()
  │
  ▼
DefaultResourceLoader loads extensions/gondolin-sandbox/index.ts
  │
  ▼
Extension reads sandbox config (workspace + task frontmatter)
  │
  ├── sandbox.enabled === false → do nothing, tools are host-native
  │
  └── sandbox.enabled === true
        │
        ▼
      session_start fires
        │
        ▼
      Boot Gondolin VM:
        - RealFSProvider(workspace) → /workspace
        - createHttpHooks({ allowedHosts, secrets })
        - Optional: checkpoint.resume()
        │
        ▼
      Override read/write/edit/bash tools → execute in VM
        │
        ▼
      Agent executes task inside VM
        │
        ▼
      session_shutdown fires → vm.close()
```

## UI Changes

### Workspace Settings Panel

Add a "Sandbox" tab to the workspace settings:

```
┌──────────────────────────────────────────────────────────┐
│  General | Models | Skills | Extensions | Sandbox        │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ☑ Enable Gondolin VM sandbox                            │
│                                                          │
│  Allowed Hosts:                                          │
│  ┌──────────────────────────────────────────────┐       │
│  │ api.github.com                          [×]  │       │
│  │ registry.npmjs.org                      [×]  │       │
│  │ [+ Add host]                                 │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  Secrets:                                                │
│  ┌──────────────────────────────────────────────┐       │
│  │ GITHUB_TOKEN → api.github.com           [×]  │       │
│  │ NPM_TOKEN → registry.npmjs.org          [×]  │       │
│  │ [+ Add secret]                                │       │
│  └──────────────────────────────────────────────┘       │
│                                                          │
│  Custom Image: [none]                                    │
│  Checkpoint:   [none]                                    │
│                                                          │
│  [Save]                                                  │
└──────────────────────────────────────────────────────────┘
```

### Task Detail Panel

Show sandbox status when a task is executing in a VM:

- Status indicator: "🔒 Sandboxed" or "⚠️ Unsandboxed"
- Allowed hosts list (read-only view)
- VM status (booting / running / stopped)

### Pipeline Bar

Optional badge on task cards to indicate sandboxed execution.

## Implementation Phases

### Phase 1: Core Extension (MVP)

Build the extension and prove it works end-to-end with a single task.

- [ ] Add `@earendil-works/gondolin` as optional dependency
- [ ] Create `extensions/gondolin-sandbox/index.ts`
  - [ ] Implement conditional activation (check env var `PI_FACTORY_SANDBOX=1` for MVP)
  - [ ] Boot VM on `session_start` with `RealFSProvider` for workspace
  - [ ] Override `read`/`write`/`edit`/`bash` tools (port from `pi-gondolin.ts`)
  - [ ] Override `user_bash` for `!` commands
  - [ ] Patch system prompt CWD on `before_agent_start`
  - [ ] Tear down VM on `session_shutdown`
  - [ ] Handle errors gracefully (missing QEMU → clear error message, fall back to host)
- [ ] Manual test: execute a simple task in sandbox, verify file changes land on host via VFS

### Phase 2: Configuration

Wire up per-workspace and per-task sandbox configuration.

- [ ] Add `SandboxConfig` types to `packages/shared/src/types.ts`
- [ ] Add optional `sandbox` field to `TaskFrontmatter`
- [ ] Create sandbox config service (`packages/server/src/sandbox-config-service.ts`)
  - [ ] Load workspace sandbox config from `~/.taskfactory/workspaces/{id}/sandbox.json`
  - [ ] Merge workspace + task-level config
- [ ] Update extension to read config instead of env var
- [ ] Add network policy: `createHttpHooks({ allowedHosts, secrets })`
- [ ] Add API endpoints for sandbox config CRUD

### Phase 3: UI

Add sandbox configuration UI and execution status display.

- [ ] Workspace settings: Sandbox tab (enabled toggle, allowed hosts, secrets)
- [ ] Task detail: sandbox status indicator
- [ ] Task creation form: optional sandbox override fields
- [ ] Pipeline bar: sandboxed task badge

### Phase 4: Checkpoints and Custom Images

Optimize startup time for tasks that need specific tooling.

- [ ] Support `checkpointPath` in sandbox config
- [ ] CLI or UI flow to build a checkpoint (install tools, snapshot)
- [ ] Support `imagePath` for fully custom guest images
- [ ] Document checkpoint recipes (Python dev, Node dev, Rust dev, etc.)

## Known Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Gondolin is experimental (v0.2.1)** | Breaking changes, bugs, abandonment | Keep integration as a single extension file; easy to swap out. Pin version. |
| **QEMU required on host** | Users without QEMU can't use sandbox | Sandbox is opt-in. Extension detects missing QEMU and logs a clear error. |
| **~200MB guest image download** | Slow first run | Download happens lazily on first sandboxed task. Show progress in UI. |
| **FUSE filesystem overhead** | Slower file operations | Acceptable for agent workloads (not high-throughput I/O). Profile in Phase 1. |
| **Single-command execution** | Agents may need concurrent tool calls | Pi SDK serializes tool calls per turn already. Test with real agent workloads in Phase 1. |
| **VM boot latency (<1s)** | Adds delay to task start | Negligible vs. LLM response times. Checkpoints (Phase 4) further reduce it. |
| **Secret exfiltration to allowed hosts** | Agent sends data to `api.github.com` | Documented Gondolin limitation. Use `onRequest` hooks for auditing if needed. |

## Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `@earendil-works/gondolin` | `^0.2.1` | VM lifecycle, network policy, VFS |
| `qemu-system-aarch64` / `qemu-system-x86_64` | any | VM engine (user-installed) |

## References

- [Gondolin GitHub](https://github.com/earendil-works/gondolin)
- [Gondolin Architecture](https://earendil-works.github.io/gondolin/architecture/)
- [Gondolin SDK Docs](https://earendil-works.github.io/gondolin/sdk/)
- [Gondolin Security Design](https://earendil-works.github.io/gondolin/security/)
- [Pi + Gondolin Extension Example](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts)
- [Task Factory Agent Execution Service](../packages/server/src/agent-execution-service.ts)
- [Task Factory Extension Discovery](../extensions/)
