import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('subagent skill dispatch', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempDirs: string[] = [];

  afterAll(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dispatches a subagent skill as a single prompt turn (not a loop)', async () => {
    // Set up a temp home with a subagent skill
    const homePath = mkdtempSync(join(tmpdir(), 'pi-factory-home-'));
    tempDirs.push(homePath);
    process.env.HOME = homePath;
    process.env.USERPROFILE = homePath;

    const skillDir = join(homePath, '.taskfactory', 'skills', 'delegate-task');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: delegate-task
description: Delegates to a subagent
metadata:
  type: subagent
  hooks: post
---

Use message_agent to delegate this task to a subagent.
`);

    vi.resetModules();
    const { runPostExecutionSkills: runSkills, reloadPostExecutionSkills } = await import('../src/post-execution-skills.js');
    reloadPostExecutionSkills();

    const session = createSession();
    await runSkills(session, ['delegate-task'], {
      taskId: 'TEST-SUB-1',
      workspaceId: 'workspace-1',
    });

    // Subagent skill runs exactly once (single-turn), never loops
    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Use message_agent to delegate this task to a subagent.'),
    );
  });
});
