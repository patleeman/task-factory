// =============================================================================
// Task Factory Shared Types
// =============================================================================
// Core type definitions for the TPS-inspired agent work queue system

// =============================================================================
// Task Lifecycle Phases (Kanban Columns)
// =============================================================================

export type Phase =
  | 'backlog'
  | 'ready'
  | 'executing'
  | 'complete'
  | 'archived';

export const PHASES: Phase[] = [
  'backlog',
  'ready',
  'executing',
  'complete',
  'archived',
];

export const PHASE_DISPLAY_NAMES: Record<Phase, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  executing: 'Executing',
  complete: 'Complete',
  archived: 'Archived',
};

/**
 * Returns the next phase a task should be promoted to, or null if already at the end.
 * Special case: complete → archived (standard promotion).
 */
export function getPromotePhase(current: Phase): Phase | null {
  const index = PHASES.indexOf(current);
  if (index < 0 || index >= PHASES.length - 1) return null;
  return PHASES[index + 1];
}

/**
 * Returns the previous phase a task should be demoted to, or null if already at the start.
 * Special cases:
 *   - complete demotes to ready (skip executing — rework pattern)
 *   - archived cannot be demoted (null)
 */
export function getDemotePhase(current: Phase): Phase | null {
  if (current === 'archived') return null;
  if (current === 'complete') return 'ready';
  const index = PHASES.indexOf(current);
  if (index <= 0) return null;
  return PHASES[index - 1];
}

// WIP limits for each phase (null = unlimited)
export const DEFAULT_WIP_LIMITS: Record<Phase, number | null> = {
  backlog: null,
  ready: 25,
  executing: 1,
  complete: null,
  archived: null,
};

// =============================================================================
// Model Configuration (per-task model selection)
// =============================================================================

export interface ModelConfig {
  provider: string;
  modelId: string;
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export interface ModelProfile {
  id: string;
  name: string;
  planningModelConfig: ModelConfig;
  executionModelConfig: ModelConfig;
  /** Legacy alias retained for compatibility with older clients. */
  modelConfig?: ModelConfig;
}

export interface TaskDefaults {
  /** Preferred model for planning runs (acceptance criteria + plan generation). */
  planningModelConfig?: ModelConfig;
  /** Preferred model for execution/rework/chat runs. */
  executionModelConfig?: ModelConfig;
  /**
   * Legacy single-model field. Treated as executionModelConfig when present.
   * Kept for backward compatibility with existing settings/task files.
   */
  modelConfig?: ModelConfig;
  /** Optional reusable model profile ID for planning+execution defaults. */
  defaultModelProfileId?: string;
  /** Pre-planning skills (run before the planning prompt). */
  prePlanningSkills: string[];
  /** Pre-execution skills (run before the execution prompt). */
  preExecutionSkills: string[];
  /** Post-execution skills (run after task_complete). */
  postExecutionSkills: string[];
  /**
   * Custom planning prompt template.
   * When provided, this replaces the built-in planning prompt.
   * The template can use {{variable}} placeholders for dynamic values.
   */
  planningPromptTemplate?: string;
  /**
   * Custom execution prompt template.
   * When provided, this replaces the built-in execution/rework prompt.
   * The template can use {{variable}} placeholders for dynamic values.
   */
  executionPromptTemplate?: string;
}

/**
 * Default planning prompt template.
 * Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},
 * {{acceptanceCriteria}}, {{description}}, {{sharedContext}}, {{attachments}}, {{maxToolCalls}}
 */
export const DEFAULT_PLANNING_PROMPT_TEMPLATE = `# Planning Task: {{title}}

You are a planning agent. Your job is to research the codebase, generate strong acceptance criteria, and then produce a structured plan that is easy for humans to scan quickly.

**Task ID:** {{taskId}}

{{contractReference}}
## Current State
{{stateBlock}}

{{acceptanceCriteria}}
{{description}}
{{sharedContext}}
{{attachments}}
## Instructions

1. Research the codebase to understand the current state. Read relevant files, understand architecture, and trace call sites.
2. You are in planning-only mode. Do not edit files, do not run write/edit tools, and do not implement code changes.
3. Do NOT read other task files in .taskfactory/tasks/ (or legacy .pi/tasks/). They are irrelevant to your investigation and waste your tool budget.
4. From your investigation, produce 3-7 specific, testable acceptance criteria for this task.
5. Then produce a plan that directly satisfies those acceptance criteria.
6. The plan is a high-level task summary for humans. Keep it concise and easy to parse.
7. Keep wording short and scannable: goal should be 1-2 short sentences, and each step/validation/cleanup item should be a short outcome-focused line. Avoid walls of text.
8. Steps should be short outcome-focused summaries (usually 3-6 steps). Avoid line-level implementation details, exact file paths, and low-level function-by-function instructions.
9. Validation items must verify the acceptance criteria and overall outcome without turning into a detailed test script.
10. Call the \`save_plan\` tool **exactly once** with taskId "{{taskId}}", acceptanceCriteria, and a complete \`visualPlan\` payload (include goal/steps/validation/cleanup for migration compatibility).
11. Cleanup items are post-completion tasks (pass an empty array if none needed).
12. After calling \`save_plan\`, stop immediately. Do not run any further tools or actions.
13. Stay within planning guardrails: at most {{maxToolCalls}} tool calls.`;

/**
 * Default execution prompt template.
 * Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},
 * {{acceptanceCriteria}}, {{testingInstructions}}, {{description}}, {{sharedContext}},
 * {{attachments}}, {{skills}}
 */
export const DEFAULT_EXECUTION_PROMPT_TEMPLATE = `# Task: {{title}}

**Task ID:** {{taskId}}

{{contractReference}}
## Current State
{{stateBlock}}

{{acceptanceCriteria}}
{{testingInstructions}}
{{description}}
{{sharedContext}}
{{attachments}}
{{skills}}
## Instructions
1. Start by understanding the task requirements and acceptance criteria
2. Plan your approach before implementing
3. Use the available skills when appropriate
4. Run tests to verify your implementation
5. When you are DONE with the task and all acceptance criteria are met, call the \`task_complete\` tool with this task's ID ("{{taskId}}") and a brief summary (1-2 short sentences, easy to scan).
6. If you have questions, need clarification, or hit a blocker, do NOT call task_complete — just explain the situation and stop. The user will respond.`;

/**
 * Default planning resume prompt template.
 * Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},
 * {{acceptanceCriteria}}, {{description}}, {{sharedContext}}, {{attachments}}, {{maxToolCalls}}
 */
export const DEFAULT_PLANNING_RESUME_PROMPT_TEMPLATE = `# Resume Planning Task: {{title}}

Continue the existing planning conversation for this task. Reuse prior investigation and avoid repeating the same broad repo scans unless needed for new evidence.

**Task ID:** {{taskId}}

{{contractReference}}
## Current State
{{stateBlock}}

{{acceptanceCriteria}}
{{description}}
{{sharedContext}}
{{attachments}}
## Instructions

1. Continue from prior context and investigation.
2. Fill only remaining gaps needed to produce a strong plan package.
3. Do NOT read other task files in .taskfactory/tasks/ (or legacy .pi/tasks/). They are irrelevant and waste your tool budget.
4. Produce 3-7 specific, testable acceptance criteria.
5. Produce a concise high-level plan aligned to those criteria.
6. Keep wording short and easy to scan: goal should be 1-2 short sentences, and each step/validation/cleanup item should be one short line when possible. Avoid walls of text.
7. Call the \`save_plan\` tool exactly once with taskId "{{taskId}}", acceptanceCriteria, and a complete \`visualPlan\` payload (include goal/steps/validation/cleanup for migration compatibility).
8. After calling \`save_plan\`, stop immediately.
9. Stay within planning guardrails: at most {{maxToolCalls}} tool calls.`;

/**
 * Default rework prompt template.
 * Available variables: {{taskId}}, {{title}}, {{stateBlock}}, {{contractReference}},
 * {{acceptanceCriteria}}, {{description}}, {{sharedContext}}, {{attachments}}
 */
export const DEFAULT_REWORK_PROMPT_TEMPLATE = `# Rework: {{title}}

This task was previously completed but has been moved back for rework. You have the full conversation history from the previous execution above.

**Task ID:** {{taskId}}

{{contractReference}}
## Current State
{{stateBlock}}

{{acceptanceCriteria}}
{{description}}
{{sharedContext}}
{{attachments}}
## Instructions
1. Review what was done in the previous execution (you have the full history)
2. Identify what needs to be fixed or improved
3. Make the necessary changes
4. Re-verify all acceptance criteria are met
5. Run tests to confirm everything works
6. When DONE, call the \`task_complete\` tool with task ID "{{taskId}}" and a brief summary (1-2 short sentences, easy to scan).
7. If you have questions or hit a blocker, do NOT call task_complete — just explain and stop.`;

export interface PlanningGuardrails {
  timeoutMs: number;
  maxToolCalls: number;
}

/**
 * Per-workspace foreman (planning agent) settings.
 * Stored in ~/.taskfactory/workspaces/<id>/foreman-settings.json
 */
export interface ForemanSettings {
  /** Model configuration for the foreman/planning agent. */
  modelConfig?: ModelConfig;
}

export const DEFAULT_PLANNING_GUARDRAILS: PlanningGuardrails = {
  timeoutMs: 30 * 60 * 1000,
  maxToolCalls: 100,
};

// =============================================================================
// Task Usage Metrics
// =============================================================================

export interface TaskUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export interface TaskModelUsage extends TaskUsageTotals {
  provider: string;
  modelId: string;
}

export interface TaskUsageMetrics {
  totals: TaskUsageTotals;
  byModel: TaskModelUsage[];
}

function readNumericMetric(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 0 ? value : 0;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed >= 0 ? parsed : 0;
    }
  }

  return 0;
}

