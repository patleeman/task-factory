import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import manageTasksExtension from '../../../extensions/manage-tasks.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('manage_tasks extension', () => {
  let tool: any;
  let mockCallbacks: any;

  beforeEach(() => {
    tool = undefined;
    mockCallbacks = {
      listTasks: vi.fn(),
      getTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      moveTask: vi.fn(),
      getPromotePhase: vi.fn(),
      getDemotePhase: vi.fn(),
    };

    manageTasksExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);

    (globalThis as any).__piFactoryTaskCallbacks = new Map([['workspace-1', mockCallbacks]]);
  });

  afterEach(() => {
    delete (globalThis as any).__piFactoryTaskCallbacks;
  });

  it('returns fallback when callbacks are unavailable', async () => {
    delete (globalThis as any).__piFactoryTaskCallbacks;

    const result = await tool.execute(
      'tool-call-1',
      { action: 'list' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('not available');
  });

  it('lists tasks grouped by phase', async () => {
    mockCallbacks.listTasks.mockResolvedValue([
      {
        id: 'TASK-1',
        frontmatter: { title: 'First task', phase: 'ready', priority: 'high' },
      },
      {
        id: 'TASK-2',
        frontmatter: { title: 'Second task', phase: 'backlog' },
      },
    ]);

    const result = await tool.execute(
      'tool-call-2',
      { action: 'list' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.listTasks).toHaveBeenCalled();
    const text = extractResultText(result);
    expect(text).toContain('TASK-1');
    expect(text).toContain('TASK-2');
    expect(text).toContain('ready');
    expect(text).toContain('backlog');
  });

  it('gets a specific task with full details', async () => {
    mockCallbacks.getTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: {
        title: 'Test task',
        phase: 'executing',
        priority: 'high',
        acceptanceCriteria: [
          { text: 'Criterion 1', met: true },
          { text: 'Criterion 2', met: false },
        ],
      },
      content: 'Task description here',
    });

    const result = await tool.execute(
      'tool-call-3',
      { action: 'get', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.getTask).toHaveBeenCalledWith('TASK-1');
    const text = extractResultText(result);
    expect(text).toContain('TASK-1');
    expect(text).toContain('Test task');
    expect(text).toContain('executing');
  });

  it('returns error when task not found', async () => {
    mockCallbacks.getTask.mockResolvedValue(null);

    const result = await tool.execute(
      'tool-call-4',
      { action: 'get', taskId: 'TASK-NONEXISTENT' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('not found');
  });

  it('updates a task without changing phase', async () => {
    mockCallbacks.updateTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { title: 'Updated title', phase: 'ready' },
    });

    const result = await tool.execute(
      'tool-call-5',
      {
        action: 'update',
        taskId: 'TASK-1',
        updates: { title: 'Updated title', priority: 'low' },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.updateTask).toHaveBeenCalledWith('TASK-1', {
      title: 'Updated title',
      priority: 'low',
    });
    expect(extractResultText(result)).toContain('Updated');
  });

  it('requires updates for update action', async () => {
    const result = await tool.execute(
      'tool-call-6',
      { action: 'update', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('updates object is required');
  });

  it('deletes a task', async () => {
    mockCallbacks.deleteTask.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-7',
      { action: 'delete', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.deleteTask).toHaveBeenCalledWith('TASK-1');
    expect(extractResultText(result)).toContain('Deleted');
  });

  it('moves a task to a specific phase', async () => {
    mockCallbacks.moveTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { title: 'Task', phase: 'executing' },
    });

    const result = await tool.execute(
      'tool-call-8',
      { action: 'move', taskId: 'TASK-1', toPhase: 'executing' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.moveTask).toHaveBeenCalledWith('TASK-1', 'executing');
    expect(extractResultText(result)).toContain('Moved');
  });

  it('promotes a task to the next phase', async () => {
    mockCallbacks.getTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { phase: 'ready' },
    });
    mockCallbacks.getPromotePhase.mockReturnValue('executing');
    mockCallbacks.moveTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { phase: 'executing' },
    });

    const result = await tool.execute(
      'tool-call-9',
      { action: 'promote', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.getPromotePhase).toHaveBeenCalledWith('ready');
    expect(mockCallbacks.moveTask).toHaveBeenCalledWith('TASK-1', 'executing');
    expect(extractResultText(result)).toContain('Promoted');
    expect(extractResultText(result)).toContain('ready to executing');
  });

  it('demotes a task to the previous phase', async () => {
    mockCallbacks.getTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { phase: 'executing' },
    });
    mockCallbacks.getDemotePhase.mockReturnValue('ready');
    mockCallbacks.moveTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { phase: 'ready' },
    });

    const result = await tool.execute(
      'tool-call-10',
      { action: 'demote', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.getDemotePhase).toHaveBeenCalledWith('executing');
    expect(mockCallbacks.moveTask).toHaveBeenCalledWith('TASK-1', 'ready');
    expect(extractResultText(result)).toContain('Demoted');
    expect(extractResultText(result)).toContain('executing to ready');
  });

  it('prevents promote when at final phase', async () => {
    mockCallbacks.getTask.mockResolvedValue({
      id: 'TASK-1',
      frontmatter: { phase: 'complete' },
    });
    mockCallbacks.getPromotePhase.mockReturnValue(null);

    const result = await tool.execute(
      'tool-call-11',
      { action: 'promote', taskId: 'TASK-1' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Cannot promote');
    expect(extractResultText(result)).toContain('already at final phase');
  });
});
