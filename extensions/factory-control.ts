/**
 * Factory Control Extension
 *
 * Registers a `factory_control` tool that lets the planning agent start and
 * stop the factory queue (task execution pipeline).
 *
 * Communication: uses globalThis.__piFactoryControlCallbacks which the
 * server registers when the planning session is created.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryControlCallbacks: Map<string, {
    getStatus: () => any;
    start: () => any;
    stop: () => any;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'factory_control',
    label: 'Factory Control',
    description:
      'Start or stop the factory queue, or check its status. ' +
      'When started, the factory automatically pulls tasks from the ready queue and executes them. ' +
      'Use "status" to check if the factory is running and how many tasks are queued.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('status'),
        Type.Literal('start'),
        Type.Literal('stop'),
      ], { description: '"status" to check, "start" to begin processing, "stop" to pause' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action } = params;

      const callbacks = globalThis.__piFactoryControlCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Factory control callbacks not available.' }],
          details: {} as Record<string, unknown>,
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      if (action === 'status') {
        const status = cb.getStatus();
        const lines = [
          `**Factory:** ${status.enabled ? 'Running' : 'Stopped'}`,
          `**Tasks in ready queue:** ${status.tasksInReady}`,
          `**Tasks executing:** ${status.tasksInExecuting}`,
        ];
        if (status.currentTaskId) {
          lines.push(`**Currently executing:** ${status.currentTaskId}`);
        }
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          details: {} as Record<string, unknown>,
        };
      }

      if (action === 'start') {
        const status = cb.start();
        return {
          content: [{ type: 'text' as const, text: `Factory started. ${status.tasksInReady} task(s) in ready queue.` }],
          details: {} as Record<string, unknown>,
        };
      }

      if (action === 'stop') {
        const status = cb.stop();
        return {
          content: [{ type: 'text' as const, text: `Factory stopped.${status.currentTaskId ? ` Task ${status.currentTaskId} is still executing and will finish.` : ''}` }],
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
