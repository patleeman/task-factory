import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/activity-service.js', () => ({
  createSystemEvent: vi.fn(async (workspaceId: string, taskId: string, event: string, message: string, metadata?: Record<string, unknown>) => ({
    id: 'event-id',
    type: 'system-event',
    workspaceId,
    taskId,
    event,
    message,
    metadata,
    timestamp: new Date().toISOString(),
  })),
}));

import { runPostExecutionSkills, runPreExecutionSkills } from '../src/post-execution-skills.js';

function createSession() {
  return {
    prompt: vi.fn(async (_content: string) => undefined),
    messages: [],
  };
}

describe('hook-aware skill execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks pre-execution when a skill does not support the pre hook', async () => {
    const session = createSession();

    await expect(
      runPreExecutionSkills(session, ['checkpoint'], {
        taskId: 'TEST-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('does not support the pre-execution hook');

    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('skips post-execution skills that do not support the post hook', async () => {
    const session = createSession();

    await runPostExecutionSkills(session, ['tdd-test-first'], {
      taskId: 'TEST-2',
      workspaceId: 'workspace-1',
    });

    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('runs skills when the configured hook is supported', async () => {
    const session = createSession();

    await runPreExecutionSkills(session, ['tdd-test-first'], {
      taskId: 'TEST-3',
      workspaceId: 'workspace-1',
    });

    expect(session.prompt).toHaveBeenCalledTimes(1);
  });
});