function normalizeUsageTotals(value: unknown): TaskUsageTotals {
  const record = (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};

  const inputTokens = readNumericMetric(record.inputTokens ?? record.input);
  const outputTokens = readNumericMetric(record.outputTokens ?? record.output);
  const cacheReadTokens = readNumericMetric(record.cacheReadTokens ?? record.cacheRead);
  const cacheWriteTokens = readNumericMetric(record.cacheWriteTokens ?? record.cacheWrite);

  const explicitTotal = readNumericMetric(record.totalTokens ?? record.total);
  const computedTotal = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  let cost = readNumericMetric(record.cost);
  if (cost === 0 && record.cost && typeof record.cost === 'object' && !Array.isArray(record.cost)) {
    const nested = record.cost as Record<string, unknown>;
    cost = readNumericMetric(nested.total ?? nested.amount ?? nested.usd);
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: explicitTotal > 0 ? explicitTotal : computedTotal,
    cost,
  };
}

function normalizeTaskModelUsage(value: unknown): TaskModelUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
  const modelId = typeof record.modelId === 'string'
    ? record.modelId.trim()
    : typeof record.model === 'string'
      ? record.model.trim()
      : '';

  if (!provider || !modelId) {
    return null;
  }

  const totals = normalizeUsageTotals(record);

  return {
    provider,
    modelId,
    ...totals,
  };
}

export function createEmptyTaskUsageMetrics(): TaskUsageMetrics {
  return {
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      cost: 0,
    },
    byModel: [],
  };
}

function sumTaskUsageTotals(byModel: TaskModelUsage[]): TaskUsageTotals {
  return byModel.reduce<TaskUsageTotals>((acc, usage) => ({
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    cacheReadTokens: acc.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
    totalTokens: acc.totalTokens + usage.totalTokens,
    cost: acc.cost + usage.cost,
  }), createEmptyTaskUsageMetrics().totals);
}

function hasNonZeroUsageTotals(totals: TaskUsageTotals): boolean {
  return totals.inputTokens > 0
    || totals.outputTokens > 0
    || totals.cacheReadTokens > 0
    || totals.cacheWriteTokens > 0
    || totals.totalTokens > 0
    || totals.cost > 0;
}

