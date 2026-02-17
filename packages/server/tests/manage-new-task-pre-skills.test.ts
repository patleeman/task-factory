import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import manageNewTaskExtension from '../../../extensions/manage-new-task.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('manage_new_task extension - pre-skills support', () => {
  let tool: any;
  let mockCallbacks: any;

  beforeEach(() => {
    tool = undefined;
    mockCallbacks = {
      getFormState: vi.fn(),
      updateFormState: vi.fn(),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      getAvailableSkills: vi.fn().mockReturnValue([]),
    };

    manageNewTaskExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);

    (globalThis as any).__piFactoryTaskFormCallbacks = new Map([['workspace-1', mockCallbacks]]);
  });

  afterEach(() => {
    delete (globalThis as any).__piFactoryTaskFormCallbacks;
  });

  it('reads pre-execution skills in get action', async () => {
    mockCallbacks.getFormState.mockReturnValue({
      content: 'Test content',
      selectedSkillIds: ['checkpoint', 'code-review'],
      selectedPreSkillIds: ['security-review', 'tdd'],
      planningModelConfig: null,
      executionModelConfig: null,
    });

    const result = await tool.execute(
      'tool-call-1',
      { action: 'get' },
      undefined,
      undefined,
      {} as any,
    );

    const text = extractResultText(result);
    expect(text).toContain('Selected Post-Execution Skills');
    expect(text).toContain('checkpoint, code-review');
    expect(text).toContain('Selected Pre-Execution Skills');
    expect(text).toContain('security-review, tdd');
  });

  it('updates pre-execution skills via selectedPreSkillIds', async () => {
    mockCallbacks.updateFormState.mockReturnValue('Form updated successfully.');

    const result = await tool.execute(
      'tool-call-2',
      {
        action: 'update',
        updates: {
          content: 'Updated content',
          selectedPreSkillIds: ['security-review'],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.updateFormState).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Updated content',
        selectedPreSkillIds: ['security-review'],
      }),
    );
    expect(extractResultText(result)).toContain('Form updated successfully');
  });

  it('can update both pre and post skills together', async () => {
    mockCallbacks.updateFormState.mockReturnValue('Updated.');

    await tool.execute(
      'tool-call-3',
      {
        action: 'update',
        updates: {
          selectedSkillIds: ['checkpoint'],
          selectedPreSkillIds: ['tdd', 'security-review'],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.updateFormState).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedSkillIds: ['checkpoint'],
        selectedPreSkillIds: ['tdd', 'security-review'],
      }),
    );
  });

  it('shows empty state for skills when none selected', async () => {
    mockCallbacks.getFormState.mockReturnValue({
      content: 'Test',
      selectedSkillIds: [],
      selectedPreSkillIds: [],
    });

    const result = await tool.execute(
      'tool-call-4',
      { action: 'get' },
      undefined,
      undefined,
      {} as any,
    );

    const text = extractResultText(result);
    expect(text).toContain('Selected Post-Execution Skills:** (none)');
    expect(text).toContain('Selected Pre-Execution Skills:** (none)');
  });
});
