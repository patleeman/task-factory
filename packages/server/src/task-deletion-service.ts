import type { Task } from '@task-factory/shared';
import { deleteTask } from './task-service.js';
import { stopTaskExecution } from './agent-execution-service.js';

export interface DeleteTaskLifecycleResult {
  stoppedSession: boolean;
}

/**
 * Deletes a task after stopping any active planning/execution session.
 * Keeps delete behavior consistent across API and extension entry points.
 */
export async function deleteTaskWithLifecycle(task: Task): Promise<DeleteTaskLifecycleResult> {
  const stoppedSession = await stopTaskExecution(task.id);
  deleteTask(task);
  return { stoppedSession };
}