export function normalizeTaskUsageMetrics(value: unknown): TaskUsageMetrics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyTaskUsageMetrics();
  }

  const record = value as Record<string, unknown>;
  const rawByModel = Array.isArray(record.byModel)
    ? record.byModel
    : Array.isArray(record.models)
      ? record.models
      : [];

  const byModel: TaskModelUsage[] = [];
  const byModelIndex = new Map<string, number>();

  for (const entry of rawByModel) {
    const normalized = normalizeTaskModelUsage(entry);
    if (!normalized) continue;

    const key = `${normalized.provider}::${normalized.modelId}`;
    const existingIndex = byModelIndex.get(key);

    if (existingIndex == null) {
      byModelIndex.set(key, byModel.length);
      byModel.push(normalized);
      continue;
    }

    const existing = byModel[existingIndex];
    byModel[existingIndex] = {
      ...existing,
      inputTokens: existing.inputTokens + normalized.inputTokens,
      outputTokens: existing.outputTokens + normalized.outputTokens,
      cacheReadTokens: existing.cacheReadTokens + normalized.cacheReadTokens,
      cacheWriteTokens: existing.cacheWriteTokens + normalized.cacheWriteTokens,
      totalTokens: existing.totalTokens + normalized.totalTokens,
      cost: existing.cost + normalized.cost,
    };
  }

  const totalsFromModels = sumTaskUsageTotals(byModel);

  let totals = totalsFromModels;
  if (Object.prototype.hasOwnProperty.call(record, 'totals')) {
    const totalsFromRecord = normalizeUsageTotals(record.totals);
    totals = hasNonZeroUsageTotals(totalsFromRecord)
      ? totalsFromRecord
      : totalsFromModels;
  }

  return {
    totals,
    byModel,
  };
}

// =============================================================================
// Task Frontmatter (YAML header in markdown files)
// =============================================================================

export interface TaskFrontmatter {
  // Identity
  id: string;
  title: string;

  // Status
  phase: Phase;

  // Timestamps
  created: string; // ISO 8601
  updated: string; // ISO 8601
  started?: string; // ISO 8601 - when moved to executing
  completed?: string; // ISO 8601 - when moved to complete

  // Assignment
  assigned?: string; // agent ID or null
  workspace: string; // absolute path
  project: string; // project name

  // TPS-inspired metrics
  cycleTime?: number; // seconds, calculated on completion
  leadTime?: number; // seconds, from created to completed
  blockedCount: number;
  blockedDuration: number; // seconds total

  // Planning
  acceptanceCriteria: string[];
  testingInstructions: string[];

  // Execution
  branch?: string;
  commits: string[];
  prUrl?: string;

  // Ordering (position within a column; lower = closer to top)
  order: number;

  // Pre-planning skills (run before main planning prompt)
  prePlanningSkills?: string[];

  // Pre-execution skills (run before main agent execution)
  preExecutionSkills?: string[];

  // Post-execution skills (run after main agent execution)
  postExecutionSkills?: string[];

  // Skill configuration overrides (skillId -> { key -> value })
  skillConfigs?: Record<string, Record<string, string>>;

  // Model configuration (per-task model selection)
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  planningFallbackModels?: ModelConfig[];
  executionFallbackModels?: ModelConfig[];
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;

  // Per-task model usage metrics (tokens/cost, accumulated over time)
  usageMetrics?: TaskUsageMetrics;

  // Plan (auto-generated on task creation)
  plan?: TaskPlan;

  // Planning lifecycle (used to recover interrupted planning after restarts)
  planningStatus?: 'running' | 'completed' | 'error';

  // Attachments (images, files)
  attachments: Attachment[];

  // Agent session file (for resuming conversation on re-execution)
  sessionFile?: string;

  // Post-execution summary (generated after task completion)
  postExecutionSummary?: PostExecutionSummary;

  // Blocker tracking
  blocked: BlockedState;
}

// =============================================================================
// Task Plan (auto-generated on task creation)
// =============================================================================

export interface VisualPlanSectionBase {
  component: string;
  title?: string;
}

export interface SummaryHeroSection extends VisualPlanSectionBase {
  component: 'SummaryHero';
  problem: string;
  insight: string;
  outcome: string;
}

export interface ImpactStatsSection extends VisualPlanSectionBase {
  component: 'ImpactStats';
  stats: Array<{ label: string; value: string; detail?: string }>;
}

export interface MermaidDiagram {
  label: string;
  code: string;
}

export interface ArchitectureDiffSection extends VisualPlanSectionBase {
  component: 'ArchitectureDiff';
  current: MermaidDiagram;
  planned: MermaidDiagram;
  notes?: string[];
}

export interface ChangeListSection extends VisualPlanSectionBase {
  component: 'ChangeList';
  items: Array<{ area: string; change: string; rationale?: string }>;
}

export interface RisksSection extends VisualPlanSectionBase {
  component: 'Risks';
  items: Array<{ risk: string; severity: 'low' | 'medium' | 'high'; mitigation: string }>;
}

export interface OpenQuestionsSection extends VisualPlanSectionBase {
  component: 'OpenQuestions';
  items: Array<{ question: string; owner?: string; status?: 'open' | 'resolved' | 'deferred' }>;
}

export interface ValidationPlanSection extends VisualPlanSectionBase {
  component: 'ValidationPlan';
  checks: string[];
}

export interface DecisionLogSection extends VisualPlanSectionBase {
  component: 'DecisionLog';
  entries: Array<{ decision: string; rationale: string; alternatives?: string[] }>;
}

export interface NextStepsSection extends VisualPlanSectionBase {
  component: 'NextSteps';
  items: string[];
}

export interface FutureWorkSection extends VisualPlanSectionBase {
  component: 'FutureWork';
  items: string[];
}

export interface UnknownVisualPlanSection extends VisualPlanSectionBase {
  component: 'Unknown';
  originalComponent: string;
  reason: string;
  raw?: string;
}

export type VisualPlanSection =
  | SummaryHeroSection
  | ImpactStatsSection
  | ArchitectureDiffSection
  | ChangeListSection
  | RisksSection
  | OpenQuestionsSection
  | ValidationPlanSection
  | DecisionLogSection
  | NextStepsSection
  | FutureWorkSection
  | UnknownVisualPlanSection;

