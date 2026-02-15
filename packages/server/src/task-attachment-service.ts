// =============================================================================
// Task Attachment Service
// =============================================================================
// Handles attaching local files to task metadata/storage without going
// through HTTP multipart upload routes.

import { existsSync } from 'fs';
import { copyFile, mkdir, stat, unlink } from 'fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'path';
import type { Attachment, Task } from '@pi-factory/shared';
import { parseTaskFile, saveTaskFile, getTaskFilePath, getTaskAttachmentsDir as getTaskAttachmentsDirFromService } from './task-service.js';
import {
  loadWorkspaceConfigFromDiskSync,
  resolveExistingTasksDirFromWorkspacePath,
} from './workspace-storage.js';

export interface AttachTaskFileRequest {
  path: string;
  filename?: string;
}

export interface AttachTaskFileResult {
  task: Task;
  attachment: Attachment;
  sourcePath: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

function resolveWorkspaceTasksDir(workspacePath: string): string {
  const workspaceConfig = loadWorkspaceConfigFromDiskSync(workspacePath);
  return resolveExistingTasksDirFromWorkspacePath(workspacePath, workspaceConfig);
}

function resolveTaskFilePath(workspacePath: string, taskId: string): string {
  const tasksDir = resolveWorkspaceTasksDir(workspacePath);
  return getTaskFilePath(tasksDir, taskId);
}

function resolveTaskAttachmentsDir(workspacePath: string, taskId: string): string {
  const tasksDir = resolveWorkspaceTasksDir(workspacePath);
  return getTaskAttachmentsDirFromService(tasksDir, taskId);
}

function resolveSourcePath(workspacePath: string, sourcePath: string): string {
  if (typeof sourcePath !== 'string') {
    throw new Error('path must be a string');
  }

  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) {
    throw new Error('path is required');
  }

  return isAbsolute(trimmedPath) ? trimmedPath : resolve(workspacePath, trimmedPath);
}

function resolveAttachmentFilename(sourcePath: string, providedFilename?: string): string {
  if (typeof providedFilename === 'string') {
    const trimmed = providedFilename.trim();
    if (trimmed) {
      return basename(trimmed);
    }
  }

  const sourceName = basename(sourcePath);
  return sourceName || 'attachment';
}

function inferMimeType(filename: string, sourcePath: string): string {
  const filenameExt = extname(filename).toLowerCase();
  const sourceExt = extname(sourcePath).toLowerCase();

  if (sourceExt && MIME_BY_EXTENSION[sourceExt]) {
    return MIME_BY_EXTENSION[sourceExt];
  }

  if (filenameExt && MIME_BY_EXTENSION[filenameExt]) {
    return MIME_BY_EXTENSION[filenameExt];
  }

  return 'application/octet-stream';
}

function loadTaskFromDisk(workspacePath: string, taskId: string): Task {
  const taskFilePath = resolveTaskFilePath(workspacePath, taskId);
  if (!existsSync(taskFilePath)) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return parseTaskFile(taskFilePath);
}

export async function attachTaskFileToTask(
  workspacePath: string,
  taskId: string,
  request: AttachTaskFileRequest,
): Promise<AttachTaskFileResult> {
  const sourcePath = resolveSourcePath(workspacePath, request.path);

  let sourceStats;
  try {
    sourceStats = await stat(sourcePath);
  } catch {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  if (!sourceStats.isFile()) {
    throw new Error(`Source path is not a file: ${sourcePath}`);
  }

  const originalFilename = resolveAttachmentFilename(sourcePath, request.filename);
  const storedExtension = extname(originalFilename) || extname(sourcePath);
  const attachmentId = crypto.randomUUID().slice(0, 8);
  const storedName = `${attachmentId}${storedExtension}`;
  const now = new Date().toISOString();

  const attachmentsDir = resolveTaskAttachmentsDir(workspacePath, taskId);
  await mkdir(attachmentsDir, { recursive: true });

  const destinationPath = join(attachmentsDir, storedName);
  await copyFile(sourcePath, destinationPath);

  try {
    const latestTask = loadTaskFromDisk(workspacePath, taskId);

    const attachment: Attachment = {
      id: attachmentId,
      filename: originalFilename,
      storedName,
      mimeType: inferMimeType(originalFilename, sourcePath),
      size: sourceStats.size,
      createdAt: now,
    };

    latestTask.frontmatter.attachments = [
      ...(latestTask.frontmatter.attachments || []),
      attachment,
    ];
    latestTask.frontmatter.updated = now;
    saveTaskFile(latestTask);

    return {
      task: latestTask,
      attachment,
      sourcePath,
    };
  } catch (err) {
    await unlink(destinationPath).catch(() => undefined);
    throw err;
  }
}

export async function attachTaskFileAndBroadcast(
  workspacePath: string,
  taskId: string,
  request: AttachTaskFileRequest,
  broadcastToWorkspace?: (event: any) => void,
): Promise<AttachTaskFileResult> {
  const result = await attachTaskFileToTask(workspacePath, taskId, request);

  broadcastToWorkspace?.({
    type: 'task:updated',
    task: result.task,
    changes: {},
  });

  return result;
}
