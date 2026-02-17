import { describe, expect, it } from 'vitest';
import type { Phase } from '@task-factory/shared';
import { buildWorkspaceAttentionSummary } from '../src/workspace-attention.js';

describe('buildWorkspaceAttentionSummary', () => {
  it('counts only awaiting-input sessions whose tasks are still in executing', () => {
    const phaseByWorkspace = new Map<string, Map<string, Phase>>([
      ['ws-a', new Map<string, Phase>([
        ['PIFA-1', 'executing'],
        ['PIFA-2', 'ready'],
      ])],
      ['ws-b', new Map<string, Phase>([
        ['PIFA-3', 'executing'],
      ])],
    ]);

    const summary = buildWorkspaceAttentionSummary(
      ['ws-a', 'ws-b'],
      phaseByWorkspace,
      [
        { workspaceId: 'ws-a', taskId: 'PIFA-1', awaitingUserInput: true },
        { workspaceId: 'ws-a', taskId: 'PIFA-2', awaitingUserInput: true },
        { workspaceId: 'ws-a', taskId: 'PIFA-1', awaitingUserInput: false },
        { workspaceId: 'ws-b', taskId: 'PIFA-3', awaitingUserInput: true },
        { workspaceId: 'ws-b', taskId: 'PIFA-999', awaitingUserInput: true },
      ],
    );

    expect(summary).toEqual([
      { workspaceId: 'ws-a', awaitingInputCount: 1 },
      { workspaceId: 'ws-b', awaitingInputCount: 1 },
    ]);
  });

  it('returns zero counts for workspaces without awaiting-input sessions', () => {
    const summary = buildWorkspaceAttentionSummary(
      ['ws-a', 'ws-b'],
      new Map<string, Map<string, Phase>>(),
      [
        { workspaceId: 'ws-a', taskId: 'PIFA-1', awaitingUserInput: true },
      ],
    );

    expect(summary).toEqual([
      { workspaceId: 'ws-a', awaitingInputCount: 0 },
      { workspaceId: 'ws-b', awaitingInputCount: 0 },
    ]);
  });

  it('preserves counts when active phase maps omit many archived tasks', () => {
    const phaseByWorkspace = new Map<string, Map<string, Phase>>([
      ['ws-a', new Map<string, Phase>([
        ['PIFA-1', 'executing'],
        ['PIFA-2', 'ready'],
      ])],
    ]);

    const archivedSessions = Array.from({ length: 500 }, (_value, index) => ({
      workspaceId: 'ws-a',
      taskId: `PIFA-A-${index + 1}`,
      awaitingUserInput: true,
    }));

    const summary = buildWorkspaceAttentionSummary(
      ['ws-a'],
      phaseByWorkspace,
      [
        { workspaceId: 'ws-a', taskId: 'PIFA-1', awaitingUserInput: true },
        { workspaceId: 'ws-a', taskId: 'PIFA-2', awaitingUserInput: true },
        ...archivedSessions,
      ],
    );

    expect(summary).toEqual([
      { workspaceId: 'ws-a', awaitingInputCount: 1 },
    ]);
  });
});
