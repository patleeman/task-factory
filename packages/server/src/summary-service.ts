// =============================================================================
// Summary Service
// =============================================================================
// Generates post-execution summaries with word-level diffs and criteria status.

import { execSync } from 'child_process';
import type {
  Task,
  PostExecutionSummary,
  FileDiff,
  DiffHunk,
  CriterionValidation,
  CriterionStatus,
} from '@pi-factory/shared';
import { saveTaskFile } from './task-service.js';

// =============================================================================
// Configuration
// =============================================================================

const MAX_FILES = 50;
const MAX_LINES_PER_FILE = 500;

// Binary and lock file patterns to exclude from diffs
const EXCLUDE_PATTERNS = [
  '*.lock',
  '*.lockb',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.webp',
  '*.ico',
  '*.svg',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.mp3',
  '*.mp4',
  '*.zip',
  '*.tar',
  '*.gz',
  '*.pdf',
];

// =============================================================================
// Word-Level Diff Generation
// =============================================================================

/**
 * Generate word-level diffs for all changed files in the workspace.
 * Uses `git --word-diff=porcelain` and limits output.
 */
export function generateWordDiffs(workspacePath: string): FileDiff[] {
  try {
    // Build exclude args
    const excludeArgs = EXCLUDE_PATTERNS.map(p => `':(exclude)${p}'`).join(' ');

    // Get list of changed files (staged + unstaged vs HEAD)
    const filesCmd = `git diff HEAD --name-only --diff-filter=ACDMR -- . ${excludeArgs}`;
    let changedFiles: string[];
    try {
      const filesOutput = execSync(filesCmd, {
        cwd: workspacePath,
        encoding: 'utf-8',
        timeout: 15000,
      }).trim();
      changedFiles = filesOutput ? filesOutput.split('\n').filter(Boolean) : [];
    } catch {
      // No git repo or no changes — return empty
      return [];
    }

    if (changedFiles.length === 0) return [];

    // Limit number of files
    const filesToDiff = changedFiles.slice(0, MAX_FILES);
    const diffs: FileDiff[] = [];

    for (const filePath of filesToDiff) {
      try {
        const diffCmd = `git diff HEAD --word-diff=porcelain -- '${filePath}'`;
        const rawDiff = execSync(diffCmd, {
          cwd: workspacePath,
          encoding: 'utf-8',
          timeout: 10000,
        });

        const hunks = parseWordDiffPorcelain(rawDiff, MAX_LINES_PER_FILE);
        if (hunks.length > 0) {
          diffs.push({ filePath, hunks });
        }
      } catch {
        // Skip files that fail to diff (e.g., binary)
        continue;
      }
    }

    return diffs;
  } catch (err) {
    console.error('[SummaryService] Failed to generate word diffs:', err);
    return [];
  }
}

/**
 * Parse `git diff --word-diff=porcelain` output into structured hunks.
 *
 * Porcelain format:
 *   Lines starting with '+' = additions
 *   Lines starting with '-' = deletions
 *   Lines starting with ' ' = context (unchanged)
 *   Lines starting with '~' = newline markers
 *   Lines starting with '@@' = hunk headers
 */
function parseWordDiffPorcelain(raw: string, maxLines: number): DiffHunk[] {
  const lines = raw.split('\n');
  const hunks: DiffHunk[] = [];
  let lineCount = 0;

  for (const line of lines) {
    if (lineCount >= maxLines) break;

    if (line.startsWith('@@')) {
      // Skip hunk headers
      continue;
    }

    if (line.startsWith('diff ') || line.startsWith('index ') ||
        line.startsWith('---') || line.startsWith('+++') ||
        line.startsWith('\\')) {
      // Skip diff metadata lines
      continue;
    }

    if (line === '~') {
      // Newline marker — add as context
      hunks.push({ type: 'ctx', content: '\n' });
      lineCount++;
      continue;
    }

    if (line.startsWith('+')) {
      hunks.push({ type: 'add', content: line.slice(1) });
      lineCount++;
    } else if (line.startsWith('-')) {
      hunks.push({ type: 'del', content: line.slice(1) });
      lineCount++;
    } else if (line.startsWith(' ')) {
      hunks.push({ type: 'ctx', content: line.slice(1) });
      lineCount++;
    }
  }

  return hunks;
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generate a post-execution summary for a completed task.
 * Populates the summary, diffs, and acceptance criteria (set to 'pending').
 */
export function generatePostExecutionSummary(
  task: Task,
  completionSummary?: string,
): PostExecutionSummary {
  const now = new Date().toISOString();

  // Generate word-level diffs from git
  const fileDiffs = generateWordDiffs(task.frontmatter.workspace);

  // Build criteria validation entries (all 'pending' initially)
  const criteriaValidation: CriterionValidation[] =
    task.frontmatter.acceptanceCriteria.map((criterion) => ({
      criterion,
      status: 'pending' as CriterionStatus,
      evidence: '',
    }));

  const summary: PostExecutionSummary = {
    summary: completionSummary || `Task ${task.id} completed.`,
    completedAt: now,
    fileDiffs,
    criteriaValidation,
    artifacts: [],
  };

  return summary;
}

/**
 * Generate and persist a post-execution summary on a task.
 * Returns the generated summary.
 */
export function generateAndPersistSummary(
  task: Task,
  completionSummary?: string,
): PostExecutionSummary {
  const summary = generatePostExecutionSummary(task, completionSummary);

  task.frontmatter.postExecutionSummary = summary;
  task.frontmatter.updated = new Date().toISOString();
  saveTaskFile(task);

  return summary;
}

/**
 * Update a specific criterion's validation status.
 */
export function updateCriterionStatus(
  task: Task,
  index: number,
  status: CriterionStatus,
  evidence: string,
): PostExecutionSummary | null {
  const summary = task.frontmatter.postExecutionSummary;
  if (!summary) return null;

  if (index < 0 || index >= summary.criteriaValidation.length) return null;

  summary.criteriaValidation[index].status = status;
  summary.criteriaValidation[index].evidence = evidence;

  task.frontmatter.updated = new Date().toISOString();
  saveTaskFile(task);

  return summary;
}
