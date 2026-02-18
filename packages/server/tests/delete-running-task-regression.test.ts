import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(currentDir, '../src/index.ts');
const planningAgentServicePath = resolve(currentDir, '../src/planning-agent-service.ts');
const agentExecutionServicePath = resolve(currentDir, '../src/agent-execution-service.ts');

const indexSource = readFileSync(indexPath, 'utf-8');
const planningAgentSource = readFileSync(planningAgentServicePath, 'utf-8');
const agentExecutionSource = readFileSync(agentExecutionServicePath, 'utf-8');

function sliceSection(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Start marker not found: ${startMarker}`);

  const end = source.indexOf(endMarker, start);
  if (end < 0 || end <= start) throw new Error(`End marker not found after start marker: ${endMarker}`);

  return source.slice(start, end);
}

describe('delete running task regression checks', () => {
  it('uses lifecycle-safe delete flow in the REST task delete route', () => {
    const deleteRoute = sliceSection(
      indexSource,
      "app.delete('/api/workspaces/:workspaceId/tasks/:taskId'",
      '// Move task to phase',
    );

    expect(deleteRoute).toContain("deleteTaskWithLifecycle(task)");
    expect(deleteRoute).toContain('kickQueue(workspace.id);');
  });

  it('uses lifecycle-safe delete flow in planning manage_tasks callbacks', () => {
    const callbacksSection = sliceSection(
      planningAgentSource,
      'async function registerTaskCallbacks(workspaceId: string): Promise<void> {',
      'export function _unregisterTaskCallbacks(workspaceId: string): void {',
    );

    expect(callbacksSection).toContain("const { deleteTaskWithLifecycle } = await import('./task-deletion-service.js');");
    expect(callbacksSection).toContain('await deleteTaskWithLifecycle(task);');
  });

  it('stops initializing sessions instead of requiring an attached Pi session', () => {
    const stopSection = sliceSection(
      agentExecutionSource,
      'export async function stopTaskExecution(taskId: string): Promise<boolean> {',
      '// =============================================================================\n// Planning Agent',
    );

    expect(stopSection).toContain('if (!session) {');
    expect(stopSection).not.toContain('if (!session || !session.piSession)');
    expect(stopSection).toContain('cleanupPlanCallback(taskId);');
  });

  it('does not resurrect deleted tasks in manual execute completion callback', () => {
    const executeRoute = sliceSection(
      indexSource,
      "app.post('/api/workspaces/:workspaceId/tasks/:taskId/execute'",
      '// Stop task execution',
    );

    expect(executeRoute).toContain('const latestTask = latestTasks.find((candidate) => candidate.id === task.id);');
    expect(executeRoute).toContain('if (!latestTask) {');
    expect(executeRoute).not.toContain('find((candidate) => candidate.id === task.id) || task');
  });
});
