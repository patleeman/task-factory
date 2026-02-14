/**
 * Create Draft Task Extension
 *
 * Registers a `create_draft_task` tool that the planning agent calls to
 * stage a new task on the shelf. The task is not yet committed to the
 * backlog — the user reviews and pushes it.
 *
 * Communication with the server: the planning-agent-service registers a
 * callback on `globalThis.__piFactoryShelfCallbacks` before starting the
 * session. The tool looks it up by workspaceId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<void>;
    createArtifact: (args: any) => Promise<{ id: string; name: string }>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_draft_task',
    label: 'Create Draft Task',
    description:
      'Create a draft task on the shelf. The user will review it before pushing to the backlog. ' +
      'Use this to break down work into small, focused tasks with clear acceptance criteria.',
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

      // Find the active shelf callback (from planning agent session)
      const callbacks = globalThis.__piFactoryShelfCallbacks;
      let called = false;

      if (callbacks) {
        // Try all registered callbacks — the planning agent service will handle routing
        for (const [, cb] of callbacks) {
          await cb.createDraftTask({
            title,
            content,
            acceptance_criteria,
            plan,
          });
          called = true;
          break; // Only call the first one (there should only be one active)
        }
      }

      if (!called) {
        return {
          content: [{ type: 'text' as const, text: 'Draft task created (shelf callbacks not available — task may not appear on shelf).' }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Draft task created: "${title}"\n\nAcceptance criteria:\n${acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nThe user can review and push this to the backlog.`,
        }],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
