// =============================================================================
// Summary Service
// =============================================================================
// Generates post-execution summaries with word-level diffs and agent-driven
// summary text + criteria validation.

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
const SUMMARY_PROMPT_TIMEOUT_MS = 90_000; // 90s

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
// Summary Callback Registry
// =============================================================================

interface SummaryCallbackData {
  summary: string;
  criteriaValidation: Array<{
    criterion: string;
    status: 'pass' | 'fail' | 'pending';
    evidence: string;
  }>;
}

declare global {
  var __piFactorySummaryCallbacks: Map<string, (data: SummaryCallbackData) => void> | undefined;
}

function ensureSummaryCallbackRegistry(): Map<string, (data: SummaryCallbackData) => void> {
  if (!globalThis.__piFactorySummaryCallbacks) {
    globalThis.__piFactorySummaryCallbacks = new Map();
  }
  return globalThis.__piFactorySummaryCallbacks;
}

// =============================================================================
// Word-Level Diff Generation
// =============================================================================

/**
 * Escape a string for safe inclusion inside single quotes in a shell command.
 */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/**
 * Generate word-level diffs for all changed files in the workspace.
 * Uses `git --word-diff=porcelain` and limits output.
 */
export function generateWordDiffs(workspacePath: string): FileDiff[] {
  if (!workspacePath) return [];

  try {
    const excludeArgs = EXCLUDE_PATTERNS.map(p => `':(exclude)${p}'`).join(' ');

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
      return [];
    }

    if (changedFiles.length === 0) return [];

    const filesToDiff = changedFiles.slice(0, MAX_FILES);
    const diffs: FileDiff[] = [];

    for (const filePath of filesToDiff) {
      try {
        const safeFilePath = shellEscape(filePath);
        const diffCmd = `git diff HEAD --word-diff=porcelain -- '${safeFilePath}'`;
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
 */
function parseWordDiffPorcelain(raw: string, maxLines: number): DiffHunk[] {
  const lines = raw.split('\n');
  const hunks: DiffHunk[] = [];
  let lineCount = 0;

  for (const line of lines) {
    if (lineCount >= maxLines) break;

    if (line.startsWith('@@') || line.startsWith('diff ') ||
        line.startsWith('index ') || line.startsWith('---') ||
        line.startsWith('+++') || line.startsWith('\\')) {
      continue;
    }

    if (line === '~') {
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
// Agent-Driven Summary Generation
// =============================================================================

/**
 * Build the prompt that asks the agent to summarize and validate criteria.
 */
function buildSummaryPrompt(task: Task): string {
  let prompt = `# Post-Execution Summary\n\n`;
  prompt += `You just completed task **${task.id}**: "${task.frontmatter.title}"\n\n`;
  prompt += `Now provide a post-execution summary by calling the \`save_summary\` tool.\n\n`;

  prompt += `## What to include in the summary\n`;
  prompt += `Write a concise but informative description of what you actually did:\n`;
  prompt += `- What files were changed and why\n`;
  prompt += `- Key implementation decisions\n`;
  prompt += `- Any notable challenges or trade-offs\n`;
  prompt += `- Keep it to 2-4 sentences\n\n`;

  if (task.frontmatter.acceptanceCriteria.length > 0) {
    prompt += `## Acceptance Criteria to Validate\n`;
    prompt += `For each criterion, set status to "pass", "fail", or "pending" with specific evidence:\n\n`;
    task.frontmatter.acceptanceCriteria.forEach((c, i) => {
      prompt += `${i + 1}. ${c}\n`;
    });
    prompt += `\nCopy each criterion text exactly, then provide your assessment.\n\n`;
  }

  prompt += `Call \`save_summary\` with taskId "${task.id}" now.\n`;

  return prompt;
}

/**
 * Prompt the agent session to generate a summary and validate criteria.
 * Returns the agent-provided data, or null if the agent didn't respond.
 */
export async function promptAgentForSummary(
  piSession: { prompt: (content: string) => Promise<void> },
  task: Task,
): Promise<SummaryCallbackData | null> {
  const registry = ensureSummaryCallbackRegistry();
  let savedData: SummaryCallbackData | null = null;

  registry.set(task.id, (data) => {
    savedData = data;
  });

  try {
    const prompt = buildSummaryPrompt(task);

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Summary prompt timed out')), SUMMARY_PROMPT_TIMEOUT_MS);
    });

    await Promise.race([
      piSession.prompt(prompt),
      timeoutPromise,
    ]);
  } catch (err) {
    console.error('[SummaryService] Agent summary prompt failed:', err);
  } finally {
    registry.delete(task.id);
  }

  return savedData;
}

// =============================================================================
// Summary Assembly & Persistence
// =============================================================================

/**
 * Generate and persist a post-execution summary using the agent session.
 * Combines mechanical git diffs with agent-provided summary + criteria validation.
 */
export async function generateAndPersistSummary(
  task: Task,
  piSession: { prompt: (content: string) => Promise<void> } | null,
  fallbackSummary?: string,
): Promise<PostExecutionSummary> {
  const now = new Date().toISOString();

  // Generate word-level diffs mechanically
  const fileDiffs = generateWordDiffs(task.frontmatter.workspace);

  // Try to get agent-driven summary + criteria validation
  let agentData: SummaryCallbackData | null = null;
  if (piSession) {
    agentData = await promptAgentForSummary(piSession, task);
  }

  // Build criteria validation — agent data or fallback to 'pending'
  let criteriaValidation: CriterionValidation[];
  if (agentData?.criteriaValidation && agentData.criteriaValidation.length > 0) {
    criteriaValidation = agentData.criteriaValidation.map((cv) => ({
      criterion: cv.criterion,
      status: cv.status as CriterionStatus,
      evidence: cv.evidence || '',
    }));
  } else {
    criteriaValidation = task.frontmatter.acceptanceCriteria.map((criterion) => ({
      criterion,
      status: 'pending' as CriterionStatus,
      evidence: '',
    }));
  }

  const summary: PostExecutionSummary = {
    summary: agentData?.summary || fallbackSummary || `Task ${task.id} completed.`,
    completedAt: now,
    fileDiffs,
    criteriaValidation,
    artifacts: [],
  };

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
