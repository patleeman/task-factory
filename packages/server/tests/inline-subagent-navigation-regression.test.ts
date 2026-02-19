/**
 * Regression tests for inline subagent chat navigation (PIFA-176).
 *
 * Verifies:
 * 1. message_agent 'chat' action returns targetTaskId in tool result details.
 * 2. Server-side planning and execution services extract and persist subagentTargetTaskId.
 * 3. TaskChat renders InlineSubagentWidget for message_agent entries with subagentTargetTaskId.
 * 4. WorkspacePage wires onOpenSubagent, subagentView state, Back control,
 *    and routes messages to the active conversation target (parent or subagent).
 * 5. Navigation never creates or switches to a different task route.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

const messageAgentPath = resolve(currentDir, '../../../extensions/message-agent.ts');
const planningServicePath = resolve(currentDir, '../src/planning-agent-service.ts');
const agentExecutionPath = resolve(currentDir, '../src/agent-execution-service.ts');
const planningStreamPath = resolve(currentDir, '../../client/src/hooks/usePlanningStreaming.ts');
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');

const messageAgentSource = readFileSync(messageAgentPath, 'utf-8');
const planningServiceSource = readFileSync(planningServicePath, 'utf-8');
const agentExecutionSource = readFileSync(agentExecutionPath, 'utf-8');
const planningStreamSource = readFileSync(planningStreamPath, 'utf-8');
const taskChatSource = readFileSync(taskChatPath, 'utf-8');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');

// ─── Helper: extract a named block from source ────────────────────────────────

function getSubagentWidgetBlock(): string {
  const start = taskChatSource.indexOf('const InlineSubagentWidget');
  const end = taskChatSource.indexOf('\n// ─', start + 1);
  return start >= 0 && end > start ? taskChatSource.slice(start, end) : taskChatSource;
}

function getSubagentViewBlock(): string {
  const start = workspacePageSource.indexOf('subagentView ?');
  const end = workspacePageSource.indexOf('/* Parent task view */', start);
  return start >= 0 && end > start ? workspacePageSource.slice(start, end) : '';
}

function getParentTaskViewBlock(): string {
  const start = workspacePageSource.indexOf('/* Parent task view */');
  // Find the closing of the parent task view block — ends before the closing div of the outer flex
  const closingBracket = workspacePageSource.indexOf('</>\n                )}\n              </div>', start);
  if (start >= 0 && closingBracket > start) {
    return workspacePageSource.slice(start, closingBracket);
  }
  // Fallback: take a wide slice after the start marker
  return start >= 0 ? workspacePageSource.slice(start, start + 2000) : '';
}

function getHandleOpenSubagentBlock(): string {
  const start = workspacePageSource.indexOf('const handleOpenSubagent');
  const end = workspacePageSource.indexOf('\n  const handleCloseSubagent', start);
  return start >= 0 && end > start ? workspacePageSource.slice(start, end) : '';
}

function getHandleCloseSubagentBlock(): string {
  const start = workspacePageSource.indexOf('const handleCloseSubagent');
  const end = workspacePageSource.indexOf('\n  //', start + 1);
  return start >= 0 && end > start ? workspacePageSource.slice(start, end) : '';
}

// ─── 1. message_agent extension ──────────────────────────────────────────────

describe('message_agent extension — subagent ref in tool result', () => {
  it("includes targetTaskId in details when messageType is 'chat' and result is successful", () => {
    expect(messageAgentSource).toContain("messageType === 'chat'");
    expect(messageAgentSource).toContain('targetTaskId: taskId');
  });

  it('targetTaskId is only included when messageType is chat (not steer or follow-up)', () => {
    // The ternary guard ensures only chat actions expose the targetTaskId
    expect(messageAgentSource).toContain("messageType === 'chat'");
    // targetTaskId is in the truthy branch
    const guardIdx = messageAgentSource.indexOf("messageType === 'chat'");
    const targetIdx = messageAgentSource.indexOf('targetTaskId: taskId', guardIdx);
    expect(targetIdx).toBeGreaterThan(guardIdx);
    // The falsy branch is empty — confirmed by presence of the empty-object fallback
    expect(messageAgentSource).toContain('? { targetTaskId: taskId }');
  });
});

// ─── 2. Server extraction (planning + execution) ──────────────────────────────

