import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const pipelineBarPath = resolve(currentDir, '../../client/src/components/PipelineBar.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const archivePanePath = resolve(currentDir, '../../client/src/components/ArchivePane.tsx');

const pipelineBarSource = readFileSync(pipelineBarPath, 'utf-8');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const archivePaneSource = readFileSync(archivePanePath, 'utf-8');

function getAdvanceActionBlock(): string {
  const match = pipelineBarSource.match(
    /const getAdvanceAction = \(task: Task\): [\s\S]*?\n\s{2}\}\n\n\s{2}const getAutomationToggleForPhase/,
  );

  return match?.[0] ?? '';
}

describe('archived restore regression checks', () => {
  it('routes archive restore actions to complete instead of backlog', () => {
    expect(workspacePageSource).toContain("api.moveTask(workspaceId, targetTaskId, 'complete', 'restore from archive')");
    expect(workspacePageSource).not.toContain("api.moveTask(workspaceId, targetTaskId, 'backlog'");

    expect(archivePaneSource).toContain('Restore to Complete');
    expect(archivePaneSource).toContain('onBulkRestoreTasks');
  });

  it('keeps complete-card archive quick action on the shared advance-action button path', () => {
    const advanceActionBlock = getAdvanceActionBlock();

    expect(advanceActionBlock).toMatch(
      /case 'backlog':\s*return\s*\{\s*label:\s*'Ready',\s*toPhase:\s*'ready'\s*\}/,
    );
    expect(advanceActionBlock).toMatch(
      /case 'complete':\s*return\s*\{\s*label:\s*'Archive',\s*toPhase:\s*'archived'\s*\}/,
    );
    expect(advanceActionBlock).not.toMatch(/case 'ready':|case 'executing':/);

    expect(pipelineBarSource).toMatch(/onMoveTask\(task,\s*advanceAction\.toPhase\)/);
    expect(pipelineBarSource).toContain('{advanceAction.label}');
  });
});
