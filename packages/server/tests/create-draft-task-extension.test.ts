import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createDraftTaskExtension from '../../../extensions/create-draft-task.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('create_draft_task extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    createDraftTaskExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    const globalObj = globalThis as any;
    delete globalObj.__piFactoryShelfCallbacks;
  });

  it('returns a fallback message when planning callbacks are unavailable', async () => {
    const result = await tool.execute(
      'tool-call-1',
      {
        title: 'Refactor planning chat',
        content: 'Move draft tasks inline in chat.',
        acceptance_criteria: ['Inline cards render in chat'],
        plan: {
          goal: 'Support inline draft task cards.',
          steps: ['Store payload in planning messages'],
          validation: ['Cards render with click handlers'],
          cleanup: [],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('callbacks not available');
    expect(result.details).toEqual({});
  });

  it('returns draft-task payload details for inline chat rendering', async () => {
    const createDraftTask = vi.fn().mockResolvedValue({
      id: 'draft-inline-1234',
      title: 'Refactor planning chat',
      content: 'Move draft tasks inline in chat.',
      acceptanceCriteria: ['Inline cards render in chat'],
      plan: {
        goal: 'Support inline draft task cards.',
        steps: ['Store payload in planning messages'],
        validation: ['Cards render with click handlers'],
        cleanup: [],
        generatedAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    });

    (globalThis as any).__piFactoryShelfCallbacks = new Map([
      ['workspace-1', {
        createDraftTask,
        createArtifact: vi.fn(),
      }],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        title: 'Refactor planning chat',
        content: 'Move draft tasks inline in chat.',
        acceptance_criteria: ['Inline cards render in chat'],
        plan: {
          goal: 'Support inline draft task cards.',
          steps: ['Store payload in planning messages'],
          validation: ['Cards render with click handlers'],
          cleanup: [],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createDraftTask).toHaveBeenCalledWith({
      title: 'Refactor planning chat',
      content: 'Move draft tasks inline in chat.',
      acceptance_criteria: ['Inline cards render in chat'],
      plan: {
        goal: 'Support inline draft task cards.',
        steps: ['Store payload in planning messages'],
        validation: ['Cards render with click handlers'],
        cleanup: [],
      },
    });

    expect(result.details).toMatchObject({
      draftTask: {
        id: 'draft-inline-1234',
        title: 'Refactor planning chat',
        content: 'Move draft tasks inline in chat.',
        acceptanceCriteria: ['Inline cards render in chat'],
      },
    });
  });
});
