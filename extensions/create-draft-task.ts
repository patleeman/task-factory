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
    createDraftTask: (args: any) => void;
    createArtifact: (args: any) => void;
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
      type: Type.Union([
        Type.Literal('feature'),
        Type.Literal('bug'),
        Type.Literal('refactor'),
        Type.Literal('research'),
        Type.Literal('spike'),
      ], { description: 'Task type', default: 'feature' }),
      priority: Type.Union([
        Type.Literal('critical'),
        Type.Literal('high'),
        Type.Literal('medium'),
        Type.Literal('low'),
      ], { description: 'Priority level', default: 'medium' }),
      complexity: Type.Union([
        Type.Literal('low'),
        Type.Literal('medium'),
        Type.Literal('high'),
      ], { description: 'Estimated complexity', default: 'medium' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { title, content, acceptance_criteria, type, priority, complexity } = params;

      // Find the active shelf callback (from planning agent session)
      const callbacks = globalThis.__piFactoryShelfCallbacks;
      let called = false;

      if (callbacks) {
        // Try all registered callbacks — the planning agent service will handle routing
        for (const [, cb] of callbacks) {
          cb.createDraftTask({
            title,
            content,
            acceptance_criteria,
            type: type || 'feature',
            priority: priority || 'medium',
            complexity: complexity || 'medium',
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
          text: `Draft task created: "${title}" (${type}, ${priority} priority, ${complexity} complexity)\n\nAcceptance criteria:\n${acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nThe user can review and push this to the backlog.`,
        }],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