export interface VisualPlan {
  version: '1';
  sections: VisualPlanSection[];
  generatedAt?: string;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function buildUnknownSection(component: unknown, reason: string, raw: unknown): UnknownVisualPlanSection {
  return {
    component: 'Unknown',
    originalComponent: asString(component) || 'unknown',
    reason,
    raw: (() => {
      try {
        return JSON.stringify(raw);
      } catch {
        return asString(raw);
      }
    })(),
  };
}

export function normalizeVisualPlan(input: unknown): VisualPlan | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const sourceSections = Array.isArray(record.sections) ? record.sections : [];
  const sections: VisualPlanSection[] = [];

  for (const source of sourceSections) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      sections.push(buildUnknownSection('unknown', 'invalid-section-shape', source));
      continue;
    }

    const item = source as Record<string, unknown>;
    const component = asString(item.component);

    switch (component) {
      case 'SummaryHero': {
        const problem = asString(item.problem);
        const insight = asString(item.insight);
        const outcome = asString(item.outcome);
        if (!problem || !insight || !outcome) {
          sections.push(buildUnknownSection(component, 'missing-summaryhero-fields', source));
          continue;
        }
        sections.push({ component, title: asString(item.title) || undefined, problem, insight, outcome });
        continue;
      }
      case 'ImpactStats': {
        const stats = Array.isArray(item.stats)
          ? item.stats
            .map((stat) => {
              if (!stat || typeof stat !== 'object' || Array.isArray(stat)) return null;
              const s = stat as Record<string, unknown>;
              const label = asString(s.label);
              const value = asString(s.value);
              if (!label || !value) return null;
              return { label, value, detail: asString(s.detail) || undefined };
            })
            .filter(Boolean) as Array<{ label: string; value: string; detail?: string }>
          : [];
        sections.push({ component, title: asString(item.title) || undefined, stats });
        continue;
      }
      case 'ArchitectureDiff': {
        const currentRaw = item.current as Record<string, unknown> | undefined;
        const plannedRaw = item.planned as Record<string, unknown> | undefined;
        const current = {
          label: asString(currentRaw?.label) || 'Current',
          code: asString(currentRaw?.code),
        };
        const planned = {
          label: asString(plannedRaw?.label) || 'Planned',
          code: asString(plannedRaw?.code),
        };

        if (!current.code || !planned.code) {
          sections.push(buildUnknownSection(component, 'invalid-architecture-diff', source));
          continue;
        }

        sections.push({
          component,
          title: asString(item.title) || undefined,
          current,
          planned,
          notes: asStringList(item.notes),
        });
        continue;
      }
      case 'ChangeList': {
        const items = Array.isArray(item.items)
          ? item.items
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
              const record = entry as Record<string, unknown>;
              const area = asString(record.area);
              const change = asString(record.change);
              if (!area || !change) return null;
              return { area, change, rationale: asString(record.rationale) || undefined };
            })
            .filter(Boolean) as Array<{ area: string; change: string; rationale?: string }>
          : [];
        sections.push({ component, title: asString(item.title) || undefined, items });
        continue;
      }
      case 'Risks': {
        const items = Array.isArray(item.items)
          ? item.items
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
              const record = entry as Record<string, unknown>;
              const risk = asString(record.risk);
              const mitigation = asString(record.mitigation);
              const severity = asString(record.severity) as 'low' | 'medium' | 'high';
              if (!risk || !mitigation || !['low', 'medium', 'high'].includes(severity)) return null;
              return { risk, severity, mitigation };
            })
            .filter(Boolean) as Array<{ risk: string; severity: 'low' | 'medium' | 'high'; mitigation: string }>
          : [];
        sections.push({ component, title: asString(item.title) || undefined, items });
        continue;
      }
      case 'OpenQuestions': {
        const items = Array.isArray(item.items)
          ? item.items
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
              const record = entry as Record<string, unknown>;
              const question = asString(record.question);
              if (!question) return null;
              const status = asString(record.status) as 'open' | 'resolved' | 'deferred';
              return {
                question,
                owner: asString(record.owner) || undefined,
                status: ['open', 'resolved', 'deferred'].includes(status) ? status : undefined,
              };
            })
            .filter(Boolean) as Array<{ question: string; owner?: string; status?: 'open' | 'resolved' | 'deferred' }>
          : [];
        sections.push({ component, title: asString(item.title) || undefined, items });
        continue;
      }
      case 'ValidationPlan': {
        sections.push({ component, title: asString(item.title) || undefined, checks: asStringList(item.checks) });
        continue;
      }
      case 'DecisionLog': {
        const entries = Array.isArray(item.entries)
          ? item.entries
            .map((entry) => {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
              const record = entry as Record<string, unknown>;
              const decision = asString(record.decision);
              const rationale = asString(record.rationale);
              if (!decision || !rationale) return null;
              return { decision, rationale, alternatives: asStringList(record.alternatives) };
            })
            .filter(Boolean) as Array<{ decision: string; rationale: string; alternatives?: string[] }>
          : [];
        sections.push({ component, title: asString(item.title) || undefined, entries });
        continue;
      }
      case 'NextSteps': {
        sections.push({ component, title: asString(item.title) || undefined, items: asStringList(item.items) });
        continue;
      }
      case 'FutureWork': {
        sections.push({ component, title: asString(item.title) || undefined, items: asStringList(item.items) });
        continue;
      }
      default:
        sections.push(buildUnknownSection(component, 'unsupported-component', source));
    }
  }

  if (sections.length === 0) return null;

  return {
    version: '1',
    sections,
    generatedAt: asString(record.generatedAt) || undefined,
  };
}

export function buildVisualPlanFromLegacyPlan(plan: Pick<TaskPlan, 'goal' | 'steps' | 'validation' | 'cleanup' | 'generatedAt'>): VisualPlan {
  return {
    version: '1',
    generatedAt: plan.generatedAt,
    sections: [
      {
        component: 'SummaryHero',
        title: 'Summary',
        problem: plan.goal,
        insight: plan.steps[0] || 'See plan steps for implementation scope.',
        outcome: plan.goal,
      },
      {
        component: 'ChangeList',
        title: 'Planned Changes',
        items: plan.steps.map((step, index) => ({
          area: `Step ${index + 1}`,
          change: step,
        })),
      },
      {
        component: 'ValidationPlan',
        title: 'Validation',
        checks: [...plan.validation],
      },
      {
        component: 'NextSteps',
        title: 'Next Steps',
        items: [...plan.cleanup],
      },
    ],
  };
}

