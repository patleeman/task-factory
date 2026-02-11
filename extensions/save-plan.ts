/**
 * Save Plan Extension
 *
 * Registers a `save_plan` tool that the planning agent calls to persist
 * a structured task plan. The tool receives typed arguments (goal, steps,
 * validation, cleanup) — no JSON parsing or regex extraction needed.
 *
 * Communication with the server: the agent-execution-service registers a
 * callback on `globalThis.__piFactoryPlanCallbacks` before starting the
 * planning session. The tool looks it up by taskId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

// Shared callback registry (set by agent-execution-service.ts)
declare global {
  var __piFactoryPlanCallbacks: Map<string, (plan: any) => void> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'save_plan',
    label: 'Save Plan',
    description:
      'Save a structured task plan. Call this exactly once after you have finished ' +
      'researching the codebase and are ready to commit your plan. ' +
      'Every field is required.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'The task ID this plan is for (e.g. "PIFA-3")' }),
      goal: Type.String({ description: 'Clear description of what the task achieves' }),
      steps: Type.Array(Type.String(), {
        description: 'Ordered implementation steps — concrete and actionable',
        minItems: 1,
      }),
      validation: Type.Array(Type.String(), {
        description: 'How to verify each step and the overall goal succeeded',
        minItems: 1,
      }),
      cleanup: Type.Array(Type.String(), {
        description: 'Post-completion cleanup actions (can be empty)',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { taskId, goal, steps, validation, cleanup } = params;

      const callbacks = globalThis.__piFactoryPlanCallbacks;
      const cb = callbacks?.get(taskId);

      if (!cb) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Note: save_plan is only available during the planning phase. The plan was not persisted, but your work is captured in the conversation. Continue with your current task.`,
            },
          ],
          details: {} as Record<string, unknown>,
        };
      }

      const plan = {
        goal,
        steps,
        validation,
        cleanup,
        generatedAt: new Date().toISOString(),
      };

      cb(plan);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Plan saved for task ${taskId}.\n\nGoal: ${goal}\nSteps: ${steps.length}\nValidation checks: ${validation.length}\nCleanup items: ${cleanup.length}`,
          },
        ],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
