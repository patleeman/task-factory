import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { IdeaBacklog, PlanningMessage, Shelf } from '@pi-factory/shared';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempRoots: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = createTempDir('pi-factory-home-');
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

function registerWorkspace(homePath: string, workspaceId: string, workspacePath: string): void {
  const registryDir = join(homePath, '.taskfactory');
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(
    join(registryDir, 'workspaces.json'),
    JSON.stringify([{ id: workspaceId, path: workspacePath, name: 'workspace' }], null, 2),
    'utf-8',
  );
}

function writeWorkspaceConfig(workspacePath: string): void {
  const piDir = join(workspacePath, '.pi');
  mkdirSync(piDir, { recursive: true });

  writeFileSync(
    join(piDir, 'factory.json'),
    JSON.stringify({
      taskLocations: ['.pi/tasks'],
      defaultTaskLocation: '.pi/tasks',
      wipLimits: {},
      gitIntegration: {
        enabled: true,
        defaultBranch: 'main',
        branchPrefix: 'feat/',
      },
    }, null, 2),
    'utf-8',
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('resetPlanningSession', () => {
  it('archives messages, clears active history, clears legacy shelf data, and broadcasts reset events', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');
    const workspaceId = 'ws-reset';
    const oldSessionId = 'session-old';
    const now = new Date().toISOString();

    writeWorkspaceConfig(workspacePath);
    registerWorkspace(homePath, workspaceId, workspacePath);

    const piDir = join(workspacePath, '.pi');
    const taskfactoryDir = join(workspacePath, '.taskfactory');

    const oldMessages: PlanningMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Please plan this work',
        timestamp: now,
        sessionId: oldSessionId,
      },
    ];

    const artifact = {
      id: 'artifact-1',
      name: 'Architecture Notes',
      html: '<html><body>notes</body></html>',
      createdAt: now,
    };

    const initialShelf: Shelf = {
      items: [
        {
          type: 'draft-task',
          item: {
            id: 'draft-1',
            title: 'Draft one',
            content: 'First draft',
            acceptanceCriteria: ['one'],
            createdAt: now,
          },
        },
        {
          type: 'artifact',
          item: artifact,
        },
        {
          type: 'draft-task',
          item: {
            id: 'draft-2',
            title: 'Draft two',
            content: 'Second draft',
            acceptanceCriteria: ['two'],
            createdAt: now,
          },
        },
      ],
    };

    const initialIdeaBacklog: IdeaBacklog = {
      items: [
        {
          id: 'idea-1',
          text: 'Remember to improve onboarding copy',
          createdAt: now,
        },
      ],
    };

    writeFileSync(join(piDir, 'planning-session-id.txt'), oldSessionId, 'utf-8');
    writeFileSync(join(piDir, 'planning-messages.json'), JSON.stringify(oldMessages, null, 2), 'utf-8');
    writeFileSync(join(piDir, 'shelf.json'), JSON.stringify(initialShelf, null, 2), 'utf-8');
    writeFileSync(join(piDir, 'idea-backlog.json'), JSON.stringify(initialIdeaBacklog, null, 2), 'utf-8');

    const { resetPlanningSession } = await import('../src/planning-agent-service.js');
    const { getShelf } = await import('../src/shelf-service.js');
    const { getIdeaBacklog } = await import('../src/idea-backlog-service.js');

    const events: any[] = [];
    const newSessionId = await resetPlanningSession(workspaceId, (event) => events.push(event));

    expect(newSessionId).toBeTruthy();
    expect(newSessionId).not.toBe(oldSessionId);

    expect(readFileSync(join(taskfactoryDir, 'planning-session-id.txt'), 'utf-8').trim()).toBe(newSessionId);
    expect(JSON.parse(readFileSync(join(taskfactoryDir, 'planning-messages.json'), 'utf-8'))).toEqual([]);

    const archivePath = join(taskfactoryDir, 'planning-sessions', `${oldSessionId}.json`);
    expect(existsSync(archivePath)).toBe(true);
    expect(JSON.parse(readFileSync(archivePath, 'utf-8'))).toEqual(oldMessages);

    const shelfInMemory = await getShelf(workspaceId);
    expect(shelfInMemory.items).toEqual([]);

    const shelfOnDisk = JSON.parse(readFileSync(join(taskfactoryDir, 'shelf.json'), 'utf-8')) as Shelf;
    expect(shelfOnDisk.items).toEqual([]);

    const ideaBacklogInMemory = await getIdeaBacklog(workspaceId);
    expect(ideaBacklogInMemory).toEqual(initialIdeaBacklog);

    const ideaBacklogOnDisk = JSON.parse(readFileSync(join(taskfactoryDir, 'idea-backlog.json'), 'utf-8')) as IdeaBacklog;
    expect(ideaBacklogOnDisk).toEqual(initialIdeaBacklog);

    const resetEvent = events.find((event) => event.type === 'planning:session_reset');
    expect(resetEvent).toEqual({
      type: 'planning:session_reset',
      workspaceId,
      sessionId: newSessionId,
    });

    const shelfUpdatedEvent = events.find((event) => event.type === 'shelf:updated');
    expect(shelfUpdatedEvent).toEqual({
      type: 'shelf:updated',
      workspaceId,
      shelf: { items: [] },
    });

    // Simulate reload: clear module cache and fetch shelf again from disk.
    vi.resetModules();
    const { getShelf: getShelfAfterReload } = await import('../src/shelf-service.js');
    const { getIdeaBacklog: getIdeaBacklogAfterReload } = await import('../src/idea-backlog-service.js');
    const shelfAfterReload = await getShelfAfterReload(workspaceId);
    expect(shelfAfterReload.items).toEqual([]);

    const ideaBacklogAfterReload = await getIdeaBacklogAfterReload(workspaceId);
    expect(ideaBacklogAfterReload).toEqual(initialIdeaBacklog);
  });
});
