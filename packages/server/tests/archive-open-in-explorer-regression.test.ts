import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const archivePanePath = resolve(currentDir, '../../client/src/components/ArchivePane.tsx');
const serverIndexPath = resolve(currentDir, '../src/index.ts');
const fileExplorerPath = resolve(currentDir, '../src/file-explorer.ts');

const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const archivePaneSource = readFileSync(archivePanePath, 'utf-8');
const serverIndexSource = readFileSync(serverIndexPath, 'utf-8');
const fileExplorerSource = readFileSync(fileExplorerPath, 'utf-8');

describe('archive open-in-explorer regression checks', () => {
  it('wires archive pane explorer button through WorkspacePage loading guard and props', () => {
    expect(workspacePageSource).toContain('const handleOpenArchiveInFileExplorer = useCallback(async () => {');
    expect(workspacePageSource).toContain('openingArchiveExplorerRef.current');
    expect(workspacePageSource).toContain('await api.openArchiveInFileExplorer(workspaceId)');
    expect(workspacePageSource).toContain('onOpenInFileExplorer={handleOpenArchiveInFileExplorer}');
    expect(workspacePageSource).toContain('isOpeningInFileExplorer={isOpeningArchiveInFileExplorer}');

    expect(archivePaneSource).toContain('onOpenInFileExplorer: () => Promise<void>');
    expect(archivePaneSource).toContain('isOpeningInFileExplorer: boolean');
    expect(archivePaneSource).toContain('disabled={isOpeningInFileExplorer}');
    expect(archivePaneSource).toContain("{isOpeningInFileExplorer ? 'Opening…' : 'Open in File Explorer'}");
  });

  it('exposes workspace-scoped archive explorer endpoint with missing-workspace and launch-failure responses', () => {
    expect(serverIndexSource).toContain("app.post('/api/workspaces/:workspaceId/archive/open-in-explorer'");
    expect(serverIndexSource).toContain('const tasksDir = getTasksDir(workspace);');
    expect(serverIndexSource).toContain('await openInFileExplorer(tasksDir);');
    expect(serverIndexSource).toContain("res.status(404).json({ error: 'Workspace not found' });");
    expect(serverIndexSource).toContain("res.status(500).json({ error: `Failed to open archive in file explorer${detail}` });");
  });

  it('uses OS-native explorer command mapping per platform', () => {
    expect(fileExplorerSource).toContain("case 'darwin':");
    expect(fileExplorerSource).toContain("return { command: 'open', args: [targetPath] };");

    expect(fileExplorerSource).toContain("case 'linux':");
    expect(fileExplorerSource).toContain("return { command: 'xdg-open', args: [targetPath] };");

    expect(fileExplorerSource).toContain("case 'win32':");
    expect(fileExplorerSource).toContain("return { command: 'explorer.exe', args: [targetPath] };");
  });
});
