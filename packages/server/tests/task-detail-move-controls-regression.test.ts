import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskDetailPanePath = resolve(currentDir, '../../client/src/components/TaskDetailPane.tsx');
const taskDetailPaneSource = readFileSync(taskDetailPanePath, 'utf-8');

describe('task detail move controls regression checks', () => {
  it('keeps header move controls ordered as demote, Move, promote', () => {
    const demoteIndex = taskDetailPaneSource.indexOf('const demoteTo = getDemotePhase(frontmatter.phase);');
    const moveButtonIndex = taskDetailPaneSource.indexOf('onClick={() => setShowMoveMenu(!showMoveMenu)}');
    const promoteIndex = taskDetailPaneSource.indexOf('const promoteTo = getPromotePhase(frontmatter.phase);');

    expect(demoteIndex).toBeGreaterThan(-1);
    expect(moveButtonIndex).toBeGreaterThan(demoteIndex);
    expect(promoteIndex).toBeGreaterThan(moveButtonIndex);
  });

  it('keeps demote/promote phase logic and move menu interactions intact', () => {
    expect(taskDetailPaneSource).toContain('const demoteTo = getDemotePhase(frontmatter.phase);');
    expect(taskDetailPaneSource).toContain('onClick={() => demoteTo && onMove(demoteTo)}');
    expect(taskDetailPaneSource).toContain('disabled={!demoteTo}');
    expect(taskDetailPaneSource).toContain("{demoteTo ? PHASE_DISPLAY_NAMES[demoteTo] : 'None'}");

    expect(taskDetailPaneSource).toContain('onClick={() => setShowMoveMenu(!showMoveMenu)}');
    expect(taskDetailPaneSource).toContain('{showMoveMenu && (');
    expect(taskDetailPaneSource).toContain('{PHASES.map((phase) => (');
    expect(taskDetailPaneSource).toContain('disabled={phase === frontmatter.phase}');
    expect(taskDetailPaneSource).toContain('onMove(phase)');
    expect(taskDetailPaneSource).toContain('setShowMoveMenu(false)');

    expect(taskDetailPaneSource).toContain('const promoteTo = getPromotePhase(frontmatter.phase);');
    expect(taskDetailPaneSource).toContain('onClick={() => promoteTo && onMove(promoteTo)}');
    expect(taskDetailPaneSource).toContain('disabled={!promoteTo}');
    expect(taskDetailPaneSource).toContain("{promoteTo ? PHASE_DISPLAY_NAMES[promoteTo] : 'None'}");
  });
});
