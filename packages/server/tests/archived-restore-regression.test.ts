import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const pipelineBarPath = resolve(currentDir, '../../client/src/components/PipelineBar.tsx');
const pipelineBarSource = readFileSync(pipelineBarPath, 'utf-8');

describe('archived restore regression checks', () => {
  it('routes archive restore action to complete instead of backlog', () => {
    const restoreTargetMatch = pipelineBarSource.match(
      /onRestore=\{\(task\)\s*=>\s*\{\s*onMoveTask\(task,\s*'([^']+)'\)/,
    );

    expect(restoreTargetMatch?.[1]).toBe('complete');
    expect(pipelineBarSource).not.toContain("onRestore={(task) => { onMoveTask(task, 'backlog');");
  });
});
