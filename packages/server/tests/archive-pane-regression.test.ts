import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(currentDir, '../../client/src/App.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const pipelineBarPath = resolve(currentDir, '../../client/src/components/PipelineBar.tsx');
const archivePanePath = resolve(currentDir, '../../client/src/components/ArchivePane.tsx');

const appSource = readFileSync(appPath, 'utf-8');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const pipelineBarSource = readFileSync(pipelineBarPath, 'utf-8');
const archivePaneSource = readFileSync(archivePanePath, 'utf-8');

describe('archive pane regression checks', () => {
  it('adds a dedicated workspace archive route and right-pane branch', () => {
    expect(appSource).toContain('path="/workspace/:workspaceId/archive"');

    expect(workspacePageSource).toContain("const isArchiveRoute = useMatch('/workspace/:workspaceId/archive') !== null");
    expect(workspacePageSource).toContain('const workspaceArchivePath = workspaceId ? `/workspace/${workspaceId}/archive` : \'/\'');
    expect(workspacePageSource).toContain(': isArchiveRoute ? (');
    expect(workspacePageSource).toContain('<ArchivePane');
  });

  it('replaces the archived popover with click-to-open archive navigation in the pipeline bar', () => {
    expect(pipelineBarSource).toContain('onOpenArchive: () => void');
    expect(pipelineBarSource).toContain('archivedCount: number');
    expect(pipelineBarSource).toContain('onClick={onOpenArchive}');
    expect(pipelineBarSource).toContain('`${archivedCount} archived`');

    expect(pipelineBarSource).not.toContain('ArchivedPopover');
    expect(pipelineBarSource).not.toContain('showArchived');
  });

  it('keeps archive pane search, lazy loading, and bulk action controls', () => {
    expect(archivePaneSource).toContain('Filter archived tasks by ID or title');
    expect(archivePaneSource).toContain('INITIAL_VISIBLE_ROWS');
    expect(archivePaneSource).toContain('IntersectionObserver');
    expect(archivePaneSource).toContain('Load more archived tasks');

    expect(archivePaneSource).toContain('Select all filtered');
    expect(archivePaneSource).toContain('Restore to Complete');
    expect(archivePaneSource).toContain('Delete Selected');
  });
});
