/**
 * Manage New Task Extension
 *
 * Registers a `manage_new_task` tool that lets the planning agent read and
 * modify the "New Task" form in the UI. The agent can set the task description,
 * select a model, configure post-execution skills and their order.
 *
 * Communication: the server registers callbacks on
 * `globalThis.__piFactoryTaskFormCallbacks` when the create-task pane is open.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryTaskFormCallbacks: Map<string, {
    getFormState: () => any;
    updateFormState: (updates: any) => string;
    getAvailableModels: () => Promise<any[]>;
    getAvailableSkills: () => any[];
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'manage_new_task',
    label: 'Manage New Task Form',
    description:
      'Read or update the New Task form that the user is currently editing. ' +
      'Use action "get" to see the current form state and available options. ' +
      'Use action "update" to set the task description, model, or post-execution skills.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('get'),
        Type.Literal('update'),
      ], { description: 'Action: "get" reads current form state, "update" modifies it' }),
      updates: Type.Optional(Type.Object({
        content: Type.Optional(Type.String({
          description: 'Markdown task description',
        })),
        planningModel: Type.Optional(Type.Object({
          provider: Type.String({ description: 'Model provider (e.g. "anthropic", "openai")' }),
          modelId: Type.String({ description: 'Model ID (e.g. "claude-sonnet-4-20250514")' }),
          thinkingLevel: Type.Optional(Type.Union([
            Type.Literal('off'),
            Type.Literal('minimal'),
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
            Type.Literal('xhigh'),
          ], { description: 'Thinking level for reasoning models' })),
        }, { description: 'Planning model configuration' })),
        executionModel: Type.Optional(Type.Object({
          provider: Type.String({ description: 'Model provider (e.g. "anthropic", "openai")' }),
          modelId: Type.String({ description: 'Model ID (e.g. "claude-sonnet-4-20250514")' }),
          thinkingLevel: Type.Optional(Type.Union([
            Type.Literal('off'),
            Type.Literal('minimal'),
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
            Type.Literal('xhigh'),
          ], { description: 'Thinking level for reasoning models' })),
        }, { description: 'Execution model configuration' })),
        model: Type.Optional(Type.Object({
          provider: Type.String({ description: 'Legacy alias for execution model provider' }),
          modelId: Type.String({ description: 'Legacy alias for execution model ID' }),
          thinkingLevel: Type.Optional(Type.Union([
            Type.Literal('off'),
            Type.Literal('minimal'),
            Type.Literal('low'),
            Type.Literal('medium'),
            Type.Literal('high'),
            Type.Literal('xhigh'),
          ], { description: 'Thinking level for reasoning models' })),
        }, { description: 'Legacy alias for execution model configuration' })),
        selectedSkillIds: Type.Optional(Type.Array(Type.String(), {
          description: 'Post-execution skill IDs to enable, in execution order',
        })),
        selectedPreSkillIds: Type.Optional(Type.Array(Type.String(), {
          description: 'Pre-execution skill IDs to enable, in execution order',
        })),
      }, { description: 'Fields to update (for update action)' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, updates } = params;

      const callbacks = globalThis.__piFactoryTaskFormCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'The New Task form is not currently open. Ask the user to open it first (click "+ New Task" in the UI).',
          }],
          details: {} as Record<string, unknown>,
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      if (action === 'get') {
        const formState = cb.getFormState();
        const availableSkills = cb.getAvailableSkills();
        let availableModels: any[];
        try {
          availableModels = await cb.getAvailableModels();
        } catch {
          availableModels = [];
        }

        const lines: string[] = [];
        lines.push('## Current New Task Form State\n');

        if (!formState) {
          lines.push('The form is not currently open.');
        } else {
          lines.push(`**Description:**\n${formState.content || '(empty)'}\n`);

          const planningModel = formState.planningModelConfig;
          const executionModel = formState.executionModelConfig || formState.modelConfig;

          if (planningModel) {
            lines.push(`**Planning Model:** ${planningModel.provider}/${planningModel.modelId}${planningModel.thinkingLevel ? ` (thinking: ${planningModel.thinkingLevel})` : ''}`);
          } else {
            lines.push('**Planning Model:** Default (from Pi settings)');
          }

          if (executionModel) {
            lines.push(`**Execution Model:** ${executionModel.provider}/${executionModel.modelId}${executionModel.thinkingLevel ? ` (thinking: ${executionModel.thinkingLevel})` : ''}`);
          } else {
            lines.push('**Execution Model:** Default (from Pi settings)');
          }

          lines.push(`\n**Selected Post-Execution Skills:** ${formState.selectedSkillIds?.length ? formState.selectedSkillIds.join(', ') : '(none)'}`);
          lines.push(`**Selected Pre-Execution Skills:** ${formState.selectedPreSkillIds?.length ? formState.selectedPreSkillIds.join(', ') : '(none)'}`);
        }

        if (availableModels.length > 0) {
          lines.push('\n## Available Models\n');
          for (const m of availableModels) {
            lines.push(`- \`${m.provider}/${m.id}\` — ${m.name || m.id}${m.reasoning ? ' (reasoning)' : ''}`);
          }
        }

        if (availableSkills.length > 0) {
          lines.push('\n## Available Post-Execution Skills\n');
          for (const s of availableSkills) {
            lines.push(`- \`${s.id}\` — ${s.name}: ${s.description}`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          details: {} as Record<string, unknown>,
        };
      }

      if (action === 'update') {
        if (!updates || Object.keys(updates).length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Error: updates object is required for update action.' }],
            details: {} as Record<string, unknown>,
          };
        }

        // Map to the form state shape
        const formUpdates: any = {};
        if (updates.content !== undefined) {
          formUpdates.content = updates.content;
        }
        if (updates.planningModel) {
          formUpdates.planningModelConfig = {
            provider: updates.planningModel.provider,
            modelId: updates.planningModel.modelId,
            thinkingLevel: updates.planningModel.thinkingLevel,
          };
        }
        if (updates.executionModel) {
          formUpdates.executionModelConfig = {
            provider: updates.executionModel.provider,
            modelId: updates.executionModel.modelId,
            thinkingLevel: updates.executionModel.thinkingLevel,
          };
          // Keep legacy alias aligned for older consumers.
          formUpdates.modelConfig = formUpdates.executionModelConfig;
        } else if (updates.model) {
          // Legacy alias updates execution model.
          formUpdates.executionModelConfig = {
            provider: updates.model.provider,
            modelId: updates.model.modelId,
            thinkingLevel: updates.model.thinkingLevel,
          };
          formUpdates.modelConfig = formUpdates.executionModelConfig;
        }
        if (updates.selectedSkillIds !== undefined) {
          formUpdates.selectedSkillIds = updates.selectedSkillIds;
        }
        if (updates.selectedPreSkillIds !== undefined) {
          formUpdates.selectedPreSkillIds = updates.selectedPreSkillIds;
        }

        const result = cb.updateFormState(formUpdates);
        return {
          content: [{ type: 'text' as const, text: result }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
        details: {} as Record<string, unknown>,
      };
    },
  });
}
