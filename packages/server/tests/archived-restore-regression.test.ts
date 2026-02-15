import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const pipelineBarPath = resolve(currentDir, '../../client/src/components/PipelineBar.tsx');
const pipelineBarSource = readFileSync(pipelineBarPath, 'utf-8');

function getAdvanceActionBlock(): string {
  const match = pipelineBarSource.match(
    /const getAdvanceAction = \(task: Task\): [\s\S]*?\n  \}\n\n  const getAutomationToggleForPhase/,
  );

  return match?.[0] ?? '';
}

describe('archived restore regression checks', () => {
  it('routes archive restore action to complete instead of backlog', () => {
    const restoreTargetMatch = pipelineBarSource.match(
      /onRestore=\{\(task\)\s*=>\s*\{\s*onMoveTask\(task,\s*'([^']+)'\)/,
    );

    expect(restoreTargetMatch?.[1]).toBe('complete');
    expect(pipelineBarSource).not.toContain("onRestore={(task) => { onMoveTask(task, 'backlog');");
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
