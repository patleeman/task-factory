import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');

function getHandleCreateTaskBlock(): string {
  const match = workspacePageSource.match(/const handleCreateTask = async \(data: CreateTaskData\) => \{[\s\S]*?\n\s{2}\}\n\n\s{2}const handleSelectTask/);
  return match?.[0] ?? '';
}

function getHandleCreateDraftTaskDirectBlock(): string {
  const match = workspacePageSource.match(/const handleCreateDraftTaskDirect = useCallback\(async \(draftTask: DraftTask\) => \{[\s\S]*?\n\s{2}\}, \[workspaceId, creatingDraftTaskIds, showToast\]\)/);
  return match?.[0] ?? '';
}

describe('create-task backlog routing regression checks', () => {
  it('does not redirect after successful task creation and keeps task-detail navigation explicit', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(handleCreateTaskBlock).toContain('const task = await api.createTask(createWorkspaceId, {');
    expect(handleCreateTaskBlock).toContain('...taskData,');
    expect(handleCreateTaskBlock).not.toContain('navigate(workspaceRootPath)');
    expect(handleCreateTaskBlock).not.toContain('navigate(`${workspaceRootPath}/tasks/${task.id}`)');
  });

  it('ignores stale create completions after workspace navigation to avoid cross-workspace UI mutations', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(workspacePageSource).toContain('const activeWorkspaceIdRef = useRef<string | null>(workspaceId ?? null)');
    expect(workspacePageSource).toContain('activeWorkspaceIdRef.current = workspaceId ?? null');
    expect(handleCreateTaskBlock).toContain('if (activeWorkspaceIdRef.current !== createWorkspaceId) {');
    expect(handleCreateTaskBlock).toContain('return');
  });

  it('applies the same stale-workspace guard for direct draft-task creation side effects', () => {
    const handleCreateDraftTaskDirectBlock = getHandleCreateDraftTaskDirectBlock();

    expect(handleCreateDraftTaskDirectBlock).toContain('const task = await api.createTask(createWorkspaceId, {');
    expect(handleCreateDraftTaskDirectBlock).toContain('if (activeWorkspaceIdRef.current !== createWorkspaceId) {');
    expect(handleCreateDraftTaskDirectBlock).toContain('showToast(`Added ${task.id} to backlog`)');
    expect(handleCreateDraftTaskDirectBlock).toContain('if (activeWorkspaceIdRef.current === createWorkspaceId) {');
    expect(handleCreateDraftTaskDirectBlock).toContain("showToast('Failed to create task from draft')");
  });

  it('preserves attachment upload behavior on create and keeps failures non-blocking', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(handleCreateTaskBlock).toContain('await api.uploadAttachments(createWorkspaceId, task.id, pendingFiles)');
    expect(handleCreateTaskBlock).toContain("console.error('Failed to upload attachments:', uploadErr)");
  });

  it('keeps new tasks in the pipeline state and opens task detail only on explicit selection', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(handleCreateTaskBlock).toContain('setTasks((prev) => {');
    expect(handleCreateTaskBlock).toContain('if (prev.some((existingTask) => existingTask.id === task.id)) {');
    expect(handleCreateTaskBlock).toContain('return [task, ...prev]');

    expect(workspacePageSource).toContain("case 'task:created':");
    expect(workspacePageSource).toContain('return [msg.task, ...prev]');
    expect(workspacePageSource).toContain('const handleSelectTask = useCallback((task: Task) => {');
    expect(workspacePageSource).toContain('navigate(`${workspaceRootPath}/tasks/${task.id}`)');
  });
});
