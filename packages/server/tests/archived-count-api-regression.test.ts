import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverIndexPath = resolve(currentDir, '../src/index.ts');
const taskServicePath = resolve(currentDir, '../src/task-service.ts');
const clientApiPath = resolve(currentDir, '../../client/src/api.ts');

const serverIndexSource = readFileSync(serverIndexPath, 'utf-8');
const taskServiceSource = readFileSync(taskServicePath, 'utf-8');
const clientApiSource = readFileSync(clientApiPath, 'utf-8');

describe('archived count api regression checks', () => {
  it('adds a dedicated workspace archived count endpoint with missing-workspace handling', () => {
    expect(serverIndexSource).toContain("app.get('/api/workspaces/:id/tasks/archived/count'");
    expect(serverIndexSource).toContain("res.status(404).json({ error: 'Workspace not found' });");
    expect(serverIndexSource).toContain("const archivedCount = countTasksByScope(tasksDir, 'archived');");
    expect(serverIndexSource).toContain('res.json({ archivedCount });');
  });

  it('exposes a client archived-count helper against the dedicated endpoint', () => {
    expect(clientApiSource).toContain('async getArchivedTaskCount(workspaceId: string): Promise<number>');
    expect(clientApiSource).toContain('fetch(`/api/workspaces/${workspaceId}/tasks/archived/count`)');
    expect(clientApiSource).toContain('Failed to load archived count');
  });

  it('includes a lightweight task-service counter for scope-specific totals', () => {
    expect(taskServiceSource).toContain('export function countTasksByScope(');
    expect(taskServiceSource).toContain('const phaseFromHeader = readTaskPhaseFromHeader(yamlPath);');
    expect(taskServiceSource).toContain('if (scope === \'all\') {');
  });
});
