/**
 * Task Complete Extension
 *
 * Registers a `task_complete` tool that the executing agent calls to signal
 * it has finished the task and it's ready to move to the next pipeline stage.
 *
 * If the agent finishes without calling this tool (e.g., it asks a question
 * or flags a blocker), the task stays in "executing" — the production line
 * stops and waits for the user to respond.
 *
 * Communication with the server: the agent-execution-service registers a
 * callback on `globalThis.__piFactoryCompleteCallbacks` before starting the
 * execution session. The tool looks it up by taskId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

// Shared callback registry (set by agent-execution-service.ts)
declare global {
  var __piFactoryCompleteCallbacks: Map<string, (summary: string) => void> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'task_complete',
    label: 'Mark Task Complete',
    description:
      'Signal that you have finished the task and it is ready to move to the next pipeline stage. ' +
      'Call this ONLY when all acceptance criteria are met and you are confident the task is done. ' +
      'If you have questions, need clarification, or hit a blocker, do NOT call this — ' +
      'just explain the situation and the user will respond.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'The task ID (e.g. "PIFA-3")' }),
      summary: Type.String({ description: 'Brief, easy-to-scan summary of what was accomplished (1-2 short sentences)' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { taskId, summary } = params;

      const callbacks = globalThis.__piFactoryCompleteCallbacks;
      const cb = callbacks?.get(taskId);

      if (!cb) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Note: task_complete is only available during execution. The completion signal was not recorded.`,
            },
          ],
          details: {} as Record<string, unknown>,
        };
      }

      cb(summary);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Task ${taskId} marked as complete. Summary: ${summary}`,
          },
        ],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
