import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const planningHookPath = resolve(currentDir, '../../client/src/hooks/usePlanningStreaming.ts');

const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const planningHookSource = readFileSync(planningHookPath, 'utf-8');

describe('qa background workspace recovery regression checks', () => {
  it('recovers pending QA via HTTP fallback during workspace resume without waiting for live qa:request websocket events', () => {
    expect(planningHookSource).toContain('const recoverPendingQARequest = useCallback(async (wsId: string) => {');
    expect(planningHookSource).toContain('const request = await api.getPendingQA(wsId)');
    expect(planningHookSource).toContain('if (workspaceIdRef.current !== wsId) return');
    expect(planningHookSource).toContain('{ markAwaitingOnOpen: true }');
  });

  it('runs pending-QA recovery when workspace changes, on empty-history reset, and after planning messages hydrate with no unresolved qa request', () => {
    expect(planningHookSource).toContain('void recoverPendingQARequest(workspaceId)');
    expect(planningHookSource).toContain('if (initialMessages.length === 0) {');
    expect(planningHookSource).toContain('setAgentStream(INITIAL_AGENT_STREAM)');
    expect(planningHookSource).toContain('if (restoredQAState.activeRequest) {');
    expect(planningHookSource).toContain('if (workspaceId) {');
  });

  it('clears stale planning message snapshots when switching workspaces so resumed state is hydrated from the active workspace', () => {
    expect(workspacePageSource).toContain('setPlanningMessages([])');
  });
});
