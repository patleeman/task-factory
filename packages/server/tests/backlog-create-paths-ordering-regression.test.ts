import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskServicePath = resolve(currentDir, '../src/task-service.ts');
const indexPath = resolve(currentDir, '../src/index.ts');

const taskServiceSource = readFileSync(taskServicePath, 'utf-8');
const indexSource = readFileSync(indexPath, 'utf-8');

function sliceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`Start marker not found: ${startMarker}`);
  }

  const end = source.indexOf(endMarker, start);
  if (end < 0 || end <= start) {
    throw new Error(`End marker not found after start marker: ${endMarker}`);
  }

  return source.slice(start, end);
}

describe('backlog insertion ordering regression checks', () => {
  it('inserts newly created backlog tasks at the left edge', () => {
    const createTaskSection = sliceSection(
      taskServiceSource,
      'export function createTask(',
      'export function updateTask(',
    );

    expect(createTaskSection).toContain("const nextOrder = getLeftInsertOrder(existingTasks, 'backlog');");
    expect(createTaskSection).not.toContain('maxOrder');
    expect(createTaskSection).not.toContain('rightmost card');
  });

  it('uses the shared createTask path for direct task creation and shelf draft pushes', () => {
    const createRouteSection = sliceSection(
      indexSource,
      "app.post('/api/workspaces/:id/tasks'",
      '// Get task',
    );

    const pushDraftRouteSection = sliceSection(
      indexSource,
      "app.post('/api/workspaces/:workspaceId/shelf/drafts/:draftId/push'",
      '// Push all draft tasks to backlog',
    );

    const pushAllRouteSection = sliceSection(
      indexSource,
      "app.post('/api/workspaces/:workspaceId/shelf/push-all'",
      '// Catch-all for SPA',
    );

    expect(createRouteSection).toContain('createTask(workspace.path, tasksDir, request, title);');
    expect(pushDraftRouteSection).toContain('const task = createTask(workspace.path, tasksDir, createReq, draft.title);');
    expect(pushAllRouteSection).toMatch(/const task = createTask\(workspace\.path,\s*tasksDir,\s*\{/);
  });
});
