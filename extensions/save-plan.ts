/**
 * Save Plan Extension
 *
 * Registers a `save_plan` tool that task turns can call to persist
 * acceptance criteria and a structured task plan.
 * The tool receives typed arguments (acceptance criteria, goal, steps,
 * validation, cleanup) — no JSON parsing or regex extraction needed.
 *
 * Communication with the server: the agent-execution-service registers a
 * callback on `globalThis.__piFactoryPlanCallbacks` before starting the
 * planning session. The tool looks it up by taskId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

interface SavedPlanningData {
  acceptanceCriteria: string[];
  plan: {
    goal: string;
    steps: string[];
    validation: string[];
    cleanup: string[];
    generatedAt: string;
  };
}

// Shared callback registry (set by agent-execution-service.ts)
declare global {
  var __piFactoryPlanCallbacks: Map<string, (data: SavedPlanningData) => void | Promise<void>> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'save_plan',
    label: 'Save Plan',
    description:
      'Save investigated acceptance criteria and a structured task plan. ' +
      'Call this exactly once after investigation is complete and criteria are finalized. ' +
      'Plans are user-facing summaries: keep them concise, easy to scan, and not file-by-file implementation checklists.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'The task ID this plan is for (e.g. "PIFA-3")' }),
      acceptanceCriteria: Type.Array(Type.String(), {
        description: 'Specific, testable acceptance criteria derived from investigation',
        minItems: 1,
      }),
      goal: Type.String({
        description: 'Concise single-sentence summary of what the task achieves',
        maxLength: 220,
      }),
      steps: Type.Array(Type.String({ maxLength: 180 }), {
        description: 'High-level implementation summaries (short, outcome-focused steps)',
        minItems: 1,
        maxItems: 6,
      }),
      validation: Type.Array(Type.String({ maxLength: 180 }), {
        description: 'High-level checks that verify acceptance criteria and overall outcome',
        minItems: 1,
        maxItems: 5,
      }),
      cleanup: Type.Array(Type.String({ maxLength: 180 }), {
        description: 'Post-completion cleanup actions (can be empty)',
        maxItems: 3,
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { taskId, acceptanceCriteria, goal, steps, validation, cleanup } = params;

      const callbacks = globalThis.__piFactoryPlanCallbacks;
      const cb = callbacks?.get(taskId);

      if (!cb) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'save_plan is unavailable right now. ' +
                'It is available in planning/chat/rework turns and unavailable while executing.',
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const normalizedAcceptanceCriteria = acceptanceCriteria
        .map((criterion: string) => criterion.trim())
        .filter(Boolean);

      if (normalizedAcceptanceCriteria.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'save_plan requires at least one non-empty acceptance criterion. Please provide clear criteria and try again.',
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const plan = {
        goal,
        steps,
        validation,
        cleanup,
        generatedAt: new Date().toISOString(),
      };

      try {
        await cb({
          acceptanceCriteria: normalizedAcceptanceCriteria,
          plan,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `save_plan failed for task ${taskId}: ${message}`,
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Planning package saved for task ${taskId}.\n\nAcceptance criteria: ${normalizedAcceptanceCriteria.length}\nGoal: ${goal}\nSteps: ${steps.length}\nValidation checks: ${validation.length}\nCleanup items: ${cleanup.length}`,
          },
        ],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
