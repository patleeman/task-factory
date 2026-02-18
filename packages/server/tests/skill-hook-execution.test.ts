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

import { runPostExecutionSkills, runPreExecutionSkills, runPrePlanningSkills } from '../src/post-execution-skills.js';

function createSession() {
  return {
    prompt: vi.fn(async (_content: string) => undefined),
    messages: [],
  };
}

describe('universal skill execution across lanes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs pre-execution skills regardless of metadata hooks', async () => {
    const session = createSession();

    await runPreExecutionSkills(session, ['checkpoint'], {
      taskId: 'TEST-1',
      workspaceId: 'workspace-1',
    });

    expect(session.prompt).toHaveBeenCalledTimes(1);
  });

  it('runs pre-planning skills regardless of metadata hooks', async () => {
    const session = createSession();

    await runPrePlanningSkills(session, ['checkpoint'], {
      taskId: 'TEST-2',
      workspaceId: 'workspace-1',
    });

    expect(session.prompt).toHaveBeenCalledTimes(1);
  });

  it('runs post-execution skills regardless of metadata hooks', async () => {
    const session = createSession();

    await runPostExecutionSkills(session, ['tdd-test-first'], {
      taskId: 'TEST-3',
      workspaceId: 'workspace-1',
    });

    expect(session.prompt).toHaveBeenCalledTimes(1);
  });
});
