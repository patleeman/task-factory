import { describe, expect, it } from 'vitest';
import {
  buildContractReference,
  buildStateBlock,
  prependStateToTurn,
  buildTaskStateSnapshot,
  resolveTaskMode,
  isForbidden,
  getContract,
  stripStateContractEcho,
} from '../src/state-contract.js';

describe('state contract', () => {
  // ---------------------------------------------------------------------------
  // Mode resolution
  // ---------------------------------------------------------------------------

  describe('resolveTaskMode', () => {
    it('returns task_planning for backlog + running + no plan', () => {
      expect(resolveTaskMode({ phase: 'backlog', planningStatus: 'running', plan: undefined } as any))
        .toBe('task_planning');
    });

    it('returns task_execution for executing phase', () => {
      expect(resolveTaskMode({ phase: 'executing', planningStatus: 'completed', plan: {} } as any))
        .toBe('task_execution');
    });

    it('returns task_complete for complete phase', () => {
      expect(resolveTaskMode({ phase: 'complete', planningStatus: 'completed', plan: {} } as any))
        .toBe('task_complete');
    });

    it('returns task_complete for backlog with completed plan', () => {
      expect(resolveTaskMode({ phase: 'backlog', planningStatus: 'completed', plan: {} } as any))
        .toBe('task_complete');
    });

    it('returns task_complete for backlog with planning error', () => {
      expect(resolveTaskMode({ phase: 'backlog', planningStatus: 'error' } as any))
        .toBe('task_complete');
    });

    it('returns task_complete for ready phase', () => {
      expect(resolveTaskMode({ phase: 'ready', planningStatus: 'completed', plan: {} } as any))
        .toBe('task_complete');
    });

    it('returns task_complete for archived phase', () => {
      expect(resolveTaskMode({ phase: 'archived' } as any))
        .toBe('task_complete');
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('permissions', () => {
    // foreman
    it('foreman cannot edit, write, save_plan, or task_complete', () => {
      expect(isForbidden('foreman', 'edit')).toBe(true);
      expect(isForbidden('foreman', 'write')).toBe(true);
      expect(isForbidden('foreman', 'save_plan')).toBe(true);
      expect(isForbidden('foreman', 'task_complete')).toBe(true);
    });

    it('foreman can read, bash, create_draft_task, web_search, and web_fetch', () => {
      expect(isForbidden('foreman', 'read')).toBe(false);
      expect(isForbidden('foreman', 'bash')).toBe(false);
      expect(isForbidden('foreman', 'create_draft_task')).toBe(false);
      expect(isForbidden('foreman', 'web_search')).toBe(false);
      expect(isForbidden('foreman', 'web_fetch')).toBe(false);
    });

    // task_planning
    it('task_planning can save_plan but not edit/write/task_complete/web tools', () => {
      expect(isForbidden('task_planning', 'save_plan')).toBe(false);
      expect(isForbidden('task_planning', 'edit')).toBe(true);
      expect(isForbidden('task_planning', 'write')).toBe(true);
      expect(isForbidden('task_planning', 'task_complete')).toBe(true);
      expect(isForbidden('task_planning', 'web_search')).toBe(true);
      expect(isForbidden('task_planning', 'web_fetch')).toBe(true);
    });

    // task_execution
    it('task_execution can edit/write/task_complete but not save_plan or web tools', () => {
      expect(isForbidden('task_execution', 'edit')).toBe(false);
      expect(isForbidden('task_execution', 'write')).toBe(false);
      expect(isForbidden('task_execution', 'task_complete')).toBe(false);
      expect(isForbidden('task_execution', 'save_plan')).toBe(true);
      expect(isForbidden('task_execution', 'web_search')).toBe(true);
      expect(isForbidden('task_execution', 'web_fetch')).toBe(true);
    });

    // task_complete
    it('task_complete can edit/write but not save_plan/task_complete/web tools', () => {
      expect(isForbidden('task_complete', 'edit')).toBe(false);
      expect(isForbidden('task_complete', 'write')).toBe(false);
      expect(isForbidden('task_complete', 'save_plan')).toBe(true);
      expect(isForbidden('task_complete', 'task_complete')).toBe(true);
      expect(isForbidden('task_complete', 'web_search')).toBe(true);
      expect(isForbidden('task_complete', 'web_fetch')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Contract reference
  // ---------------------------------------------------------------------------

  it('builds reference section with all modes', () => {
    const text = buildContractReference();

    expect(text).toContain('foreman');
    expect(text).toContain('task_planning');
    expect(text).toContain('task_execution');
    expect(text).toContain('task_complete');
    expect(text).toContain('web_search');
    expect(text).toContain('web_fetch');
    // old modes must not appear
    expect(text).not.toContain('task_chat');
    expect(text).not.toContain('task_rework');
    expect(text).not.toContain('foreman_planning');
  });

  // ---------------------------------------------------------------------------
  // State block
  // ---------------------------------------------------------------------------

  it('builds state block with version 2', () => {
    const text = buildStateBlock({
      mode: 'task_planning',
      phase: 'backlog',
      planningStatus: 'running',
    });

    expect(text).toContain('<state_contract version="2">');
    expect(text).toContain('<mode>task_planning</mode>');
    expect(text).toContain('<allowed>read, bash, save_plan</allowed>');
    expect(text).toContain('<forbidden>edit, write, task_complete, web_search, web_fetch</forbidden>');
  });

  // ---------------------------------------------------------------------------
  // Prepend state to turn
  // ---------------------------------------------------------------------------

  it('prepends state block to turn content', () => {
    const result = prependStateToTurn('Hello', {
      mode: 'task_execution',
      phase: 'executing',
      planningStatus: 'completed',
    });

    expect(result).toContain('<mode>task_execution</mode>');
    expect(result).toContain('Hello');
    expect(result).toContain('Obey <state_contract>');
  });

  // ---------------------------------------------------------------------------
  // buildTaskStateSnapshot
  // ---------------------------------------------------------------------------

  it('builds snapshot from frontmatter', () => {
    const snap = buildTaskStateSnapshot({
      phase: 'executing',
      planningStatus: 'completed',
      plan: { goal: 'x', steps: [], validation: [], cleanup: [], generatedAt: '' },
    } as any);

    expect(snap.mode).toBe('task_execution');
    expect(snap.phase).toBe('executing');
    expect(snap.planningStatus).toBe('completed');
  });

  // ---------------------------------------------------------------------------
  // getContract
  // ---------------------------------------------------------------------------

  it('returns contract for a mode', () => {
    const c = getContract('foreman');
    expect(c.meaning).toContain('Workspace-level');
    expect(c.forbidden).toContain('edit');
  });

  // ---------------------------------------------------------------------------
  // stripStateContractEcho
  // ---------------------------------------------------------------------------

  it('strips echoed v2 state contract from assistant text', () => {
    const echoed = `## Current Turn State\n<state_contract version="2">\n  <mode>task_execution</mode>\n</state_contract>\n\nObey <state_contract> as the highest-priority behavior contract for this turn.\n\nActual answer`;
    const cleaned = stripStateContractEcho(echoed);

    expect(cleaned).toBe('Actual answer');
  });

  it('returns text unchanged when no state contract present', () => {
    const plain = 'Just a normal response';
    expect(stripStateContractEcho(plain)).toBe(plain);
  });
});
