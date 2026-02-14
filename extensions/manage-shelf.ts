/**
 * Manage Shelf Extension
 *
 * Registers a `manage_shelf` tool that lets the planning agent remove items,
 * update draft tasks, and list the current shelf contents.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<void>;
    createArtifact: (args: any) => Promise<{ id: string; name: string }>;
    removeItem: (itemId: string) => Promise<string>;
    updateDraftTask: (draftId: string, updates: any) => Promise<string>;
    getShelf: () => Promise<any>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'manage_shelf',
    label: 'Manage Shelf',
    description:
      'Manage items on the shelf: list current contents, remove items, or update draft tasks. ' +
      'Use action "list" to see what\'s on the shelf, "remove" to delete an item by ID, ' +
      'or "update" to modify a draft task\'s title, content, or acceptance criteria.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('remove'),
        Type.Literal('update'),
      ], { description: 'Action to perform' }),
      item_id: Type.Optional(Type.String({
        description: 'ID of the shelf item (required for remove and update)',
      })),
      updates: Type.Optional(Type.Object({
        title: Type.Optional(Type.String({ description: 'New title' })),
        content: Type.Optional(Type.String({ description: 'New markdown description' })),
        acceptance_criteria: Type.Optional(Type.Array(Type.String(), {
          description: 'New acceptance criteria',
        })),
        type: Type.Optional(Type.Union([
          Type.Literal('feature'),
          Type.Literal('bug'),
          Type.Literal('refactor'),
          Type.Literal('research'),
          Type.Literal('spike'),
        ])),
        priority: Type.Optional(Type.Union([
          Type.Literal('critical'),
          Type.Literal('high'),
          Type.Literal('medium'),
          Type.Literal('low'),
        ])),
        complexity: Type.Optional(Type.Union([
          Type.Literal('low'),
          Type.Literal('medium'),
          Type.Literal('high'),
        ])),
      }, { description: 'Fields to update (for update action)' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, item_id, updates } = params;

      const callbacks = globalThis.__piFactoryShelfCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Shelf callbacks not available.' }],
          details: {} as Record<string, unknown>,
        };
      }

      // Use the first registered callback set
      const [, cb] = callbacks.entries().next().value!;

      if (action === 'list') {
        const shelf = await cb.getShelf();
        if (!shelf.items || shelf.items.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'The shelf is empty.' }],
            details: {} as Record<string, unknown>,
          };
        }

        const lines = shelf.items.map((si: any) => {
          if (si.type === 'draft-task') {
            const d = si.item;
            return `- [draft] ${d.id}: "${d.title}" (${d.type}, ${d.priority})`;
          } else {
            const a = si.item;
            return `- [artifact] ${a.id}: "${a.name}"`;
          }
        });

        return {
          content: [{ type: 'text' as const, text: `Shelf contents (${shelf.items.length} items):\n${lines.join('\n')}` }],
          details: {} as Record<string, unknown>,
        };
      }

      if (action === 'remove') {
        if (!item_id) {
          return {
            content: [{ type: 'text' as const, text: 'Error: item_id is required for remove action.' }],
            details: {} as Record<string, unknown>,
          };
        }
        const result = await cb.removeItem(item_id);
        return {
          content: [{ type: 'text' as const, text: result }],
          details: {} as Record<string, unknown>,
        };
      }

      if (action === 'update') {
        if (!item_id) {
          return {
            content: [{ type: 'text' as const, text: 'Error: item_id is required for update action.' }],
            details: {} as Record<string, unknown>,
          };
        }
        if (!updates || Object.keys(updates).length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Error: updates object is required for update action.' }],
            details: {} as Record<string, unknown>,
          };
        }

        // Map acceptance_criteria to acceptanceCriteria for the server
        const serverUpdates: any = { ...updates };
        if (updates.acceptance_criteria) {
          serverUpdates.acceptanceCriteria = updates.acceptance_criteria;
          delete serverUpdates.acceptance_criteria;
        }

        const result = await cb.updateDraftTask(item_id, serverUpdates);
        return {
          content: [{ type: 'text' as const, text: result }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
