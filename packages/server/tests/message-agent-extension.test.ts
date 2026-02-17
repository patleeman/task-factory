import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import messageAgentExtension from '../../../extensions/message-agent.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('message_agent extension', () => {
  let tool: any;
  let mockCallbacks: any;

  beforeEach(() => {
    tool = undefined;
    mockCallbacks = {
      hasActiveSession: vi.fn(),
      steerTask: vi.fn(),
      followUpTask: vi.fn(),
      startChat: vi.fn(),
      resumeChat: vi.fn(),
    };

    messageAgentExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);

    (globalThis as any).__piFactoryMessageAgentCallbacks = new Map([['workspace-1', mockCallbacks]]);
  });

  afterEach(() => {
    delete (globalThis as any).__piFactoryMessageAgentCallbacks;
  });

  it('returns fallback when callbacks are unavailable', async () => {
    delete (globalThis as any).__piFactoryMessageAgentCallbacks;

    const result = await tool.execute(
      'tool-call-1',
      { taskId: 'TASK-1', messageType: 'chat', content: 'Hello' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('not available');
  });

  it('steers a running task agent', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(true);
    mockCallbacks.steerTask.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-2',
      { taskId: 'TASK-1', messageType: 'steer', content: 'Stop and fix the bug' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.hasActiveSession).toHaveBeenCalledWith('TASK-1');
    expect(mockCallbacks.steerTask).toHaveBeenCalledWith('TASK-1', 'Stop and fix the bug', undefined);
    expect(extractResultText(result)).toContain('Successfully steered');
  });

  it('prevents steer when no active session', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(false);

    const result = await tool.execute(
      'tool-call-3',
      { taskId: 'TASK-1', messageType: 'steer', content: 'Hello' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Cannot steer');
    expect(extractResultText(result)).toContain('no active session');
    expect(mockCallbacks.steerTask).not.toHaveBeenCalled();
  });

  it('sends follow-up to a running task agent', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(true);
    mockCallbacks.followUpTask.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-4',
      { taskId: 'TASK-1', messageType: 'follow-up', content: 'Also check the tests' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.hasActiveSession).toHaveBeenCalledWith('TASK-1');
    expect(mockCallbacks.followUpTask).toHaveBeenCalledWith('TASK-1', 'Also check the tests', undefined);
    expect(extractResultText(result)).toContain('Successfully follow-up sent to');
  });

  it('prevents follow-up when no active session', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(false);

    const result = await tool.execute(
      'tool-call-5',
      { taskId: 'TASK-1', messageType: 'follow-up', content: 'Hello' },
      undefined,
      undefined,
      {} as any,
    );

    expect(extractResultText(result)).toContain('Cannot follow-up');
    expect(extractResultText(result)).toContain('no active session');
  });

  it('sends chat message to active session as follow-up', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(true);
    mockCallbacks.followUpTask.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-6',
      { taskId: 'TASK-1', messageType: 'chat', content: 'How is it going?' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.followUpTask).toHaveBeenCalledWith('TASK-1', 'How is it going?', undefined);
    expect(extractResultText(result)).toContain('Successfully messaged');
  });

  it('resumes chat when no active session but has previous session', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(false);
    mockCallbacks.resumeChat.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-7',
      { taskId: 'TASK-1', messageType: 'chat', content: 'Continue from before' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.resumeChat).toHaveBeenCalledWith('TASK-1', 'Continue from before', undefined);
    expect(extractResultText(result)).toContain('Successfully resumed chat with');
  });

  it('starts fresh chat when no session exists', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(false);
    mockCallbacks.resumeChat.mockResolvedValue(false);
    mockCallbacks.startChat.mockResolvedValue(true);

    const result = await tool.execute(
      'tool-call-8',
      { taskId: 'TASK-1', messageType: 'chat', content: 'Start fresh' },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.resumeChat).toHaveBeenCalledWith('TASK-1', 'Start fresh', undefined);
    expect(mockCallbacks.startChat).toHaveBeenCalledWith('TASK-1', 'Start fresh', undefined);
    expect(extractResultText(result)).toContain('Successfully started chat with');
  });

  it('includes attachmentIds when provided', async () => {
    mockCallbacks.hasActiveSession.mockReturnValue(true);
    mockCallbacks.followUpTask.mockResolvedValue(true);

    await tool.execute(
      'tool-call-9',
      {
        taskId: 'TASK-1',
        messageType: 'follow-up',
        content: 'See attachment',
        attachmentIds: ['att-1', 'att-2'],
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(mockCallbacks.followUpTask).toHaveBeenCalledWith('TASK-1', 'See attachment', ['att-1', 'att-2']);
  });
});
