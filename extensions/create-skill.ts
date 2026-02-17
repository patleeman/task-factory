/**
 * Create Skill Extension
 *
 * Registers a `create_skill` tool that lets the foreman create new execution skills.
 * Skills are written to the skills/ directory with proper YAML frontmatter.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryCreateSkillCallbacks: Map<string, {
    createSkill: (payload: {
      name: string;
      description: string;
      hooks: ('pre-planning' | 'pre' | 'post')[];
      content: string;
    }) => Promise<{ success: boolean; skillId?: string; path?: string; error?: string }>;
    listSkills: () => Promise<Array<{ id: string; name: string; description: string; hooks: string[] }>>;
  }> | undefined;
}

// Valid skill name pattern: lowercase letters, numbers, hyphens (1-64 chars, must start with letter/number)
const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validateSkillName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim().toLowerCase();
  
  if (!trimmed) {
    return { valid: false, error: 'Skill name is required' };
  }
  
  if (!SKILL_ID_PATTERN.test(trimmed)) {
    return { 
      valid: false, 
      error: 'Skill name must be lowercase letters, numbers, or hyphens (1-64 chars, must start with letter/number)' 
    };
  }
  
  return { valid: true };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_skill',
    label: 'Create Skill',
    description:
      'Create a new hook skill that can be used by tasks. ' +
      'Skills are stored as SKILL.md files with YAML frontmatter. ' +
      'The skill will be available immediately after creation.',
    parameters: Type.Object({
      name: Type.String({
        description: 'Skill name (lowercase letters, numbers, hyphens only; 1-64 chars, must start with letter/number)',
      }),
      description: Type.String({
        description: 'Short description of what the skill does',
      }),
      hooks: Type.Array(
        Type.Union([Type.Literal('pre-planning'), Type.Literal('pre'), Type.Literal('post')]),
        { description: 'When the skill runs: pre-planning (before planning), pre (before execution), and/or post (after execution)' }
      ),
      content: Type.String({
        description: 'Markdown content for the skill (the prompt template that will be sent to the agent)',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { name, description, hooks, content } = params;

      const callbacks = globalThis.__piFactoryCreateSkillCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Create skill callbacks not available. The skill management service is not initialized.',
          }],
          details: { error: 'Callbacks not available' },
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      // Validate skill name
      const validation = validateSkillName(name);
      if (!validation.valid) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${validation.error}`,
          }],
          details: { error: validation.error },
        };
      }

      // Validate hooks
      if (!hooks || hooks.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: At least one hook (pre-planning, pre, or post) must be specified.',
          }],
          details: { error: 'No hooks specified' },
        };
      }

      // Validate description
      if (!description || description.trim().length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Description is required.',
          }],
          details: { error: 'Missing description' },
        };
      }

      // Validate content
      if (!content || content.trim().length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Content is required.',
          }],
          details: { error: 'Missing content' },
        };
      }

      try {
        const result = await cb.createSkill({
          name: name.trim().toLowerCase(),
          description: description.trim(),
          hooks,
          content: content.trim(),
        });

        if (result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: `Skill "${result.skillId}" created successfully.\n\nPath: ${result.path}\n\nThe skill is now available and will appear in GET /api/factory/skills.`,
            }],
            details: { 
              skillId: result.skillId, 
              path: result.path,
              hooks,
            },
          };
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: `Error creating skill: ${result.error}`,
            }],
            details: { error: result.error },
          };
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err.message || String(err)}`,
          }],
          details: { error: err.message || String(err) },
        };
      }
    },
  });
}
