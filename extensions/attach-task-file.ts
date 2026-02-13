/**
 * Attach Task File Extension
 *
 * Registers an `attach_task_file` tool so agents/skills can attach a local file
 * (for example, a screenshot) to a task during execution.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

interface AttachTaskFileRequest {
  path: string;
  filename?: string;
}

interface AttachTaskFileResult {
  taskId: string;
  attachmentId: string;
  filename: string;
  storedName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

declare global {
  var __piFactoryAttachFileCallbacks: Map<string, (data: AttachTaskFileRequest) => Promise<AttachTaskFileResult>> | undefined;
}

function resolveTaskId(taskId: string | undefined, callbacks: Map<string, unknown>): { taskId?: string; error?: string } {
  const normalized = taskId?.trim();
  if (normalized) {
    return { taskId: normalized };
  }

  if (callbacks.size === 1) {
    const singleTaskId = callbacks.keys().next().value as string;
    return { taskId: singleTaskId };
  }

  return {
    error:
      'attach_task_file requires taskId when multiple tasks are active. ' +
      'Provide taskId explicitly (e.g. "PIFA-60").',
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'attach_task_file',
    label: 'Attach Task File',
    description:
      'Attach a local file to a task. Use for artifacts like screenshots generated during validation. ' +
      'Accepts a local file path plus optional taskId and filename override.',
    parameters: Type.Object({
      path: Type.String({
        description: 'Local file path to attach (absolute or relative to workspace)',
      }),
      taskId: Type.Optional(Type.String({
        description: 'Task ID to attach the file to (optional if only one task callback is active)',
      })),
      filename: Type.Optional(Type.String({
        description: 'Optional attachment filename shown in the UI (defaults to source basename)',
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const callbacks = globalThis.__piFactoryAttachFileCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text:
              'attach_task_file is unavailable: no active task callback is registered. ' +
              'Use this tool during an active task execution session.',
          }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const { taskId, error } = resolveTaskId(params.taskId, callbacks as Map<string, unknown>);
      if (error || !taskId) {
        return {
          content: [{ type: 'text' as const, text: error || 'Unable to resolve target taskId.' }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const callback = callbacks.get(taskId);
      if (!callback) {
        return {
          content: [{
            type: 'text' as const,
            text: `attach_task_file failed: no active callback registered for task ${taskId}.`,
          }],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      try {
        const result = await callback({
          path: params.path,
          filename: params.filename,
        });

        return {
          content: [{
            type: 'text' as const,
            text:
              `Attached file to task ${result.taskId}: ${result.filename} ` +
              `(id: ${result.attachmentId}, size: ${result.size} bytes).`,
          }],
          details: {
            taskId: result.taskId,
            attachmentId: result.attachmentId,
            filename: result.filename,
            storedName: result.storedName,
            mimeType: result.mimeType,
            size: result.size,
            createdAt: result.createdAt,
          } as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: `attach_task_file failed: ${message}`,
          }],
          details: { taskId } as Record<string, unknown>,
          isError: true,
        };
      }
    },
  });
}
