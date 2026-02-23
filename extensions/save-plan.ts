/**
 * Save Plan Extension
 *
 * Registers a `save_plan` tool that task turns can call to persist
 * acceptance criteria and a structured task plan.
 * The tool receives typed arguments (acceptance criteria + visualPlan as
 * primary payload, with legacy goal/steps/validation/cleanup support for
 * migration) — no JSON parsing or regex extraction needed.
 *
 * Communication with the server: the agent-execution-service registers a
 * callback on `globalThis.__piFactoryPlanCallbacks` before starting the
 * planning session. The tool looks it up by taskId and calls it.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
type VisualPlanTemplateType =
  | 'feature-delivery'
  | 'bug-fix'
  | 'refactor'
  | 'testing-plan'
  | 'migration-rollout'
  | 'research-spike'
  | 'custom';

interface VisualPlan {
  version: '1';
  planType?: VisualPlanTemplateType;
  sections: Array<Record<string, unknown>>;
  generatedAt?: string;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizeVisualPlan(input: unknown): VisualPlan | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.sections) || record.sections.length === 0) return null;

  const sections: Array<Record<string, unknown>> = [];

  for (const sourceSection of record.sections) {
    if (!sourceSection || typeof sourceSection !== 'object' || Array.isArray(sourceSection)) {
      sections.push({
        component: 'Unknown',
        originalComponent: 'unknown',
        reason: 'invalid-section-shape',
      });
      continue;
    }

    const section = sourceSection as Record<string, unknown>;
    const component = typeof section.component === 'string' ? section.component : '';

    if (component === 'ArchitectureDiff') {
      const current = section.current as Record<string, unknown> | undefined;
      const planned = section.planned as Record<string, unknown> | undefined;
      const currentCode = typeof current?.code === 'string' ? current.code.trim() : '';
      const plannedCode = typeof planned?.code === 'string' ? planned.code.trim() : '';

      if (!currentCode || !plannedCode) {
        sections.push({
          component: 'Unknown',
          originalComponent: component || 'ArchitectureDiff',
          reason: 'invalid-architecture-diff',
        });
        continue;
      }
    }

    sections.push(section);
  }

  if (sections.length === 0) return null;

  const planTypeRaw = typeof record.planType === 'string' ? record.planType : '';
  const planType = [
    'feature-delivery',
    'bug-fix',
    'refactor',
    'testing-plan',
    'migration-rollout',
    'research-spike',
    'custom',
  ].includes(planTypeRaw)
    ? planTypeRaw as VisualPlanTemplateType
    : undefined;

  return {
    version: '1',
    planType,
    sections,
    generatedAt: typeof record.generatedAt === 'string' && record.generatedAt
      ? record.generatedAt
      : undefined,
  };
}

function buildVisualPlanFromLegacyPlan(plan: { goal: string; steps: string[]; validation: string[]; cleanup: string[]; generatedAt: string }): VisualPlan {
  return {
    version: '1',
    planType: 'custom',
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
        items: plan.steps.map((step, index) => ({ area: `Step ${index + 1}`, change: step })),
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

function buildLegacyPlanFromVisualPlan(visualPlan: VisualPlan): { goal: string; steps: string[]; validation: string[]; cleanup: string[] } {
  const find = (name: string): Record<string, unknown> | undefined => visualPlan.sections.find((section) => section.component === name);

  const summary = find('SummaryHero');
  const changeList = find('ChangeList');
  const validationPlan = find('ValidationPlan');
  const nextSteps = find('NextSteps') ?? find('FutureWork');

  const goal = typeof summary?.outcome === 'string'
    ? summary.outcome
    : (typeof summary?.problem === 'string' ? summary.problem : 'Deliver planned changes and validation scope');

  const steps = Array.isArray(changeList?.items)
    ? changeList.items
      .map((item) => (item && typeof item === 'object' && typeof (item as Record<string, unknown>).change === 'string'
        ? String((item as Record<string, unknown>).change)
        : ''))
      .filter(Boolean)
    : [];

  const validation = normalizeStringList((validationPlan as Record<string, unknown> | undefined)?.checks);
  const cleanup = normalizeStringList((nextSteps as Record<string, unknown> | undefined)?.items);

  return { goal, steps, validation, cleanup };
}

interface SavedPlanningData {
  acceptanceCriteria: string[];
  plan: {
    goal: string;
    steps: string[];
    validation: string[];
    cleanup: string[];
    visualPlan: VisualPlan;
    generatedAt: string;
  };
}

// Shared callback registry (set by agent-execution-service.ts)
declare global {
  var __piFactoryPlanCallbacks: Map<string, (data: SavedPlanningData) => void | Promise<void>> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'save_plan',
    label: 'Save Plan',
    description:
      'Save investigated acceptance criteria and a structured task plan. ' +
      'Call this exactly once after investigation is complete and criteria are finalized. ' +
      'Plans are user-facing summaries: keep them concise, easy to scan, and not file-by-file implementation checklists.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'The task ID this plan is for (e.g. "PIFA-3")' }),
      acceptanceCriteria: Type.Array(Type.String(), {
        description: 'Specific, testable acceptance criteria derived from investigation',
        minItems: 1,
      }),
      visualPlan: Type.Optional(Type.Object({
        version: Type.Optional(Type.String()),
        planType: Type.Optional(Type.Union([
          Type.Literal('feature-delivery'),
          Type.Literal('bug-fix'),
          Type.Literal('refactor'),
          Type.Literal('testing-plan'),
          Type.Literal('migration-rollout'),
          Type.Literal('research-spike'),
          Type.Literal('custom'),
        ])),
        sections: Type.Array(Type.Any(), { minItems: 1 }),
        generatedAt: Type.Optional(Type.String()),
      }, {
        description: 'Primary structured plan artifact: typed visual sections including architecture diff diagrams.',
      })),
      goal: Type.Optional(Type.String({
        description: 'Legacy compatibility: concise summary of what the task achieves',
        maxLength: 220,
      })),
      steps: Type.Optional(Type.Array(Type.String({ maxLength: 180 }), {
        description: 'Legacy compatibility: high-level implementation summaries',
        minItems: 1,
        maxItems: 6,
      })),
      validation: Type.Optional(Type.Array(Type.String({ maxLength: 180 }), {
        description: 'Legacy compatibility: high-level outcome checks',
        minItems: 1,
        maxItems: 5,
      })),
      cleanup: Type.Optional(Type.Array(Type.String({ maxLength: 180 }), {
        description: 'Legacy compatibility: post-completion cleanup actions',
        maxItems: 3,
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const {
        taskId,
        acceptanceCriteria,
        visualPlan: rawVisualPlan,
        goal: rawLegacyGoal,
        steps: rawLegacySteps,
        validation: rawLegacyValidation,
        cleanup: rawLegacyCleanup,
      } = params;

      const callbacks = globalThis.__piFactoryPlanCallbacks;
      const cb = callbacks?.get(taskId);

      if (!cb) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'save_plan is unavailable right now. ' +
                'It is available in planning/chat/rework turns and unavailable while executing.',
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const normalizedAcceptanceCriteria = acceptanceCriteria
        .map((criterion: string) => criterion.trim())
        .filter(Boolean);

      if (normalizedAcceptanceCriteria.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'save_plan requires at least one non-empty acceptance criterion. Please provide clear criteria and try again.',
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const generatedAt = new Date().toISOString();

      const normalizedVisualPlan = normalizeVisualPlan(rawVisualPlan);

      const legacyGoal = typeof rawLegacyGoal === 'string' ? rawLegacyGoal : '';
      const legacySteps = Array.isArray(rawLegacySteps) ? rawLegacySteps.map(String).filter(Boolean) : [];
      const legacyValidation = Array.isArray(rawLegacyValidation) ? rawLegacyValidation.map(String).filter(Boolean) : [];
      const legacyCleanup = Array.isArray(rawLegacyCleanup) ? rawLegacyCleanup.map(String).filter(Boolean) : [];

      const visualPlan = normalizedVisualPlan
        ?? (legacyGoal || legacySteps.length > 0 || legacyValidation.length > 0 || legacyCleanup.length > 0
          ? buildVisualPlanFromLegacyPlan({
              goal: legacyGoal,
              steps: legacySteps,
              validation: legacyValidation,
              cleanup: legacyCleanup,
              generatedAt,
            })
          : null);

      if (!visualPlan) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'save_plan requires a valid visualPlan payload or valid legacy goal/steps/validation/cleanup fields.',
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      const legacyFromVisual = buildLegacyPlanFromVisualPlan(visualPlan);

      const plan = {
        goal: legacyGoal || legacyFromVisual.goal,
        steps: legacySteps.length > 0 ? legacySteps : legacyFromVisual.steps,
        validation: legacyValidation.length > 0 ? legacyValidation : legacyFromVisual.validation,
        cleanup: legacyCleanup.length > 0 ? legacyCleanup : legacyFromVisual.cleanup,
        visualPlan,
        generatedAt,
      };

      try {
        await cb({
          acceptanceCriteria: normalizedAcceptanceCriteria,
          plan,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `save_plan failed for task ${taskId}: ${message}`,
            },
          ],
          details: {} as Record<string, unknown>,
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Planning package saved for task ${taskId}.\n\nAcceptance criteria: ${normalizedAcceptanceCriteria.length}\nSections: ${visualPlan.sections.length}\nGoal: ${plan.goal}\nSteps: ${plan.steps.length}\nValidation checks: ${plan.validation.length}\nCleanup items: ${plan.cleanup.length}`,
          },
        ],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
