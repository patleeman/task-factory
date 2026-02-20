import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import savePlanExtension from '../../../extensions/save-plan.ts';

function extractResultText(result: any): string {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((entry: any) => entry?.type === 'text' && typeof entry.text === 'string')
    .map((entry: any) => entry.text)
    .join('\n');
}

describe('save_plan extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    savePlanExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    const globalObj = globalThis as any;
    delete globalObj.__piFactoryPlanCallbacks;
  });

  it('declares a strongly typed visualPlan section schema', () => {
    const sectionItems = tool.parameters?.properties?.visualPlan?.properties?.sections?.items;

    expect(Array.isArray(sectionItems?.anyOf)).toBe(true);
    expect(sectionItems.anyOf.length).toBeGreaterThanOrEqual(10);

    const componentLiterals = sectionItems.anyOf
      .map((schema: any) => schema?.properties?.component?.const)
      .filter(Boolean);

    const componentSet = new Set(componentLiterals);
    expect(componentSet.has('SummaryHero')).toBe(true);
    expect(componentSet.has('ChangeList')).toBe(true);
    expect(componentSet.has('ValidationPlan')).toBe(true);
    expect(componentSet.has('ArchitectureDiff')).toBe(true);
    expect(componentSet.has('NextSteps')).toBe(true);
  });

  it('returns error when callback is unavailable (planning not active)', async () => {
    const result = await tool.execute(
      'tool-call-1',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['Criterion one'],
        visualPlan: {
          version: '1',
          sections: [{ component: 'SummaryHero', problem: 'Test', insight: 'Test', outcome: 'Test' }],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('save_plan is unavailable right now');
    expect(result.details).toEqual({});
  });

  it('returns error when acceptance criteria is empty', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: [],
        visualPlan: {
          version: '1',
          sections: [{ component: 'SummaryHero', problem: 'Test', insight: 'Test', outcome: 'Test' }],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires at least one non-empty acceptance criterion');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('returns error when all acceptance criteria are whitespace-only', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-3',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['   ', '\t', ''],
        visualPlan: {
          version: '1',
          sections: [{ component: 'SummaryHero', problem: 'Test', insight: 'Test', outcome: 'Test' }],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires at least one non-empty acceptance criterion');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('returns error when visualPlan is missing', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-4',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['Criterion one'],
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires a valid visualPlan payload with at least one section');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('returns error when visualPlan has no sections', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-5',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['Criterion one'],
        visualPlan: {
          version: '1',
          sections: [],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires a valid visualPlan payload with at least one section');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('returns error when visualPlan is missing SummaryHero', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-5b',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['Criterion one'],
        visualPlan: {
          version: '1',
          sections: [
            { component: 'ChangeList', items: [{ area: 'Server', change: 'Do work' }] },
          ],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires a SummaryHero section');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('returns error when SummaryHero fields are duplicated', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-123', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-5c',
      {
        taskId: 'TASK-123',
        acceptanceCriteria: ['Criterion one'],
        visualPlan: {
          version: '1',
          sections: [
            { component: 'SummaryHero', problem: 'Same text', insight: 'Same text', outcome: 'Same text' },
          ],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('SummaryHero fields must be distinct');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('successfully calls callback with normalized visualPlan payload', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-456', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-6',
      {
        taskId: 'TASK-456',
        acceptanceCriteria: ['Criterion one', 'Criterion two'],
        visualPlan: {
          version: '1',
          sections: [
            { component: 'SummaryHero', problem: 'The problem', insight: 'The insight', outcome: 'The outcome' },
            { component: 'ChangeList', items: [{ area: 'Server', change: 'Add feature' }] },
            { component: 'ValidationPlan', checks: ['Run tests'] },
            { component: 'NextSteps', items: ['Deploy'] },
          ],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBeFalsy();
    expect(extractResultText(result)).toContain('Planning package saved for task TASK-456');

    expect(savePlanCallback).toHaveBeenCalledTimes(1);
    const callArg = savePlanCallback.mock.calls[0][0];

    expect(callArg.acceptanceCriteria).toEqual(['Criterion one', 'Criterion two']);
    expect(callArg.plan.visualPlan).toBeDefined();
    expect(callArg.plan.visualPlan.sections).toHaveLength(4);
    expect(callArg.plan.visualPlan.version).toBe('1');
    expect(callArg.plan.generatedAt).toBeDefined();

    // Verify legacy fields are built from visualPlan
    expect(callArg.plan.goal).toBe('The outcome');
    expect(callArg.plan.steps).toEqual(['Add feature']);
    expect(callArg.plan.validation).toEqual(['Run tests']);
    expect(callArg.plan.cleanup).toEqual(['Deploy']);
  });

  it('returns error when visualPlan is absent even if legacy fields are provided', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-789', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-7',
      {
        taskId: 'TASK-789',
        acceptanceCriteria: ['Legacy criterion'],
        goal: 'Legacy goal',
        steps: ['Step one', 'Step two'],
        validation: ['Validate one'],
        cleanup: ['Cleanup one'],
      } as any,
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('requires a valid visualPlan payload with at least one section');
    expect(savePlanCallback).not.toHaveBeenCalled();
  });

  it('derives legacy plan fields from visualPlan even when extra legacy-shaped fields are present', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-ABC', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-8',
      {
        taskId: 'TASK-ABC',
        acceptanceCriteria: ['Mixed criterion'],
        goal: 'Ignored legacy goal',
        steps: ['Ignored legacy step'],
        visualPlan: {
          version: '1',
          sections: [
            { component: 'SummaryHero', problem: 'Recommendation', insight: 'Rationale', outcome: 'Outcome from visual' },
            { component: 'ChangeList', items: [{ area: 'Server', change: 'Ship visual-plan-only save path' }] },
          ],
        },
      } as any,
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBeFalsy();

    const callArg = savePlanCallback.mock.calls[0][0];

    expect(callArg.plan.goal).toBe('Outcome from visual');
    expect(callArg.plan.steps).toEqual(['Ship visual-plan-only save path']);
  });

  it('normalizes acceptance criteria by trimming whitespace', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-DEF', savePlanCallback],
    ]);

    await tool.execute(
      'tool-call-9',
      {
        taskId: 'TASK-DEF',
        acceptanceCriteria: ['  First criterion  ', '  ', '\tSecond criterion\t'],
        visualPlan: {
          version: '1',
          sections: [{ component: 'SummaryHero', problem: 'Recommendation', insight: 'Rationale', outcome: 'Expected outcome' }],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArg = savePlanCallback.mock.calls[0][0];
    expect(callArg.acceptanceCriteria).toEqual(['First criterion', 'Second criterion']);
  });

  it('handles callback errors gracefully', async () => {
    const savePlanCallback = vi.fn().mockRejectedValue(new Error('Persistence failed'));

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-ERR', savePlanCallback],
    ]);

    const result = await tool.execute(
      'tool-call-10',
      {
        taskId: 'TASK-ERR',
        acceptanceCriteria: ['Criterion'],
        visualPlan: {
          version: '1',
          sections: [{ component: 'SummaryHero', problem: 'Recommendation', insight: 'Rationale', outcome: 'Expected outcome' }],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.isError).toBe(true);
    expect(extractResultText(result)).toContain('save_plan failed for task TASK-ERR');
    expect(extractResultText(result)).toContain('Persistence failed');
  });

  it('converts invalid ArchitectureDiff sections to Unknown fallback', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-DIFF', savePlanCallback],
    ]);

    await tool.execute(
      'tool-call-11',
      {
        taskId: 'TASK-DIFF',
        acceptanceCriteria: ['Criterion'],
        visualPlan: {
          version: '1',
          sections: [
            {
              component: 'SummaryHero',
              problem: 'Recommendation',
              insight: 'Rationale',
              outcome: 'Outcome',
            },
            {
              component: 'ArchitectureDiff',
              current: { label: 'Current', code: '' },
              planned: { label: 'Planned', code: 'graph TD\nA-->B' },
            },
          ],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArg = savePlanCallback.mock.calls[0][0];
    const section = callArg.plan.visualPlan.sections.find((entry: any) => entry.originalComponent === 'ArchitectureDiff');

    expect(section).toBeDefined();
    expect(section.component).toBe('Unknown');
    expect(section.originalComponent).toBe('ArchitectureDiff');
    expect(section.reason).toBe('invalid-architecture-diff');
  });

  it('normalizes ArchitectureDiff sections with valid mermaid diagrams', async () => {
    const savePlanCallback = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).__piFactoryPlanCallbacks = new Map([
      ['TASK-VALID', savePlanCallback],
    ]);

    await tool.execute(
      'tool-call-12',
      {
        taskId: 'TASK-VALID',
        acceptanceCriteria: ['Criterion'],
        visualPlan: {
          version: '1',
          sections: [
            {
              component: 'SummaryHero',
              problem: 'Recommendation',
              insight: 'Rationale',
              outcome: 'Outcome',
            },
            {
              component: 'ArchitectureDiff',
              current: { label: 'Before', code: 'graph TD\nA-->B' },
              planned: { label: 'After', code: 'graph TD\nA-->C' },
            },
          ],
        },
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArg = savePlanCallback.mock.calls[0][0];
    const section = callArg.plan.visualPlan.sections.find((entry: any) => entry.component === 'ArchitectureDiff');

    expect(section).toBeDefined();
    expect(section.component).toBe('ArchitectureDiff');
    expect(section.current.code).toBe('graph TD\nA-->B');
    expect(section.planned.code).toBe('graph TD\nA-->C');
  });
});
