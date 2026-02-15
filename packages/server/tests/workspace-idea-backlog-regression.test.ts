import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspacePagePath = resolve(currentDir, '../../client/src/components/WorkspacePage.tsx');
const ideaBacklogPanePath = resolve(currentDir, '../../client/src/components/IdeaBacklogPane.tsx');

const workspacePageSource = readFileSync(workspacePagePath, 'utf-8');
const ideaBacklogPaneSource = readFileSync(ideaBacklogPanePath, 'utf-8');

describe('workspace idea backlog regression checks', () => {
  it('exposes a header control and foreman right-pane wiring for idea backlog', () => {
    expect(workspacePageSource).toContain('Idea Backlog');
    expect(workspacePageSource).toContain("setActiveForemanPane('ideas')");
    expect(workspacePageSource).toContain("activeForemanPane === 'ideas'");
    expect(workspacePageSource).toContain('<IdeaBacklogPane');
  });

  it('wires idea promotion into existing create-task prefill flow', () => {
    expect(workspacePageSource).toContain('const handlePromoteIdea = useCallback((idea: IdeaBacklogItem) => {');
    expect(workspacePageSource).toContain('formState: {');
    expect(workspacePageSource).toContain('content: idea.text');
    expect(workspacePageSource).toContain('navigate(`${workspaceRootPath}/tasks/new`)');
  });

  it('renders drag-reorder affordances and quick delete/create actions in the idea panel', () => {
    expect(ideaBacklogPaneSource).toContain('draggable');
    expect(ideaBacklogPaneSource).toContain('onReorderIdeas');
    expect(ideaBacklogPaneSource).toContain('Create Task');
    expect(ideaBacklogPaneSource).toContain('Delete idea');
  });
});
