import { describe, expect, it } from 'vitest';
import { ShelfPane } from '../../client/src/components/ShelfPane';
import { syncAutomationSettingsWithQueue } from '../../client/src/components/workflow-automation';

type ElementLike = {
  type: unknown;
  props?: {
    children?: unknown;
    label?: unknown;
    description?: unknown;
    readyCountBadge?: unknown;
  };
};

function isElementLike(node: unknown): node is ElementLike {
  return typeof node === 'object' && node !== null && 'type' in node;
}

function collectToggleElements(node: unknown, output: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectToggleElements(child, output);
    }
    return output;
  }

  if (!isElementLike(node)) {
    return output;
  }

  const label = node.props?.label;
  const description = node.props?.description;
  if (typeof label === 'string' && typeof description === 'string') {
    output.push(node);
  }

  collectToggleElements(node.props?.children, output);
  return output;
}

describe('workflow automation controls UI', () => {
  it('renders both workflow automation toggles in the shelf control bar', () => {
    const tree = ShelfPane({
      shelf: { items: [] },
      automationSettings: {
        backlogToReady: true,
        readyToExecuting: true,
      },
      readyTasksCount: 2,
      backlogAutomationToggling: false,
      readyAutomationToggling: false,
      onToggleBacklogAutomation: () => {},
      onToggleReadyAutomation: () => {},
      onPushDraft: () => {},
      onPushAll: () => {},
      onRemoveItem: () => {},
      onUpdateDraft: () => {},
      onClearShelf: () => {},
    });

    const toggles = collectToggleElements(tree);
    expect(toggles).toHaveLength(2);
    expect(toggles[0].props?.label).toBe('Backlog → Ready');
    expect(toggles[1].props?.label).toBe('Ready → Executing');
    expect(toggles[1].props?.readyCountBadge).toBe(2);
  });

  it('syncs ready→executing toggle state from live queue status', () => {
    const settings = syncAutomationSettingsWithQueue(
      {
        backlogToReady: true,
        readyToExecuting: false,
      },
      {
        workspaceId: 'workspace-1',
        enabled: true,
        currentTaskId: null,
        tasksInReady: 0,
        tasksInExecuting: 0,
      },
    );

    expect(settings).toEqual({
      backlogToReady: true,
      readyToExecuting: true,
    });
  });
});
