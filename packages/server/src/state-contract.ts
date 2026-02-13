import type { Phase, TaskFrontmatter } from '@pi-factory/shared';

// =============================================================================
// Agent Roles & Modes
// =============================================================================
//
// Two agent roles:
//
//   foreman     — workspace-level planning agent. Can research, create/delete/
//                 move tasks, manage the shelf. Cannot edit or write code.
//
//   task agent  — scoped to a single task. Three phases:
//
//     planning   — research the workspace, produce a plan via save_plan.
//     execution  — implement the plan. Pre/post hooks run here. Cannot
//                  modify the plan. Signals done via task_complete.
//     complete   — user review & rework. Can do anything except modify
//                  the plan or call task_complete (task is already done).
//

export type AgentMode =
  | 'foreman'
  | 'task_planning'
  | 'task_execution'
  | 'task_complete';

// ---- Mode contracts --------------------------------------------------------

interface ModeContract {
  meaning: string;
  allowed: string[];
  forbidden: string[];
  completion: string;
}

const MODE_CONTRACTS: Record<AgentMode, ModeContract> = {
  foreman: {
    meaning: 'Workspace-level planning agent. Research, create/move/delete tasks, manage shelf. No code changes.',
    allowed: ['read', 'bash', 'ask_questions', 'create_draft_task', 'create_artifact', 'manage_shelf', 'manage_new_task', 'factory_control'],
    forbidden: ['edit', 'write', 'save_plan', 'task_complete'],
    completion: 'Provide planning output and stop unless the user asks for more.',
  },
  task_planning: {
    meaning: 'Research the workspace and produce acceptance criteria plus a plan.',
    allowed: ['read', 'bash', 'save_plan'],
    forbidden: ['edit', 'write', 'task_complete'],
    completion: 'Call save_plan exactly once, then stop.',
  },
  task_execution: {
    meaning: 'Implement the plan. Pre/post execution hooks run around this phase.',
    allowed: ['read', 'bash', 'edit', 'write', 'task_complete', 'attach_task_file'],
    forbidden: ['save_plan'],
    completion: 'Call task_complete when all acceptance criteria are met.',
  },
  task_complete: {
    meaning: 'Task is done. User may chat or request rework. Plan is locked.',
    allowed: ['read', 'bash', 'edit', 'write', 'attach_task_file'],
    forbidden: ['save_plan', 'task_complete'],
    completion: 'Respond to the user. Do not call lifecycle tools.',
  },
};

// ---- Phase meanings (for context injection) --------------------------------

const PHASE_MEANINGS: Record<Phase | 'none', string> = {
  backlog: 'Not executing yet. Planning may be active.',
  ready: 'Planned and queued for execution.',
  executing: 'Agent is actively implementing.',
  complete: 'Done. User is reviewing or requesting rework.',
  archived: 'Historical. Read-only unless reopened.',
  none: 'Workspace-level context (no single task).',
};

// =============================================================================
// Mode Resolution
// =============================================================================

export function resolveTaskMode(frontmatter: Pick<TaskFrontmatter, 'phase' | 'planningStatus' | 'plan'>): AgentMode {
  const phase = frontmatter.phase ?? 'backlog';
  const planningStatus = frontmatter.planningStatus ?? 'none';
  const hasPlan = !!frontmatter.plan;

  if (phase === 'backlog' && planningStatus === 'running' && !hasPlan) {
    return 'task_planning';
  }

  if (phase === 'executing') {
    return 'task_execution';
  }

  if (phase === 'complete') {
    return 'task_complete';
  }

  // backlog (planned or error), ready, archived — all resolve to task_complete
  // because the agent can chat / rework but the plan is locked.
  return 'task_complete';
}

// =============================================================================
// State Snapshot
// =============================================================================

export interface TaskStateSnapshot {
  mode: AgentMode;
  phase: Phase;
  planningStatus: 'running' | 'completed' | 'error' | 'none';
}

export function buildTaskStateSnapshot(
  frontmatter: Pick<TaskFrontmatter, 'phase' | 'planningStatus' | 'plan'>,
): TaskStateSnapshot {
  const phase = (frontmatter.phase ?? 'backlog') as Phase;
  const planningStatus = (frontmatter.planningStatus ?? 'none') as TaskStateSnapshot['planningStatus'];

  return {
    mode: resolveTaskMode(frontmatter),
    phase,
    planningStatus,
  };
}

// =============================================================================
// Contract Text Builders (injected into agent turns)
// =============================================================================

export function buildContractReference(): string {
  let text = '## Agent Contract\n';
  text += 'Obey the current mode block. Do not ask for manual mode changes.\n\n';

  for (const [mode, c] of Object.entries(MODE_CONTRACTS)) {
    text += `- **${mode}**: ${c.meaning}\n`;
    text += `  - Allowed: ${c.allowed.join(', ')}\n`;
    text += `  - Forbidden: ${c.forbidden.join(', ')}\n`;
    text += `  - Completion: ${c.completion}\n`;
  }

  return text;
}

export interface StateBlockInput {
  mode: AgentMode;
  phase: Phase | 'none';
  planningStatus?: string;
}

export function buildStateBlock(input: StateBlockInput): string {
  const planningStatus = input.planningStatus ?? 'none';
  const c = MODE_CONTRACTS[input.mode];
  const phaseMeaning = PHASE_MEANINGS[input.phase];

  return [
    '<state_contract version="2">',
    `  <mode>${input.mode}</mode>`,
    `  <phase>${input.phase}</phase>`,
    `  <planning_status>${planningStatus}</planning_status>`,
    `  <phase_meaning>${phaseMeaning}</phase_meaning>`,
    `  <meaning>${c.meaning}</meaning>`,
    `  <allowed>${c.allowed.join(', ')}</allowed>`,
    `  <forbidden>${c.forbidden.join(', ')}</forbidden>`,
    `  <completion>${c.completion}</completion>`,
    '</state_contract>',
  ].join('\n');
}

export function prependStateToTurn(content: string, input: StateBlockInput): string {
  return `## Current Turn State\n${buildStateBlock(input)}\n\nObey <state_contract> as the highest-priority behavior contract for this turn.\n\n${content}`;
}

// =============================================================================
// Helpers
// =============================================================================

export function getContract(mode: AgentMode): ModeContract {
  return MODE_CONTRACTS[mode];
}

export function isForbidden(mode: AgentMode, action: string): boolean {
  return MODE_CONTRACTS[mode].forbidden.includes(action);
}

/**
 * Strip echoed state-contract scaffolding if the model accidentally repeats
 * the injected turn preamble in assistant output.
 */
export function stripStateContractEcho(text: string): string {
  if (!text.includes('<state_contract')) {
    return text;
  }

  let cleaned = text;

  cleaned = cleaned.replace(
    /^## Current Turn State[\s\S]*?Obey <state_contract> as the highest-priority behavior contract for this turn\.\s*/,
    '',
  );

  cleaned = cleaned.replace(
    /^<state_contract version="[^"]*">[\s\S]*?<\/state_contract>\s*/,
    '',
  );

  return cleaned.trimStart();
}
