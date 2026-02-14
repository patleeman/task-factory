import { describe, expect, it } from 'vitest';
import { WorkflowAutomationControls } from '../../client/src/components/WorkflowAutomationControls';
import { syncAutomationSettingsWithQueue } from '../../client/src/components/workflow-automation';

type ElementLike = {
  type: unknown;
  props?: {
    children?: unknown;
    label?: unknown;
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
  if (typeof label === 'string') {
    output.push(node);
  }

  collectToggleElements(node.props?.children, output);
  return output;
}

describe('workflow automation controls UI', () => {
  it('renders both automation toggles in the header control group', () => {
    const tree = WorkflowAutomationControls({
      settings: {
        backlogToReady: true,
        readyToExecuting: true,
      },
      readyTasksCount: 2,
      backlogAutomationToggling: false,
      readyAutomationToggling: false,
      onToggleBacklogAutomation: () => {},
      onToggleReadyAutomation: () => {},
    });

    const toggles = collectToggleElements(tree);
    expect(toggles).toHaveLength(2);
    expect(toggles[0].props?.label).toBe('Backlog→Ready');
    expect(toggles[1].props?.label).toBe('Ready→Exec');
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
