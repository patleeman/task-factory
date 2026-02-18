import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { IdeaBacklog } from '@task-factory/shared';

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

function registerWorkspaces(homePath: string, workspaces: Array<{ id: string; path: string; name: string }>): void {
  const registryDir = join(homePath, '.taskfactory');
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(join(registryDir, 'workspaces.json'), JSON.stringify(workspaces, null, 2), 'utf-8');
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

describe('idea backlog service', () => {
  it('stores ideas per workspace and persists add/remove/reorder operations', async () => {
    const homePath = setTempHome();
    const workspacePathA = createTempDir('pi-factory-workspace-a-');
    const workspacePathB = createTempDir('pi-factory-workspace-b-');

    writeWorkspaceConfig(workspacePathA);
    writeWorkspaceConfig(workspacePathB);

    registerWorkspaces(homePath, [
      { id: 'ws-a', path: workspacePathA, name: 'workspace-a' },
      { id: 'ws-b', path: workspacePathB, name: 'workspace-b' },
    ]);

    const {
      addIdeaBacklogItem,
      removeIdeaBacklogItem,
      reorderIdeaBacklogItems,
      getIdeaBacklog,
    } = await import('../src/idea-backlog-service.js');

    await addIdeaBacklogItem('ws-a', 'First idea');
    await addIdeaBacklogItem('ws-a', 'Second idea');
    await addIdeaBacklogItem('ws-b', 'Workspace B idea');

    const backlogA = await getIdeaBacklog('ws-a');
    expect(backlogA.items.map((item) => item.text)).toEqual(['First idea', 'Second idea']);

    const reorderedIds = [backlogA.items[1].id, backlogA.items[0].id];
    const reorderedA = await reorderIdeaBacklogItems('ws-a', reorderedIds);
    expect(reorderedA.items.map((item) => item.text)).toEqual(['Second idea', 'First idea']);

    const afterRemove = await removeIdeaBacklogItem('ws-a', reorderedA.items[0].id);
    expect(afterRemove.items.map((item) => item.text)).toEqual(['First idea']);

    const backlogB = await getIdeaBacklog('ws-b');
    expect(backlogB.items.map((item) => item.text)).toEqual(['Workspace B idea']);

    // Verify persisted on disk for workspace A.
    const diskBacklogA = JSON.parse(readFileSync(join(workspacePathA, '.taskfactory', 'idea-backlog.json'), 'utf-8')) as IdeaBacklog;
    expect(diskBacklogA.items.map((item) => item.text)).toEqual(['First idea']);

    // Verify persisted survives module reload.
    vi.resetModules();
    const { getIdeaBacklog: getIdeaBacklogAfterReload } = await import('../src/idea-backlog-service.js');
    const loadedAfterReload = await getIdeaBacklogAfterReload('ws-a');
    expect(loadedAfterReload.items.map((item) => item.text)).toEqual(['First idea']);
  });

  it('rejects reorder requests that do not include every idea exactly once', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeWorkspaceConfig(workspacePath);
    registerWorkspaces(homePath, [{ id: 'ws-1', path: workspacePath, name: 'workspace-1' }]);

    const {
      addIdeaBacklogItem,
      reorderIdeaBacklogItems,
      getIdeaBacklog,
    } = await import('../src/idea-backlog-service.js');

    await addIdeaBacklogItem('ws-1', 'Only idea');
    const backlog = await getIdeaBacklog('ws-1');

    await expect(reorderIdeaBacklogItems('ws-1', ['missing-id'])).rejects.toThrow(
      'Reorder payload includes unknown idea IDs',
    );

    await expect(reorderIdeaBacklogItems('ws-1', [])).rejects.toThrow(
      'Reorder payload must include every idea exactly once',
    );

    expect(backlog.items).toHaveLength(1);
  });

  it('rejects empty idea text input', async () => {
    const homePath = setTempHome();
    const workspacePath = createTempDir('pi-factory-workspace-');

    writeWorkspaceConfig(workspacePath);
    registerWorkspaces(homePath, [{ id: 'ws-2', path: workspacePath, name: 'workspace-2' }]);

    const { addIdeaBacklogItem, getIdeaBacklog } = await import('../src/idea-backlog-service.js');

    await expect(addIdeaBacklogItem('ws-2', '   ')).rejects.toThrow('Idea text is required');

    const backlog = await getIdeaBacklog('ws-2');
    expect(backlog.items).toEqual([]);
  });

  describe('updateIdeaBacklogItem', () => {
    it('updates the text of an existing idea', async () => {
      const homePath = setTempHome();
      const workspacePath = createTempDir('pi-factory-workspace-update-');

      writeWorkspaceConfig(workspacePath);
      registerWorkspaces(homePath, [{ id: 'ws-upd', path: workspacePath, name: 'workspace-upd' }]);

      const { addIdeaBacklogItem, updateIdeaBacklogItem, getIdeaBacklog } = await import('../src/idea-backlog-service.js');

      await addIdeaBacklogItem('ws-upd', 'Original text');
      const backlog = await getIdeaBacklog('ws-upd');
      const ideaId = backlog.items[0].id;

      const updated = await updateIdeaBacklogItem('ws-upd', ideaId, 'Updated text');
      expect(updated.items[0].text).toBe('Updated text');
      expect(updated.items[0].id).toBe(ideaId);

      // Persisted on disk
      const diskBacklog = JSON.parse(
        readFileSync(join(workspacePath, '.taskfactory', 'idea-backlog.json'), 'utf-8'),
      ) as IdeaBacklog;
      expect(diskBacklog.items[0].text).toBe('Updated text');
    });

    it('rejects empty or whitespace-only text', async () => {
      const homePath = setTempHome();
      const workspacePath = createTempDir('pi-factory-workspace-update-empty-');

      writeWorkspaceConfig(workspacePath);
      registerWorkspaces(homePath, [{ id: 'ws-upd-empty', path: workspacePath, name: 'workspace-upd-empty' }]);

      const { addIdeaBacklogItem, updateIdeaBacklogItem, getIdeaBacklog } = await import('../src/idea-backlog-service.js');

      await addIdeaBacklogItem('ws-upd-empty', 'Original');
      const backlog = await getIdeaBacklog('ws-upd-empty');
      const ideaId = backlog.items[0].id;

      await expect(updateIdeaBacklogItem('ws-upd-empty', ideaId, '')).rejects.toThrow('Idea text is required');
      await expect(updateIdeaBacklogItem('ws-upd-empty', ideaId, '   ')).rejects.toThrow('Idea text is required');

      // Text unchanged
      const afterReject = await getIdeaBacklog('ws-upd-empty');
      expect(afterReject.items[0].text).toBe('Original');
    });

    it('rejects unknown idea IDs', async () => {
      const homePath = setTempHome();
      const workspacePath = createTempDir('pi-factory-workspace-update-missing-');

      writeWorkspaceConfig(workspacePath);
      registerWorkspaces(homePath, [{ id: 'ws-upd-missing', path: workspacePath, name: 'workspace-upd-missing' }]);

      const { updateIdeaBacklogItem } = await import('../src/idea-backlog-service.js');

      await expect(updateIdeaBacklogItem('ws-upd-missing', 'nonexistent-id', 'Some text')).rejects.toThrow(
        'Idea not found: nonexistent-id',
      );
    });
  });
});
