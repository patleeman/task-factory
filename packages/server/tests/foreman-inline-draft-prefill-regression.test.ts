import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const createTaskPanePath = resolve(currentDir, '../../client/src/components/CreateTaskPane.tsx');

const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const createTaskPaneSource = readFileSync(createTaskPanePath, 'utf-8');

describe('foreman inline draft-task prefill regression checks', () => {
  it('wires inline draft-task opens to the New Task pane prefill flow', () => {
    expect(workspacePageSource).toContain('function formatDraftTaskForNewTaskForm');
    expect(workspacePageSource).toContain('setNewTaskPrefill({');
    expect(workspacePageSource).toContain('onOpenDraftTask={handleOpenDraftTask}');
    expect(workspacePageSource).toContain('prefillRequest={newTaskPrefill}');
  });

  it('keeps manage_new_task collaboration syncing into the open New Task form', () => {
    expect(workspacePageSource).toContain("case 'planning:task_form_updated':");
    expect(workspacePageSource).toContain('setAgentTaskFormUpdates(msg.formState)');
    expect(createTaskPaneSource).toContain('agentFormUpdates?: Partial<NewTaskFormState> | null');
    expect(createTaskPaneSource).toContain('prefillRequest?: { id: string; formState: Partial<NewTaskFormState>; sourceDraftId?: string } | null');
    expect(createTaskPaneSource).toContain('sourceDraftId: prefillRequest?.sourceDraftId');
  });
});
