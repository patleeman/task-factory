/**
 * Message Agent Extension
 *
 * Registers a `message_agent` tool that lets the planning agent send
 * messages to individual task agents (steer, follow-up, or start/resume chat).
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryMessageAgentCallbacks: Map<string, {
    hasActiveSession: (taskId: string) => boolean;
    steerTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    followUpTask: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    startChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
    resumeChat: (taskId: string, content: string, attachmentIds?: string[]) => Promise<boolean>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'message_agent',
    label: 'Message Task Agent',
    description:
      'Send a message to a specific task agent. ' +
      'Use "steer" to interrupt a running agent with immediate instructions. ' +
      'Use "follow-up" to queue a message for when the agent finishes its current work. ' +
      'Use "chat" to start or resume conversation with a task that has no active session.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'ID of the task to message' }),
      messageType: Type.Union([
        Type.Literal('steer'),
        Type.Literal('follow-up'),
        Type.Literal('chat'),
      ], { description: 'steer=interrupt running agent; follow-up=queue for later; chat=start/resume conversation' }),
      content: Type.String({ description: 'Message content to send' }),
      attachmentIds: Type.Optional(Type.Array(Type.String(), {
        description: 'IDs of attachments to include with the message',
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { taskId, messageType, content, attachmentIds } = params;

      const callbacks = globalThis.__piFactoryMessageAgentCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Message agent callbacks not available.',
          }],
          details: {} as Record<string, unknown>,
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      try {
        const hasActive = cb.hasActiveSession(taskId);
        let result: boolean;
        let actionDescription: string;

        if (messageType === 'steer') {
          if (!hasActive) {
            return {
              content: [{
                type: 'text' as const,
                text: `Cannot steer ${taskId}: no active session. The task may be completed or not yet started. Use "chat" to start/resume conversation.`,
              }],
              details: { hasActiveSession: false },
            };
          }
          result = await cb.steerTask(taskId, content, attachmentIds);
          actionDescription = 'steered';
        } else if (messageType === 'follow-up') {
          if (!hasActive) {
            return {
              content: [{
                type: 'text' as const,
                text: `Cannot follow-up ${taskId}: no active session. The task may be completed or not yet started. Use "chat" to start/resume conversation.`,
              }],
              details: { hasActiveSession: false },
            };
          }
          result = await cb.followUpTask(taskId, content, attachmentIds);
          actionDescription = 'follow-up sent to';
        } else if (messageType === 'chat') {
          // chat works whether or not there's an active session
          if (hasActive) {
            // If there's an active session, treat as follow-up
            result = await cb.followUpTask(taskId, content, attachmentIds);
            actionDescription = 'messaged';
          } else {
            // Try to resume, otherwise start fresh
            const resumed = await cb.resumeChat(taskId, content, attachmentIds);
            if (resumed) {
              result = true;
              actionDescription = 'resumed chat with';
            } else {
              result = await cb.startChat(taskId, content, attachmentIds);
              actionDescription = 'started chat with';
            }
          }
        } else {
          return {
            content: [{ type: 'text' as const, text: `Unknown message type: ${messageType}` }],
            details: {} as Record<string, unknown>,
          };
        }

        if (result) {
          return {
            content: [{ type: 'text' as const, text: `Successfully ${actionDescription} task ${taskId}.` }],
            details: { success: true },
          };
        } else {
          return {
            content: [{ type: 'text' as const, text: `Failed to ${messageType} task ${taskId}.` }],
            details: { success: false },
          };
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message || String(err)}` }],
          details: { error: err.message || String(err) },
        };
      }
    },
  });
}
