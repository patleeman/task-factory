/**
 * Save Summary Extension
 *
 * Registers a `save_summary` tool that the executing agent calls after
 * completing a task to provide a detailed execution summary and acceptance
 * criteria validation.
 *
 * The agent has the full conversation context of what it did, so it can
 * write a real summary and evaluate each acceptance criterion with evidence.
 *
 * Communication with the server: the agent-execution-service registers a
 * callback on `globalThis.__piFactorySummaryCallbacks` before prompting
 * for the summary. The tool looks it up by taskId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

interface SummaryData {
  summary: string;
  criteriaValidation: Array<{
    criterion: string;
    status: 'pass' | 'fail' | 'pending';
    evidence: string;
  }>;
}

declare global {
  var __piFactorySummaryCallbacks: Map<string, (data: SummaryData) => void> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'save_summary',
    label: 'Save Execution Summary',
    description:
      'Save a post-execution summary after completing a task. ' +
      'Provide a detailed description of the work done and validate each acceptance criterion. ' +
      'Call this exactly once when asked to summarize your work.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'The task ID (e.g. "PIFA-3")' }),
      summary: Type.String({
        description: 'Detailed description of the work that was done — what changed, why, and key decisions made',
      }),
      criteriaValidation: Type.Array(
        Type.Object({
          criterion: Type.String({ description: 'The acceptance criterion text (copy exactly from the list)' }),
          status: Type.Union([
            Type.Literal('pass'),
            Type.Literal('fail'),
            Type.Literal('pending'),
          ], { description: 'Whether this criterion was met: pass, fail, or pending' }),
          evidence: Type.String({ description: 'Specific evidence — what was done to meet this criterion, or why it was not met' }),
        }),
        { description: 'Validation status for each acceptance criterion' },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { taskId, summary, criteriaValidation } = params;

      const callbacks = globalThis.__piFactorySummaryCallbacks;
      const cb = callbacks?.get(taskId);

      if (!cb) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Note: save_summary callback not registered for task ${taskId}. Summary was not persisted.`,
            },
          ],
          details: {} as Record<string, unknown>,
        };
      }

      cb({ summary, criteriaValidation });

      const passCount = criteriaValidation.filter(c => c.status === 'pass').length;
      const failCount = criteriaValidation.filter(c => c.status === 'fail').length;
      const pendingCount = criteriaValidation.filter(c => c.status === 'pending').length;

      return {
        content: [
          {
            type: 'text' as const,
            text: `Execution summary saved for task ${taskId}.\n\nCriteria: ${passCount} pass, ${failCount} fail, ${pendingCount} pending`,
          },
        ],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
