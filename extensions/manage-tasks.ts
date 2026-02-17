/**
 * Manage Tasks Extension
 *
 * Registers a `manage_tasks` tool that lets the planning agent manage
 * workspace tasks: list, get, update, delete, and change task state.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryTaskCallbacks: Map<string, {
    listTasks: () => Promise<any[]>;
    getTask: (taskId: string) => Promise<any | null>;
    updateTask: (taskId: string, updates: any) => Promise<any>;
    deleteTask: (taskId: string) => Promise<boolean>;
    moveTask: (taskId: string, toPhase: string) => Promise<any>;
    getPromotePhase: (phase: string) => string | null;
    getDemotePhase: (phase: string) => string | null;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'manage_tasks',
    label: 'Manage Tasks',
    description:
      'Manage workspace tasks: list all tasks, get a specific task, update task fields, delete a task, ' +
      'or change task phase with explicit move/promote/demote actions. ' +
      'Note: Editing task fields does NOT change phase; use move/promote/demote for state changes.',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('get'),
        Type.Literal('update'),
        Type.Literal('delete'),
        Type.Literal('move'),
        Type.Literal('promote'),
        Type.Literal('demote'),
      ], { description: 'Action to perform on tasks' }),
      taskId: Type.Optional(Type.String({
        description: 'Task ID (required for get, update, delete, move, promote, demote)',
      })),
      updates: Type.Optional(Type.Object({
        title: Type.Optional(Type.String({ description: 'Task title' })),
        content: Type.Optional(Type.String({ description: 'Task description (markdown)' })),
        acceptanceCriteria: Type.Optional(Type.Array(Type.String(), {
          description: 'List of acceptance criteria',
        })),
        priority: Type.Optional(Type.Union([
          Type.Literal('low'),
          Type.Literal('medium'),
          Type.Literal('high'),
          Type.Literal('urgent'),
        ], { description: 'Task priority' })),
        tags: Type.Optional(Type.Array(Type.String(), { description: 'Task tags' })),
        notes: Type.Optional(Type.String({ description: 'Additional notes' })),
      }, { description: 'Fields to update (for update action). Phase cannot be changed via update.' })),
      toPhase: Type.Optional(Type.Union([
        Type.Literal('backlog'),
        Type.Literal('ready'),
        Type.Literal('executing'),
        Type.Literal('complete'),
        Type.Literal('archived'),
      ], { description: 'Target phase (required for move action)' })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, taskId, updates, toPhase } = params;

      const callbacks = globalThis.__piFactoryTaskCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Task management callbacks not available.',
          }],
          details: {} as Record<string, unknown>,
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      // Helper to format task for display
      const formatTask = (t: any): string => {
        const lines = [
          `**${t.id}**: ${t.frontmatter?.title || '(untitled)'}`,
          `  Phase: ${t.frontmatter?.phase || 'unknown'}`,
        ];
        if (t.frontmatter?.priority) {
          lines.push(`  Priority: ${t.frontmatter.priority}`);
        }
        if (t.frontmatter?.tags?.length) {
          lines.push(`  Tags: ${t.frontmatter.tags.join(', ')}`);
        }
        if (t.frontmatter?.blocked?.isBlocked) {
          lines.push(`  [BLOCKED] ${t.frontmatter.blocked.reason || 'No reason given'}`);
        }
        return lines.join('\n');
      };

      try {
        if (action === 'list') {
          const tasks = await cb.listTasks();
          if (tasks.length === 0) {
            return {
              content: [{ type: 'text' as const, text: 'No tasks found in this workspace.' }],
              details: { count: 0 },
            };
          }

          // Group by phase
          const byPhase = new Map<string, any[]>();
          for (const t of tasks) {
            const phase = t.frontmatter?.phase || 'unknown';
            if (!byPhase.has(phase)) byPhase.set(phase, []);
            byPhase.get(phase)!.push(t);
          }

          const lines: string[] = [`## Tasks (${tasks.length} total)\n`];
          for (const [phase, phaseTasks] of byPhase) {
            lines.push(`### ${phase} (${phaseTasks.length})`);
            for (const t of phaseTasks) {
              lines.push(formatTask(t));
            }
            lines.push('');
          }

          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            details: { count: tasks.length, byPhase: Object.fromEntries(byPhase) },
          };
        }

        if (action === 'get') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for get action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const task = await cb.getTask(taskId);
          if (!task) {
            return {
              content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }],
              details: {} as Record<string, unknown>,
            };
          }

          const lines = [
            `## ${task.id}: ${task.frontmatter?.title || '(untitled)'}`,
            '',
            `**Phase:** ${task.frontmatter?.phase || 'unknown'}`,
            `**Priority:** ${task.frontmatter?.priority || 'not set'}`,
          ];

          if (task.frontmatter?.tags?.length) {
            lines.push(`**Tags:** ${task.frontmatter.tags.join(', ')}`);
          }

          if (task.frontmatter?.acceptanceCriteria?.length) {
            lines.push('\n**Acceptance Criteria:**');
            for (const ac of task.frontmatter.acceptanceCriteria) {
              const status = ac.met ? '[x]' : '[ ]';
              lines.push(`  ${status} ${ac.text}`);
            }
          }

          if (task.content) {
            lines.push('\n**Description:**');
            lines.push(task.content.slice(0, 500) + (task.content.length > 500 ? '...' : ''));
          }

          if (task.frontmatter?.plan) {
            lines.push('\n**Plan:**');
            lines.push(`Goal: ${task.frontmatter.plan.goal}`);
            if (task.frontmatter.plan.steps?.length) {
              lines.push('\nSteps:');
              for (let i = 0; i < task.frontmatter.plan.steps.length; i++) {
                lines.push(`  ${i + 1}. ${task.frontmatter.plan.steps[i]}`);
              }
            }
          }

          if (task.frontmatter?.blocked?.isBlocked) {
            lines.push(`\n**BLOCKED:** ${task.frontmatter.blocked.reason || 'No reason given'}`);
          }

          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            details: { task },
          };
        }

        if (action === 'update') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for update action.' }],
              details: {} as Record<string, unknown>,
            };
          }
          if (!updates || Object.keys(updates).length === 0) {
            return {
              content: [{ type: 'text' as const, text: 'Error: updates object is required for update action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const task = await cb.updateTask(taskId, updates);
          return {
            content: [{ type: 'text' as const, text: `Updated ${task.id}: ${task.frontmatter?.title}` }],
            details: { task },
          };
        }

        if (action === 'delete') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for delete action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const success = await cb.deleteTask(taskId);
          if (success) {
            return {
              content: [{ type: 'text' as const, text: `Deleted task ${taskId}.` }],
              details: { deleted: true },
            };
          } else {
            return {
              content: [{ type: 'text' as const, text: `Failed to delete task ${taskId}.` }],
              details: { deleted: false },
            };
          }
        }

        if (action === 'move') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for move action.' }],
              details: {} as Record<string, unknown>,
            };
          }
          if (!toPhase) {
            return {
              content: [{ type: 'text' as const, text: 'Error: toPhase is required for move action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const task = await cb.moveTask(taskId, toPhase);
          return {
            content: [{ type: 'text' as const, text: `Moved ${task.id} to ${toPhase}.` }],
            details: { task },
          };
        }

        if (action === 'promote') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for promote action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const task = await cb.getTask(taskId);
          if (!task) {
            return {
              content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }],
              details: {} as Record<string, unknown>,
            };
          }

          const currentPhase = task.frontmatter?.phase;
          const nextPhase = cb.getPromotePhase(currentPhase);
          if (!nextPhase) {
            return {
              content: [{ type: 'text' as const, text: `Cannot promote ${taskId}: already at final phase (${currentPhase}).` }],
              details: { task },
            };
          }

          const updatedTask = await cb.moveTask(taskId, nextPhase);
          return {
            content: [{ type: 'text' as const, text: `Promoted ${taskId} from ${currentPhase} to ${nextPhase}.` }],
            details: { task: updatedTask },
          };
        }

        if (action === 'demote') {
          if (!taskId) {
            return {
              content: [{ type: 'text' as const, text: 'Error: taskId is required for demote action.' }],
              details: {} as Record<string, unknown>,
            };
          }

          const task = await cb.getTask(taskId);
          if (!task) {
            return {
              content: [{ type: 'text' as const, text: `Task ${taskId} not found.` }],
              details: {} as Record<string, unknown>,
            };
          }

          const currentPhase = task.frontmatter?.phase;
          const prevPhase = cb.getDemotePhase(currentPhase);
          if (!prevPhase) {
            return {
              content: [{ type: 'text' as const, text: `Cannot demote ${taskId}: already at initial phase (${currentPhase}).` }],
              details: { task },
            };
          }

          const updatedTask = await cb.moveTask(taskId, prevPhase);
          return {
            content: [{ type: 'text' as const, text: `Demoted ${taskId} from ${currentPhase} to ${prevPhase}.` }],
            details: { task: updatedTask },
          };
        }

        return {
          content: [{ type: 'text' as const, text: `Unknown action: ${action}` }],
          details: {} as Record<string, unknown>,
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message || String(err)}` }],
          details: { error: err.message || String(err) },
        };
      }
    },
  });
}