describe('server — extracts and persists subagentTargetTaskId from tool results', () => {
  it('planning service defines extractSubagentRefFromToolResult', () => {
    expect(planningServiceSource).toContain('function extractSubagentRefFromToolResult');
    expect(planningServiceSource).toContain("if (toolName !== 'message_agent') return undefined");
    expect(planningServiceSource).toContain('details.targetTaskId');
  });

  it('planning service includes subagentTargetTaskId in tool message metadata', () => {
    expect(planningServiceSource).toContain(
      "const subagentTargetTaskId = event.isError ? undefined : extractSubagentRefFromToolResult(event.toolName, event.result);"
    );
    expect(planningServiceSource).toContain('subagentTargetTaskId,');
  });

  it('execution service defines extractSubagentRefFromToolResult', () => {
    expect(agentExecutionSource).toContain('function extractSubagentRefFromToolResult');
    expect(agentExecutionSource).toContain("if (toolName !== 'message_agent') return undefined");
  });

  it('execution service includes subagentTargetTaskId in activity entry metadata', () => {
    expect(agentExecutionSource).toContain('const subagentTargetTaskId = event.isError');
    expect(agentExecutionSource).toContain('subagentTargetTaskId,');
  });
});

// ─── 3. usePlanningStreaming passes subagentTargetTaskId through ──────────────

describe('usePlanningStreaming — forwards subagentTargetTaskId metadata', () => {
  it('includes subagentTargetTaskId in messagesToEntries metadata spread', () => {
    expect(planningStreamSource).toContain('subagentTargetTaskId: msg.metadata?.subagentTargetTaskId');
  });
});

// ─── 4. TaskChat — inline subagent widget ────────────────────────────────────

describe('TaskChat — InlineSubagentWidget rendering and onOpenSubagent prop', () => {
  it('defines InlineSubagentWidget component with targetTaskId and onOpen props', () => {
    const block = getSubagentWidgetBlock();
    expect(block).toContain('const InlineSubagentWidget');
    expect(block).toContain('targetTaskId');
    expect(block).toContain('onOpen');
  });

  it('InlineSubagentWidget has "Subagent Chat" label for clear identification', () => {
    const block = getSubagentWidgetBlock();
    expect(block).toContain('Subagent Chat');
  });

  it('InlineSubagentWidget renders "View conversation" button as clickable affordance', () => {
    const block = getSubagentWidgetBlock();
    expect(block).toContain('View conversation');
    expect(block).toContain('onClick');
    expect(block).toContain('onOpen(targetTaskId)');
  });

  it('TaskChat has onOpenSubagent prop wired into interface', () => {
    expect(taskChatSource).toContain('onOpenSubagent?: (subagentTaskId: string) => void');
  });

  it('TaskChat renders InlineSubagentWidget when toolName is message_agent and subagentTargetTaskId is set', () => {
    expect(taskChatSource).toContain("toolName === 'message_agent'");
    expect(taskChatSource).toContain('subagentTargetTaskId');
    expect(taskChatSource).toContain('<InlineSubagentWidget');
    expect(taskChatSource).toContain('onOpen={onOpenSubagent}');
  });

  it('InlineSubagentWidget is only shown when not an error (same guard as draft tasks)', () => {
    const idx = taskChatSource.indexOf("toolName === 'message_agent'");
    // Find the closing brace of the if block — look for PersistedToolBlock which follows
    const endIdx = taskChatSource.indexOf('return (\n                  <PersistedToolBlock', idx);
    const block = taskChatSource.slice(idx, endIdx > idx ? endIdx : idx + 300);
    expect(block).toContain('!Boolean(meta.isError)');
  });
});

// ─── 5. WorkspacePage — in-place navigation without task switch ───────────────

