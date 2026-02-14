/**
 * Manage Shelf Extension
 *
 * Registers a `manage_shelf` tool for session-scoped Foreman outputs.
 * Despite the legacy tool name, this now manages inline session artifacts
 * and draft-task payloads used by chat cards.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<any>;
    createArtifact: (args: any) => Promise<{ id: string; name: string }>;
    removeItem: (itemId: string) => Promise<string>;
    updateDraftTask: (draftId: string, updates: any) => Promise<string>;
    getShelf: () => Promise<any>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'manage_shelf',
    label: 'Manage Session Outputs',
    description:
      'Manage session-scoped Foreman outputs (inline artifacts and draft tasks). ' +
      'Use action "list" to inspect current session outputs, "remove" to delete an output by ID, ' +
      'or "update" to modify a draft-task payload before the user opens it in the New Task form.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('remove'),
        Type.Literal('update'),
      ], { description: 'Action to perform' }),
      item_id: Type.Optional(Type.String({
        description: 'ID of the session output item (required for remove and update)',
      })),
      updates: Type.Optional(Type.Object({
        title: Type.Optional(Type.String({ description: 'New title' })),
        content: Type.Optional(Type.String({ description: 'New markdown description' })),
        acceptance_criteria: Type.Optional(Type.Array(Type.String(), {
          description: 'New acceptance criteria',
        })),
      }, { description: 'Fields to update (for update action)' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, item_id, updates } = params;

      const callbacks = globalThis.__piFactoryShelfCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Session output callbacks not available.' }],
          details: {} as Record<string, unknown>,
        };
      }

      // Use the first registered callback set
      const [, cb] = callbacks.entries().next().value!;

      if (action === 'list') {
        const shelf = await cb.getShelf();
        if (!shelf.items || shelf.items.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No session outputs are currently registered.' }],
            details: {} as Record<string, unknown>,
          };
        }

        const lines = shelf.items.map((si: any) => {
          if (si.type === 'draft-task') {
            const d = si.item;
            return `- [draft-task] ${d.id}: "${d.title}"`;
          }
          const a = si.item;
          return `- [artifact] ${a.id}: "${a.name}"`;
        });

        return {
          content: [{ type: 'text' as const, text: `Session outputs (${shelf.items.length} items):\n${lines.join('\n')}` }],
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
