import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverIndexPath = resolve(currentDir, '../src/index.ts');
const clientApiPath = resolve(currentDir, '../../client/src/api.ts');

const serverIndexSource = readFileSync(serverIndexPath, 'utf-8');
const clientApiSource = readFileSync(clientApiPath, 'utf-8');

describe('pipeline stats api regression checks', () => {
  it('adds a workspace pipeline stats endpoint', () => {
    expect(serverIndexSource).toContain("app.get('/api/workspaces/:id/pipeline-stats'");
    expect(serverIndexSource).toContain('const stats = buildWorkspacePipelineStats(tasks);');
    expect(serverIndexSource).toContain("res.status(404).json({ error: 'Workspace not found' });");
  });

  it('exposes a client helper for pipeline stats', () => {
    expect(clientApiSource).toContain('async getWorkspacePipelineStats(workspaceId: string): Promise<WorkspacePipelineStats>');
    expect(clientApiSource).toContain('fetch(`/api/workspaces/${workspaceId}/pipeline-stats`)');
    expect(clientApiSource).toContain('Failed to load pipeline stats');
  });
});
