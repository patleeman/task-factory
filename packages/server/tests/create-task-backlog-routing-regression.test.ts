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

describe('create-task backlog routing regression checks', () => {
  it('returns to foreman after successful task creation instead of auto-opening task detail', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(handleCreateTaskBlock).toContain('const task = await api.createTask(workspaceId, taskData)');
    expect(handleCreateTaskBlock).toContain('navigate(workspaceRootPath)');
    expect(handleCreateTaskBlock).not.toContain('navigate(`${workspaceRootPath}/tasks/${task.id}`)');
  });

  it('preserves attachment upload behavior on create and keeps failures non-blocking', () => {
    const handleCreateTaskBlock = getHandleCreateTaskBlock();

    expect(handleCreateTaskBlock).toContain('await api.uploadAttachments(workspaceId, task.id, pendingFiles)');
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
