import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');

describe('workspace archive lazy loading regression checks', () => {
  it('loads active tasks on workspace bootstrap', () => {
    expect(workspacePageSource).toContain("api.getTasks(workspaceId, 'active')");
  });

  it('loads archived count on bootstrap and uses it in the pipeline bar before archive hydration', () => {
    expect(workspacePageSource).toContain('api.getArchivedTaskCount(workspaceId)');
    expect(workspacePageSource).toContain('const effectiveArchivedCount = archivedTasksLoaded');
    expect(workspacePageSource).toContain('archivedCount={effectiveArchivedCount}');
  });

  it('loads archived tasks through an explicit lazy loader', () => {
    expect(workspacePageSource).toContain("api.getTasks(workspaceId, 'archived')");
    expect(workspacePageSource).toContain('const loadArchivedTasksIfNeeded = useCallback(async');
    expect(workspacePageSource).toContain('const handleOpenArchive = useCallback(() => {');
    expect(workspacePageSource).toContain('void loadArchivedTasksIfNeeded()');
  });

  it('triggers archived lazy loading for archive route and missing task-route resolution', () => {
    expect(workspacePageSource).toContain('if (isArchiveRoute) {');
    expect(workspacePageSource).toContain('if (!taskId || selectedTask) {');
    expect(workspacePageSource).toContain('void loadArchivedTasksIfNeeded()');
  });

  it('keeps websocket archive transitions in sync when archived tasks are not loaded yet', () => {
    expect(workspacePageSource).toContain("if (msg.to === 'archived' && !archivedTasksLoaded)");
    expect(workspacePageSource).toContain('updated[existingIndex] = msg.task');
  });
});
