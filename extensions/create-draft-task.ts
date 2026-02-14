/**
 * Create Draft Task Extension
 *
 * Registers a `create_draft_task` tool that the planning agent calls to
 * create an inline draft task card in Foreman chat.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<{
      id: string;
      title: string;
      content: string;
      acceptanceCriteria: string[];
      plan?: {
        goal: string;
        steps: string[];
        validation: string[];
        cleanup: string[];
        generatedAt: string;
      };
      createdAt: string;
    }>;
    createArtifact: (args: any) => Promise<{ id: string; name: string }>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_draft_task',
    label: 'Create Draft Task',
    description:
      'Create an inline draft task card in Foreman chat. ' +
      'Use this to break down work into small, focused tasks with clear acceptance criteria and concise, easy-to-scan plans. ' +
      'Users can click the card to open the New Task draft screen prefilled.',
    parameters: Type.Object({
      title: Type.String({ description: 'Short descriptive title for the task' }),
      content: Type.String({ description: 'Markdown description of what needs to be done' }),
      acceptance_criteria: Type.Array(Type.String(), {
        description: 'List of specific, testable acceptance criteria',
        minItems: 1,
      }),
      plan: Type.Object({
        goal: Type.String({
          description: 'Concise summary of what the task is trying to achieve',
          maxLength: 220,
        }),
        steps: Type.Array(Type.String({ maxLength: 180 }), {
          description: 'High-level implementation summaries (short, outcome-focused steps)',
          minItems: 1,
          maxItems: 6,
        }),
        validation: Type.Array(Type.String({ maxLength: 180 }), {
          description: 'High-level checks to verify the goal was achieved',
          minItems: 1,
          maxItems: 5,
        }),
        cleanup: Type.Array(Type.String({ maxLength: 180 }), {
          description: 'Post-completion cleanup actions (empty array if none)',
          maxItems: 3,
        }),
      }, { description: 'Execution plan summary — tasks with a plan skip the planning phase and go straight to ready' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { title, content, acceptance_criteria, plan } = params;

      const callbacks = globalThis.__piFactoryShelfCallbacks;
      let createdDraftTask: {
        id: string;
        title: string;
        content: string;
        acceptanceCriteria: string[];
        plan?: {
          goal: string;
          steps: string[];
          validation: string[];
          cleanup: string[];
          generatedAt: string;
        };
        createdAt: string;
      } | null = null;

      if (callbacks) {
        for (const [, cb] of callbacks) {
          createdDraftTask = await cb.createDraftTask({
            title,
            content,
            acceptance_criteria,
            plan,
          });
          break;
        }
      }

      if (!createdDraftTask) {
        return {
          content: [{ type: 'text' as const, text: 'Draft task created (planning callbacks not available — inline card may not appear).' }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Draft task created: "${title}"\n\nAcceptance criteria:\n${acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nThe user can open it from chat to continue refining in the New Task draft screen.`,
        }],
        details: {
          draftTask: createdDraftTask,
        },
      };
    },
  });
}
