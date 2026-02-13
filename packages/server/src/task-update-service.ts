import type { Task, UpdateTaskRequest } from '@pi-factory/shared';
import { logger } from './logger.js';
import { withTimeout } from './with-timeout.js';

const TITLE_REGEN_TIMEOUT_MS = 10_000;

export type TaskTitleGenerator = (
  description: string,
  acceptanceCriteria: string[]
) => Promise<string>;

export interface PreparedTaskUpdate {
  request: UpdateTaskRequest;
  titleRegenerated: boolean;
}

export async function prepareTaskUpdateRequest(
  task: Task,
  request: UpdateTaskRequest,
  generateTitle: TaskTitleGenerator = defaultGenerateTitle,
): Promise<PreparedTaskUpdate> {
  const contentChanged = request.content !== undefined && request.content !== task.content;

  if (!contentChanged) {
    return {
      request,
      titleRegenerated: false,
    };
  }

  const updatedDescription = request.content ?? task.content;
  const updatedCriteria = request.acceptanceCriteria ?? task.frontmatter.acceptanceCriteria ?? [];
  const regeneratedTitle = await regenerateTitleWithFallback(
    updatedDescription,
    updatedCriteria,
    generateTitle,
  );

  return {
    request: {
      ...request,
      title: regeneratedTitle,
    },
    titleRegenerated: true,
  };
}

async function defaultGenerateTitle(
  description: string,
  acceptanceCriteria: string[],
): Promise<string> {
  const { generateTitle } = await import('./title-service.js');
  return generateTitle(description, acceptanceCriteria);
}

async function regenerateTitleWithFallback(
  description: string,
  acceptanceCriteria: string[],
  generateTitle: TaskTitleGenerator,
): Promise<string> {
  try {
    const generatedTitle = await withTimeout(
      () => generateTitle(description, acceptanceCriteria),
      TITLE_REGEN_TIMEOUT_MS,
      `Task title generation timed out after ${TITLE_REGEN_TIMEOUT_MS}ms`,
    );

    const normalizedTitle = normalizeGeneratedTitle(generatedTitle);
    if (normalizedTitle) {
      return normalizedTitle;
    }
  } catch (err) {
    logger.warn('Task title generation failed during update. Using fallback title.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return fallbackTitle(description);
}

function normalizeGeneratedTitle(title: unknown): string {
  if (typeof title !== 'string') {
    return '';
  }

  return title.trim().replace(/^['"]|['"]$/g, '');
}

function fallbackTitle(description: string): string {
  const firstLine = description.split('\n')[0]?.trim() || '';
  if (!firstLine) {
    return 'Untitled Task';
  }

  if (firstLine.length <= 60) {
    return firstLine;
  }

  return `${firstLine.slice(0, 57)}...`;
}