export function buildLegacyPlanFromVisualPlan(visualPlan: VisualPlan): Pick<TaskPlan, 'goal' | 'steps' | 'validation' | 'cleanup'> {
  const summary = visualPlan.sections.find((section): section is SummaryHeroSection => section.component === 'SummaryHero');
  const changes = visualPlan.sections.find((section): section is ChangeListSection => section.component === 'ChangeList');
  const validation = visualPlan.sections.find((section): section is ValidationPlanSection => section.component === 'ValidationPlan');
  const nextSteps = visualPlan.sections.find((section): section is NextStepsSection => section.component === 'NextSteps')
    ?? visualPlan.sections.find((section): section is FutureWorkSection => section.component === 'FutureWork');

  const fallbackStep = visualPlan.sections.find((section): section is ArchitectureDiffSection => section.component === 'ArchitectureDiff');

  return {
    goal: summary?.outcome || summary?.problem || 'Deliver planned changes and validation scope',
    steps: changes?.items.map((item) => item.change).filter(Boolean)
      || (fallbackStep ? [`Update architecture from ${fallbackStep.current.label} to ${fallbackStep.planned.label}`] : []),
    validation: validation?.checks || [],
    cleanup: nextSteps?.items || [],
  };
}

export interface TaskPlan {
  goal: string;          // High-level summary of what the agent is trying to achieve
  steps: string[];       // High-level, outcome-focused steps (not line-level implementation details)
  validation: string[];  // High-level checks for verifying the outcome
  cleanup: string[];     // Post-completion cleanup actions
  visualPlan?: VisualPlan; // Structured primary artifact used by Task Detail renderer
  generatedAt: string;   // ISO 8601 timestamp
}

export function normalizeTaskPlan(plan: unknown): TaskPlan | undefined {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return undefined;

  const record = plan as Record<string, unknown>;
  const generatedAt = asString(record.generatedAt) || new Date().toISOString();

  const goal = asString(record.goal);
  const steps = asStringList(record.steps);
  const validation = asStringList(record.validation);
  const cleanup = asStringList(record.cleanup);

  const normalizedVisualPlan = normalizeVisualPlan(record.visualPlan);

  const visualPlan = normalizedVisualPlan
    ?? (goal || steps.length > 0 || validation.length > 0 || cleanup.length > 0
      ? buildVisualPlanFromLegacyPlan({ goal, steps, validation, cleanup, generatedAt })
      : null);

  if (!visualPlan) {
    return undefined;
  }

  const legacy = goal || steps.length > 0 || validation.length > 0 || cleanup.length > 0
    ? { goal, steps, validation, cleanup }
    : buildLegacyPlanFromVisualPlan(visualPlan);

  return {
    goal: legacy.goal,
    steps: legacy.steps,
    validation: legacy.validation,
    cleanup: legacy.cleanup,
    visualPlan,
    generatedAt,
  };
}

// =============================================================================
// Post-Execution Summary
// =============================================================================

