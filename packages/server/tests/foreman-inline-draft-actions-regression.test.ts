import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');

const taskChatSource = readFileSync(taskChatPath, 'utf-8');
const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');

const inlineStart = taskChatSource.indexOf('const InlineDraftTaskWidget');
const inlineEnd = taskChatSource.indexOf('const InferredToolBlock');
const inlineDraftSection = inlineStart >= 0 && inlineEnd > inlineStart
  ? taskChatSource.slice(inlineStart, inlineEnd)
  : taskChatSource;

describe('foreman inline draft-task action regression checks', () => {
  it('renders draft cards with distinct styling and required action order', () => {
    expect(inlineDraftSection).toContain('border-l-2 border-blue-300 bg-blue-50/60');

    const createIdx = inlineDraftSection.indexOf('Create Task');
    const editIdx = inlineDraftSection.indexOf('Edit Draft');
    // Curly apostrophe (') as used in the source
    const wontDoIdx = inlineDraftSection.indexOf('Won\u2019t do');

    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(editIdx).toBeGreaterThan(createIdx);
    expect(wontDoIdx).toBeGreaterThan(editIdx);
  });

  it('uses theme-safe surface styling for dismissed "Won\u2019t Do" cards', () => {
    // Dismissed card must use a class that has a dark-mode override to avoid bright backgrounds
    expect(inlineDraftSection).toMatch(/border-slate-300\s+bg-slate-100\/80|border-slate-300/);
    // Curly apostrophe (') as used in the source label
    expect(inlineDraftSection).toContain('Draft Task \u00b7 Won\u2019t Do');
  });

  it('collapses draft cards after create or dismissal and wires both create flows', () => {
    expect(inlineDraftSection).toContain("state?.status === 'created'");
    expect(inlineDraftSection).toContain("state?.status === 'dismissed'");

    // Direct create path
    expect(workspacePageSource).toContain('const handleCreateDraftTaskDirect = useCallback');
    expect(workspacePageSource).toContain('plan: draftTask.plan');
    expect(workspacePageSource).toContain("[draftTask.id]: { status: 'created', taskId: task.id }");

    // Edit -> Create path
    expect(workspacePageSource).toContain('sourceDraftId: draftTask.id');
    expect(workspacePageSource).toContain("[sourceDraftId]: { status: 'created', taskId: task.id }");

    // Dismiss path
    expect(workspacePageSource).toContain("[draftTask.id]: { status: 'dismissed' }");
  });
});
