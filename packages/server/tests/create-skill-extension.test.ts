import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createSkillExtension from '../../../extensions/create-skill.ts';

describe('create_skill extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    createSkillExtension({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    delete (globalThis as any).__piFactoryCreateSkillCallbacks;
  });

  it('forwards repo-local destination to callbacks', async () => {
    const createSkill = vi.fn().mockResolvedValue({
      success: true,
      skillId: 'repo-skill',
      path: '/tmp/workspace/.taskfactory/skills/repo-skill/SKILL.md',
    });

    (globalThis as any).__piFactoryCreateSkillCallbacks = new Map([
      ['workspace-1', { createSkill, listSkills: vi.fn() }],
    ]);

    const result = await tool.execute(
      'tool-call-1',
      {
        name: 'repo-skill',
        description: 'Repo-local test skill',
        hooks: ['post'],
        content: 'Use repo-local destination',
        destination: 'repo-local',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createSkill).toHaveBeenCalledWith({
      name: 'repo-skill',
      description: 'Repo-local test skill',
      hooks: ['post'],
      content: 'Use repo-local destination',
      destination: 'repo-local',
    });

    expect(result.details.destination).toBe('repo-local');
  });

  it('reports global as default destination when not provided', async () => {
    const createSkill = vi.fn().mockResolvedValue({
      success: true,
      skillId: 'global-skill',
      path: '/tmp/home/.taskfactory/skills/global-skill/SKILL.md',
    });

    (globalThis as any).__piFactoryCreateSkillCallbacks = new Map([
      ['workspace-1', { createSkill, listSkills: vi.fn() }],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        name: 'global-skill',
        description: 'Global test skill',
        hooks: ['pre'],
        content: 'Use global destination',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createSkill).toHaveBeenCalledWith({
      name: 'global-skill',
      description: 'Global test skill',
      hooks: ['pre'],
      content: 'Use global destination',
      destination: undefined,
    });

    expect(result.details.destination).toBe('global');
  });

  it('forwards subagent type to callbacks and reports it in details', async () => {
    const createSkill = vi.fn().mockResolvedValue({
      success: true,
      skillId: 'my-subagent',
      path: '/tmp/home/.taskfactory/skills/my-subagent/SKILL.md',
    });

    (globalThis as any).__piFactoryCreateSkillCallbacks = new Map([
      ['workspace-1', { createSkill, listSkills: vi.fn() }],
    ]);

    const result = await tool.execute(
      'tool-call-3',
      {
        name: 'my-subagent',
        description: 'Delegates to a subagent',
        type: 'subagent',
        hooks: ['post'],
        content: 'Use message_agent to delegate.',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-subagent',
        type: 'subagent',
      }),
    );
    expect(result.details.type).toBe('subagent');
    expect(result.content[0].text).toContain('my-subagent');
  });
});