describe('WorkspacePage — subagent in-place navigation state and handlers', () => {
  it('declares subagentView and subagentActivity state variables', () => {
    expect(workspacePageSource).toContain('const [subagentView, setSubagentView]');
    expect(workspacePageSource).toContain('const [subagentActivity, setSubagentActivity]');
  });

  it('uses a ref to avoid stale-closure issues in the WebSocket handler', () => {
    expect(workspacePageSource).toContain('const subagentViewRef = useRef');
    expect(workspacePageSource).toContain('subagentViewRef.current = subagentView');
    expect(workspacePageSource).toContain('const currentSubagentView = subagentViewRef.current');
  });

  it('resets subagent view when switching parent tasks', () => {
    const idx = workspacePageSource.indexOf('Reset subagent view when navigating');
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = workspacePageSource.slice(idx, idx + 200);
    expect(block).toContain('setSubagentView(null)');
    expect(block).toContain('setSubagentActivity([])');
    expect(block).toContain('[taskId]');
  });

  it('handleOpenSubagent loads subagent activity and sets subagentView', () => {
    const block = getHandleOpenSubagentBlock();
    expect(block).toContain('setSubagentView({ taskId: subagentTaskId })');
    expect(block).toContain('api.getTaskActivity');
    // Activity is set inside a functional updater to guard against stale results
    expect(block).toContain('setSubagentActivity((prev) => {');
    expect(block).toContain('sorted');
  });

  it('handleOpenSubagent guards against stale fetch results when switching subagents rapidly', () => {
    const block = getHandleOpenSubagentBlock();
    // The stale-result guard checks the ref before applying fetched data
    expect(block).toContain('subagentViewRef.current?.taskId !== subagentTaskId');
    expect(block).toContain('return prev');
  });

  it('handleCloseSubagent clears subagentView and subagentActivity', () => {
    const block = getHandleCloseSubagentBlock();
    expect(block).toContain('setSubagentView(null)');
    expect(block).toContain('setSubagentActivity([])');
  });

  it('live activity:entry events for the subagent task update subagentActivity', () => {
    expect(workspacePageSource).toContain("entry.taskId === currentSubagentView.taskId");
    expect(workspacePageSource).toContain('setSubagentActivity((prev) => {');
  });
});

// ─── 6. Back button and subagent view header ──────────────────────────────────

describe('WorkspacePage — subagent view UI: Back button and header', () => {
  it('Back button calls handleCloseSubagent and is at the top-left', () => {
    const block = getSubagentViewBlock();
    expect(block).toContain('onClick={handleCloseSubagent}');
    expect(block).toContain('Back');
    // Must appear before the main content
    const backIdx = block.indexOf('handleCloseSubagent');
    const chatIdx = block.indexOf('<TaskChat');
    expect(backIdx).toBeLessThan(chatIdx);
  });

  it('subagent view header shows "Subagent" label for clear identification', () => {
    const block = getSubagentViewBlock();
    expect(block).toContain('Subagent');
  });

  it('subagent view TaskChat uses the subagent taskId for messages, not the parent route taskId', () => {
    const block = getSubagentViewBlock();
    expect(block).toContain('subagentView.taskId');
    // Message handlers must use subagentView.taskId
    expect(block).toContain('handleSendMessage(subagentView.taskId');
    expect(block).toContain('handleSteer(subagentView.taskId');
    expect(block).toContain('handleFollowUp(subagentView.taskId');
  });

  it('subagent view TaskChat uses subagentActivity (not parent activity)', () => {
    const block = getSubagentViewBlock();
    expect(block).toContain('entries={subagentActivity}');
  });

  it('subagent view TaskChat uses subagentAgentStream for live streaming', () => {
    const block = getSubagentViewBlock();
    expect(block).toContain('agentStream={subagentAgentStream}');
  });
});

// ─── 7. Same-task-context invariants ─────────────────────────────────────────

describe('WorkspacePage — same-task-context invariants (no task switch)', () => {
  it('parent task view passes onOpenSubagent (not navigate-to-task) as the handler', () => {
    const block = getParentTaskViewBlock();
    expect(block).toContain('onOpenSubagent={handleOpenSubagent}');
  });

  it('subagentView uses in-place state (setSubagentView) rather than navigate()', () => {
    const block = getHandleOpenSubagentBlock();
    // Should set state, NOT call navigate()
    expect(block).toContain('setSubagentView');
    expect(block).not.toContain('navigate(');
  });

  it('handleCloseSubagent uses state (setSubagentView) rather than navigate()', () => {
    const block = getHandleCloseSubagentBlock();
    expect(block).toContain('setSubagentView(null)');
    expect(block).not.toContain('navigate(');
  });

  it('useAgentStreaming for subagent is separate from the parent task stream', () => {
    expect(workspacePageSource).toContain(
      'const subagentAgentStream = useAgentStreaming(subagentView?.taskId ?? null, subscribe)'
    );
  });
});