export interface PostExecutionSummary {
  summary: string;           // Short description of work done
  completedAt: string;       // ISO 8601
  fileDiffs: FileDiff[];     // Word-level diffs of changed files
  criteriaValidation: CriterionValidation[];
  artifacts: SummaryArtifact[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  /** 'add' for new text, 'del' for removed text, 'ctx' for unchanged context */
  type: 'add' | 'del' | 'ctx';
  content: string;
}

export type CriterionStatus = 'pass' | 'fail' | 'pending';

export interface CriterionValidation {
  criterion: string;
  status: CriterionStatus;
  evidence: string;
}

export interface SummaryArtifact {
  name: string;
  url: string;
  type: string;  // e.g. 'screenshot', 'log', 'report'
}

export interface BlockedState {
  isBlocked: boolean;
  reason?: string;
  since?: string; // ISO 8601
}

// =============================================================================
// Task (full entity)
// =============================================================================

export interface Task {
  id: string;
  frontmatter: TaskFrontmatter;
  content: string; // markdown body
  history: PhaseTransition[];
  filePath: string;
}

// Note: Chat messages are stored in ActivityLog, not per-task
// This enables the unified timeline view

export interface PhaseTransition {
  from: Phase;
  to: Phase;
  timestamp: string; // ISO 8601
  actor: 'user' | 'agent' | 'system';
  reason?: string;
}

// =============================================================================
// Activity Log (Unified Timeline)
// =============================================================================

export interface ActivityLog {
  workspaceId: string;
  entries: ActivityEntry[];
}

export type ActivityEntry =
  | TaskSeparatorEntry
  | ChatMessageEntry
  | SystemEventEntry;

export interface TaskSeparatorEntry {
  type: 'task-separator';
  id: string;
  taskId: string;
  taskTitle: string;
  phase: Phase;
  timestamp: string; // ISO 8601 - when agent started on this task
  agentId?: string;
}

export interface ChatMessageEntry {
  type: 'chat-message';
  id: string;
  taskId: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string; // ISO 8601
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemEventEntry {
  type: 'system-event';
  id: string;
  taskId: string;
  event: 'phase-change' | 'task-created' | 'task-completed' | 'blocked' | 'unblocked';
  message: string;
  timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Workspace
// =============================================================================

export interface Workspace {
  id: string;
  path: string;
  name: string;
  config: WorkspaceConfig;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceAutomationConfig {
  /** Auto-move backlog tasks to ready when planning completes. */
  backlogToReady?: boolean;
  /** Auto-move ready tasks to executing via queue manager. */
  readyToExecuting?: boolean;
}

export interface WorkspaceAutomationSettings {
  backlogToReady: boolean;
  readyToExecuting: boolean;
}

/** Global workflow defaults persisted in ~/.taskfactory/settings.json. */
export interface WorkflowDefaultsConfig {
  readyLimit?: number;
  executingLimit?: number;
  backlogToReady?: boolean;
  readyToExecuting?: boolean;
}

/** Workspace-level override values (undefined = inherit from global defaults). */
export interface WorkspaceWorkflowOverrides {
  readyLimit?: number;
  executingLimit?: number;
  backlogToReady?: boolean;
  readyToExecuting?: boolean;
}

/** Fully-resolved workflow settings used at runtime. */
export interface WorkspaceWorkflowSettings extends WorkspaceAutomationSettings {
  readyLimit: number;
  executingLimit: number;
}

export interface WorkspaceConfig {
  // Task file locations
  taskLocations: string[]; // directory paths
  defaultTaskLocation: string;

  // Artifact storage root (absolute path). When set, all workspace artifacts
  // (tasks, planning data, shelf, activity, etc.) are stored here instead of
  // <workspace>/.taskfactory. Defaults to ~/.taskfactory/workspaces/<name>/.
  artifactRoot?: string;

  // Records the user's decision about local .taskfactory storage migration.
  // 'leave'  → keep using <workspace>/.taskfactory, suppress future prompts.
  // 'moved'  → data was migrated to artifactRoot, use that going forward.
  localStorageDecision?: 'leave' | 'moved';

  // WIP limits (override defaults)
  wipLimits?: Partial<Record<Phase, number | null>>;

  // Git integration
  gitIntegration?: {
    enabled: boolean;
    defaultBranch: string;
    branchPrefix: string;
  };

  // Queue processing (legacy + runtime persistence for ready→executing auto flow)
  queueProcessing?: {
    enabled: boolean;
  };

  // Workflow automation settings (per-workspace)
  workflowAutomation?: WorkspaceAutomationConfig;
}

const BUILT_IN_READY_LIMIT = typeof DEFAULT_WIP_LIMITS.ready === 'number' && DEFAULT_WIP_LIMITS.ready > 0
  ? DEFAULT_WIP_LIMITS.ready
  : 25;

const BUILT_IN_EXECUTING_LIMIT = typeof DEFAULT_WIP_LIMITS.executing === 'number' && DEFAULT_WIP_LIMITS.executing > 0
  ? DEFAULT_WIP_LIMITS.executing
  : 1;

export const DEFAULT_WORKFLOW_SETTINGS: WorkspaceWorkflowSettings = {
  readyLimit: BUILT_IN_READY_LIMIT,
  executingLimit: BUILT_IN_EXECUTING_LIMIT,
  backlogToReady: false,
  readyToExecuting: true,
};

function sanitizeWorkflowSlotLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

export function resolveGlobalWorkflowSettings(
  defaults: WorkflowDefaultsConfig | null | undefined,
): WorkspaceWorkflowSettings {
  return {
    readyLimit: sanitizeWorkflowSlotLimit(defaults?.readyLimit) ?? DEFAULT_WORKFLOW_SETTINGS.readyLimit,
    executingLimit: sanitizeWorkflowSlotLimit(defaults?.executingLimit) ?? DEFAULT_WORKFLOW_SETTINGS.executingLimit,
    backlogToReady: typeof defaults?.backlogToReady === 'boolean'
      ? defaults.backlogToReady
      : DEFAULT_WORKFLOW_SETTINGS.backlogToReady,
    readyToExecuting: typeof defaults?.readyToExecuting === 'boolean'
      ? defaults.readyToExecuting
      : DEFAULT_WORKFLOW_SETTINGS.readyToExecuting,
  };
}

export function getWorkspaceWorkflowOverrides(config: WorkspaceConfig): WorkspaceWorkflowOverrides {
  const readyLimit = sanitizeWorkflowSlotLimit(config.wipLimits?.ready);
  const executingLimit = sanitizeWorkflowSlotLimit(config.wipLimits?.executing);

  const backlogToReady = typeof config.workflowAutomation?.backlogToReady === 'boolean'
    ? config.workflowAutomation.backlogToReady
    : undefined;

  const readyToExecuting = typeof config.workflowAutomation?.readyToExecuting === 'boolean'
    ? config.workflowAutomation.readyToExecuting
    : typeof config.queueProcessing?.enabled === 'boolean'
      ? config.queueProcessing.enabled
      : undefined;

  return {
    readyLimit,
    executingLimit,
    backlogToReady,
    readyToExecuting,
  };
}

export function resolveWorkspaceWorkflowSettings(
  config: WorkspaceConfig,
  globalDefaults?: WorkflowDefaultsConfig | null,
): WorkspaceWorkflowSettings {
  const defaults = resolveGlobalWorkflowSettings(globalDefaults);
  const overrides = getWorkspaceWorkflowOverrides(config);

  return {
    readyLimit: overrides.readyLimit ?? defaults.readyLimit,
    executingLimit: overrides.executingLimit ?? defaults.executingLimit,
    backlogToReady: overrides.backlogToReady ?? defaults.backlogToReady,
    readyToExecuting: overrides.readyToExecuting ?? defaults.readyToExecuting,
  };
}

export function resolveWorkspaceWipLimit(
  config: WorkspaceConfig,
  phase: Phase,
  globalDefaults?: WorkflowDefaultsConfig | null,
): number | null {
  if (phase === 'ready') {
    return resolveWorkspaceWorkflowSettings(config, globalDefaults).readyLimit;
  }

  if (phase === 'executing') {
    return resolveWorkspaceWorkflowSettings(config, globalDefaults).executingLimit;
  }

  return config.wipLimits?.[phase] ?? DEFAULT_WIP_LIMITS[phase];
}

export function getWorkspaceAutomationSettings(
  config: WorkspaceConfig,
  globalDefaults?: WorkflowDefaultsConfig | null,
): WorkspaceAutomationSettings {
  const resolved = resolveWorkspaceWorkflowSettings(config, globalDefaults);
  return {
    backlogToReady: resolved.backlogToReady,
    readyToExecuting: resolved.readyToExecuting,
  };
}

// =============================================================================
// Agent
// =============================================================================

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  currentTask?: string; // task ID or null
  workspace: string; // workspace ID
  capabilities: string[];
  lastSeen: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Metrics
// =============================================================================

export interface Metrics {
  // Flow metrics
  cycleTime: MetricSummary; // average time from ready -> complete
  leadTime: MetricSummary; // average time from created -> complete
  throughput: number; // tasks completed per day

  // WIP metrics
  currentWip: Record<Phase, number>;
  wipLimitBreaches: number;

  // Quality metrics
  reworkRate: number; // tasks that went back to executing

  // Agent metrics
  agentUtilization: Record<string, number>; // % of time working

  // Time range
  startDate: string;
  endDate: string;
}

export interface MetricSummary {
  average: number; // seconds
  median: number; // seconds
  p95: number; // seconds
  min: number;
  max: number;
}

// =============================================================================
// API Types
// =============================================================================

export interface CreateTaskRequest {
  title?: string; // Auto-generated if not provided
  content: string; // Task description
  acceptanceCriteria?: string[]; // Auto-generated if not provided
  plan?: TaskPlan;
  prePlanningSkills?: string[];
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
  skillConfigs?: Record<string, Record<string, string>>;
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  planningFallbackModels?: ModelConfig[];
  executionFallbackModels?: ModelConfig[];
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
  /** Skip the planning phase and go straight to execution. */
  skipPlanning?: boolean;
}

export interface UpdateTaskRequest {
  title?: string;
  phase?: Phase;
  content?: string;
  acceptanceCriteria?: string[];
  assigned?: string | null;
  plan?: TaskPlan;
  blocked?: Partial<BlockedState>;
  prePlanningSkills?: string[];
  preExecutionSkills?: string[];
  postExecutionSkills?: string[];
  skillConfigs?: Record<string, Record<string, string>>;
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  planningFallbackModels?: ModelConfig[];
  executionFallbackModels?: ModelConfig[];
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
}

export interface MoveTaskRequest {
  toPhase: Phase;
  reason?: string;
}

export interface ReorderTasksRequest {
  phase: Phase;
  taskIds: string[]; // ordered list — index 0 = top of column
}

export interface ClaimTaskRequest {
  agentId: string;
}

// =============================================================================
// WebSocket Events
// =============================================================================

export interface ContextUsageSnapshot {
  /** Estimated tokens in current session context; null when unknown post-compaction. */
  tokens: number | null;
  /** Active model context window size in tokens. */
  contextWindow: number;
  /** Context usage percent of contextWindow; null when tokens are unknown. */
  percent: number | null;
}

export type ServerEvent =
  | { type: 'task:created'; task: Task }
  | { type: 'task:updated'; task: Task; changes: Partial<Task> }
  | { type: 'task:moved'; task: Task; from: Phase; to: Phase }
  | { type: 'task:reordered'; phase: Phase; taskIds: string[] }
  | { type: 'task:claimed'; task: Task; agent: Agent }
  | { type: 'activity:entry'; entry: ActivityEntry }
  | { type: 'agent:status'; agent: Agent }
  | { type: 'metrics:updated'; metrics: Metrics }
  | { type: 'wip:breach'; phase: Phase; current: number; limit: number }
  // Streaming events for live agent output
  | { type: 'agent:streaming_start'; taskId: string }
  | { type: 'agent:streaming_text'; taskId: string; delta: string }
  | { type: 'agent:streaming_end'; taskId: string; fullText: string }
  | { type: 'agent:thinking_delta'; taskId: string; delta: string }
  | { type: 'agent:thinking_end'; taskId: string }
  | { type: 'agent:tool_start'; taskId: string; toolName: string; toolCallId: string }
  | { type: 'agent:tool_update'; taskId: string; toolCallId: string; delta: string }
  | { type: 'agent:tool_end'; taskId: string; toolCallId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'agent:turn_end'; taskId: string }
  | { type: 'agent:execution_status'; taskId: string; status: AgentExecutionStatus; contextUsage?: ContextUsageSnapshot }
  | { type: 'agent:context_usage'; taskId: string; usage: ContextUsageSnapshot | null }
  | { type: 'task:plan_generated'; taskId: string; plan: TaskPlan }
  | { type: 'queue:status'; status: QueueStatus }
  | {
    type: 'workspace:automation_updated';
    workspaceId: string;
    settings: WorkspaceWorkflowSettings;
    overrides?: WorkspaceWorkflowOverrides;
    globalDefaults?: WorkspaceWorkflowSettings;
  }
  | { type: 'idea_backlog:updated'; workspaceId: string; backlog: IdeaBacklog }
  // Planning agent events
  | PlanningEvent;

export type AgentExecutionStatus = 'idle' | 'awaiting_input' | 'streaming' | 'tool_use' | 'thinking' | 'completed' | 'error' | 'pre-planning-hooks' | 'pre-hooks' | 'post-hooks';

export type ClientEvent =
  | { type: 'subscribe'; workspaceId: string }
  | { type: 'unsubscribe'; workspaceId: string }
  | { type: 'task:move'; taskId: string; toPhase: Phase }
  | { type: 'task:claim'; taskId: string; agentId: string }
  | { type: 'activity:send'; taskId: string; content: string; role: 'user' | 'agent' }
  | { type: 'agent:heartbeat'; agentId: string };

// =============================================================================
// Attachments
// =============================================================================

export interface Attachment {
  id: string;
  filename: string;       // original filename
  storedName: string;     // on-disk filename (id + extension)
  mimeType: string;
  size: number;           // bytes
  createdAt: string;      // ISO 8601
}

// =============================================================================
// Queue Manager
// =============================================================================

export type ExecutionBreakerCategory = 'rate_limit' | 'quota' | 'auth';

export interface QueueExecutionBreakerStatus {
  provider: string;
  modelId: string;
  category: ExecutionBreakerCategory;
  openedAt: string;
  retryAt: string;
  remainingMs: number;
  failureCount: number;
  threshold: number;
  cooldownMs: number;
}

export interface QueueStatus {
  workspaceId: string;
  enabled: boolean;
  currentTaskId: string | null;
  tasksInReady: number;
  tasksInExecuting: number;
  executionBreakers?: QueueExecutionBreakerStatus[];
}

export interface WorkspaceWorkflowSettingsResponse {
  /** Legacy alias retained for older clients. */
  settings: WorkspaceAutomationSettings;
  effective: WorkspaceWorkflowSettings;
  overrides: WorkspaceWorkflowOverrides;
  globalDefaults: WorkspaceWorkflowSettings;
  queueStatus: QueueStatus;
}

// =============================================================================
// Planning Agent: Draft Tasks & Artifacts (Shelf)
// =============================================================================

export interface DraftTask {
  id: string;              // temporary ID (e.g. "draft-abc123")
  title: string;
  content: string;         // markdown description
  acceptanceCriteria: string[];
  plan?: TaskPlan;         // optional pre-generated plan
  createdAt: string;       // ISO 8601
}

export interface Artifact {
  id: string;
  name: string;
  html: string;            // raw HTML to render in sandboxed iframe
  createdAt: string;       // ISO 8601
}

export type ShelfItem =
  | { type: 'draft-task'; item: DraftTask }
  | { type: 'artifact'; item: Artifact };

export interface Shelf {
  items: ShelfItem[];
}

// Workspace idea backlog (simple scratch-pad list)
export interface IdeaBacklogItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface IdeaBacklog {
  items: IdeaBacklogItem[];
}

// Planning agent chat message
export interface PlanningMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'qa' | 'system';
  content: string;
  timestamp: string;       // ISO 8601
  sessionId?: string;      // UUID of the planning session this message belongs to
  metadata?: {
    toolName?: string;
    args?: Record<string, unknown>;
    isError?: boolean;
    /** Stable reference for create_artifact tool messages. */
    artifactId?: string;
    artifactName?: string;
    /** Renderable HTML payload for inline artifact reopen in chat history. */
    artifactHtml?: string;
    /** Full draft-task payload for inline task cards in chat history. */
    draftTask?: DraftTask;
    qaRequest?: QARequest;
    qaResponse?: QAResponse;
    [key: string]: unknown;
  };
}

// Planning agent WebSocket events
export type PlanningEvent =
  | { type: 'planning:message'; workspaceId: string; message: PlanningMessage }
  | { type: 'planning:streaming_text'; workspaceId: string; delta: string }
  | { type: 'planning:streaming_end'; workspaceId: string; fullText: string; messageId: string }
  | { type: 'planning:tool_start'; workspaceId: string; toolName: string; toolCallId: string }
  | { type: 'planning:tool_update'; workspaceId: string; toolCallId: string; delta: string }
  | { type: 'planning:tool_end'; workspaceId: string; toolCallId: string; toolName: string; isError: boolean; result?: string }
  | { type: 'planning:thinking_delta'; workspaceId: string; delta: string }
  | { type: 'planning:thinking_end'; workspaceId: string }
  | { type: 'planning:turn_end'; workspaceId: string }
  | { type: 'planning:status'; workspaceId: string; status: PlanningAgentStatus; contextUsage?: ContextUsageSnapshot }
  | { type: 'planning:context_usage'; workspaceId: string; usage: ContextUsageSnapshot | null }
  | { type: 'planning:session_reset'; workspaceId: string; sessionId: string }
  | { type: 'shelf:updated'; workspaceId: string; shelf: Shelf }
  | { type: 'planning:task_form_updated'; workspaceId: string; formState: Partial<NewTaskFormState> }
  | { type: 'qa:request'; workspaceId: string; request: QARequest };

export type PlanningAgentStatus = 'idle' | 'streaming' | 'tool_use' | 'thinking' | 'error' | 'awaiting_qa';

// New task form state (managed by planning agent)
export interface NewTaskFormState {
  content: string;
  selectedSkillIds: string[];
  selectedPreSkillIds?: string[];
  selectedPrePlanningSkillIds?: string[];
  planningModelConfig?: ModelConfig;
  executionModelConfig?: ModelConfig;
  /** Selected reusable model profile ID from settings. */
  selectedModelProfileId?: string;
  /** Legacy single-model field (treated as execution model). */
  modelConfig?: ModelConfig;
  skillOrder?: string[];
}

// =============================================================================
// Q&A Disambiguation
// =============================================================================

export interface QAQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface QARequest {
  requestId: string;
  questions: QAQuestion[];
}

export interface QAAnswer {
  questionId: string;
  selectedOption: string;
}

export interface QAResponse {
  requestId: string;
  answers: QAAnswer[];
}

// =============================================================================
// Utility Types
// =============================================================================

export interface KanbanColumn {
  phase: Phase;
  name: string;
  tasks: Task[];
  wipLimit: number | null;
  count: number;
  isOverLimit: boolean;
}

export interface FilterOptions {
  phase?: Phase;
  assigned?: string;
  search?: string;
}

export interface SortOptions {
  field: 'created' | 'updated' | 'title';
  direction: 'asc' | 'desc';
}

// =============================================================================
// Execution Skills (Agent Skills spec compliant)
// =============================================================================

export type SkillHook = 'pre-planning' | 'pre' | 'post';
export type SkillSource = 'starter' | 'user';

export interface SkillConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default: string;
  description: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];  // for 'select' type
  };
}

export interface PostExecutionSkill {
  id: string;              // directory name, matches frontmatter `name`
  name: string;            // from frontmatter
  description: string;     // from frontmatter
  type: 'follow-up' | 'loop' | 'subagent';
  hooks: SkillHook[];      // supported execution hooks for this skill
  workflowId?: string;     // optional workflow grouping ID (e.g. "tdd")
  pairedSkillId?: string;  // optional paired skill ID for multi-hook workflows
  maxIterations: number;
  doneSignal: string;
  promptTemplate: string;  // SKILL.md body (markdown after frontmatter)
  path: string;            // absolute path to skill directory
  source: SkillSource;     // built-in starter skill vs user-defined skill
  metadata: Record<string, string>;
  configSchema: SkillConfigField[];
}

/** Default pre-planning skills applied to new tasks when none are specified. */
export const DEFAULT_PRE_PLANNING_SKILLS: string[] = [];

/** Default pre-execution skills applied to new tasks when none are specified. */
export const DEFAULT_PRE_EXECUTION_SKILLS: string[] = [];

/** Default post-execution skills applied to new tasks when none are specified. */
export const DEFAULT_POST_EXECUTION_SKILLS: string[] = ['checkpoint', 'code-review', 'update-docs'];
