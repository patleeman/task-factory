// =============================================================================
// Task Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printTasks, printTaskDetail, printConversationEntry, formatConversationAsMarkdown, printActivityEntries } from '../utils/format.js';
import { writeFileSync } from 'fs';

const client = new ApiClient();

// Find workspace for a task by searching all workspaces
async function findTaskWorkspace(taskId: string): Promise<{ workspaceId: string; task: { id: string; frontmatter: Record<string, unknown> } } | null> {
  const workspaces = await client.listWorkspaces();
  
  for (const ws of workspaces) {
    try {
      const tasks = await client.listTasks(ws.id, 'all');
      // Require exact match or minimum 8 characters for partial match to avoid collisions
      const task = tasks.find(t =>
        t.id === taskId ||
        (taskId.length >= 8 && t.id.startsWith(taskId))
      );
      if (task) {
        return { workspaceId: ws.id, task };
      }
    } catch (err: any) {
      console.warn(chalk.yellow(`Warning: Could not list tasks for workspace ${ws.id}: ${err.message}`));
    }
  }
  
  return null;
}

// ============================================================================
// Task List
// ============================================================================
export async function taskList(options: { workspace?: string; scope?: string; all?: boolean }) {
  try {
    if (options.all) {
      // List tasks from all workspaces
      const workspaces = await client.listWorkspaces();
      const allTasks: Array<{ id: string; frontmatter: { phase: string; title: string; updated: string; workspace: string } }> = [];
      
      for (const ws of workspaces) {
        try {
          const tasks = await client.listTasks(ws.id, (options.scope as 'active' | 'archived' | 'all') || 'active');
          for (const task of tasks) {
            allTasks.push({
              id: task.id,
              frontmatter: {
                phase: String(task.frontmatter.phase),
                title: String(task.frontmatter.title || 'Untitled'),
                updated: String(task.frontmatter.updated),
                workspace: ws.name || ws.id,
              },
            });
          }
        } catch {
          // Skip workspaces that fail
        }
      }
      
      printTasks(allTasks, { showWorkspace: true });
    } else if (options.workspace) {
      const tasks = await client.listTasks(options.workspace, (options.scope as 'active' | 'archived' | 'all') || 'active');
      printTasks(tasks.map(t => ({
        id: t.id,
        frontmatter: {
          phase: String(t.frontmatter.phase),
          title: String(t.frontmatter.title || 'Untitled'),
          updated: String(t.frontmatter.updated),
        },
      })));
    } else {
      console.error(chalk.red('Error: --workspace or --all required'));
      process.exit(1);
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Show
// ============================================================================
export async function taskShow(taskId: string) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const fullTask = await client.getTask(found.workspaceId, found.task.id);
    printTaskDetail(fullTask);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Update
// ============================================================================
export async function taskUpdate(
  taskId: string,
  options: {
    title?: string;
    content?: string;
    acceptanceCriteria?: string;
    preExecutionSkills?: string;
    postExecutionSkills?: string;
    file?: string;
  }
) {
  try {
    const found = await findTaskWorkspace(taskId);

    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }

    const update: Record<string, unknown> = {};

    // Validate title length
    if (options.title) {
      if (options.title.length > 200) {
        console.error(chalk.red('Error: Title must be 200 characters or less'));
        process.exit(1);
      }
      update.title = options.title;
    }

    // Validate content length
    if (options.content) {
      if (options.content.length > 50000) {
        console.error(chalk.red('Error: Content must be 50000 characters or less'));
        process.exit(1);
      }
      update.content = options.content;
    }

    if (options.acceptanceCriteria) {
      const criteria = options.acceptanceCriteria.split(',').map(s => s.trim()).filter(Boolean);
      if (criteria.length > 50) {
        console.error(chalk.red('Error: Maximum 50 acceptance criteria allowed'));
        process.exit(1);
      }
      update.acceptanceCriteria = criteria;
    }
    if (options.preExecutionSkills) {
      update.preExecutionSkills = options.preExecutionSkills.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (options.postExecutionSkills) {
      update.postExecutionSkills = options.postExecutionSkills.split(',').map(s => s.trim()).filter(Boolean);
    }

    if (options.file) {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      const resolvedPath = resolve(options.file);

      if (!existsSync(resolvedPath)) {
        console.error(chalk.red(`Error: File not found: ${options.file}`));
        process.exit(1);
      }

      const content = readFileSync(resolvedPath, 'utf-8');
      if (content.length > 50000) {
        console.error(chalk.red('Error: File content must be 50000 characters or less'));
        process.exit(1);
      }
      update.content = content;
    }
    
    if (Object.keys(update).length === 0) {
      console.error(chalk.red('Error: No updates specified. Use --title, --content, --acceptance-criteria, etc.'));
      process.exit(1);
    }
    
    const spinner = clack.spinner();
    spinner.start('Updating task...');
    
    await client.updateTask(found.workspaceId, found.task.id, update);
    
    spinner.stop('Task updated successfully');
    console.log(chalk.green(`✓ Task ${found.task.id} updated`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Plan Regenerate
// ============================================================================
export async function taskPlanRegenerate(taskId: string) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const spinner = clack.spinner();
    spinner.start('Regenerating plan...');
    
    await client.regeneratePlan(found.workspaceId, found.task.id);
    
    spinner.stop('Plan regeneration started');
    console.log(chalk.green(`✓ Plan regeneration initiated for task ${found.task.id}`));
    console.log(chalk.gray('  The plan will be generated in the background. Use "task show" to check progress.'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Criteria Regenerate
// ============================================================================
export async function taskCriteriaRegenerate(taskId: string) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const spinner = clack.spinner();
    spinner.start('Regenerating acceptance criteria...');
    
    const result = await client.regenerateAcceptanceCriteria(found.workspaceId, found.task.id);
    
    spinner.stop('Acceptance criteria regenerated');
    console.log(chalk.green(`✓ Generated ${result.acceptanceCriteria.length} criteria`));
    
    for (const criteria of result.acceptanceCriteria) {
      console.log(`  ${chalk.green('•')} ${criteria}`);
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Criteria Check
// ============================================================================
export async function taskCriteriaCheck(
  taskId: string,
  index: string,
  status: 'pass' | 'fail' | 'pending'
) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) {
      console.error(chalk.red('Error: Index must be a non-negative number'));
      process.exit(1);
    }
    
    await client.updateAcceptanceCriteria(found.workspaceId, found.task.id, idx, status);
    
    console.log(chalk.green(`✓ Criterion ${idx} marked as ${status}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Conversation
// ============================================================================
export async function taskConversation(
  taskId: string,
  options: {
    limit?: number;
    since?: string;
    follow?: boolean;
    export?: string;
    json?: boolean;
    compact?: boolean;
    only?: 'user' | 'agent' | 'all';
    search?: string;
  }
) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const fullTask = await client.getTask(found.workspaceId, found.task.id);
    const entries = await client.getTaskConversation(found.workspaceId, found.task.id, options.limit || 100);
    
    // Filter entries
    let filtered = entries;
    
    if (options.only && options.only !== 'all') {
      filtered = entries.filter(e => e.type === 'chat-message' && e.role === options.only);
    }
    
    if (options.search) {
      const searchLower = options.search.toLowerCase();
      filtered = filtered.filter(e => 
        e.content?.toLowerCase().includes(searchLower)
      );
    }
    
    if (options.since) {
      // Parse relative time (e.g., "2h", "1d")
      const match = options.since.match(/^(\d+)([hd])$/);
      if (match) {
        const num = parseInt(match[1], 10);
        const unit = match[2];
        const ms = unit === 'h' ? num * 60 * 60 * 1000 : num * 24 * 60 * 60 * 1000;
        const sinceDate = new Date(Date.now() - ms);
        filtered = filtered.filter(e => new Date(e.timestamp) >= sinceDate);
      }
    }
    
    // Output formats
    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }
    
    if (options.export) {
      const markdown = formatConversationAsMarkdown(
        String(fullTask.frontmatter.title || 'Untitled'),
        filtered
      );
      writeFileSync(options.export, markdown);
      console.log(chalk.green(`✓ Exported conversation to ${options.export}`));
      return;
    }
    
    // Pretty print
    console.log(chalk.bold(`\n📋 Task: ${fullTask.frontmatter.title}\n`));
    
    if (filtered.length === 0) {
      console.log(chalk.gray('No messages in conversation.'));
      return;
    }
    
    for (const entry of filtered) {
      printConversationEntry(entry, options.compact);
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Message Send
// ============================================================================
export async function taskMessageSend(
  taskId: string,
  message: string,
  options: { file?: string; attachment?: string[] }
) {
  try {
    const found = await findTaskWorkspace(taskId);

    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }

    let content = message;

    // Validate message length
    if (content.length > 10000) {
      console.error(chalk.red('Error: Message must be 10000 characters or less'));
      process.exit(1);
    }

    if (options.file) {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      const resolvedPath = resolve(options.file);

      if (!existsSync(resolvedPath)) {
        console.error(chalk.red(`Error: File not found: ${options.file}`));
        process.exit(1);
      }

      content = readFileSync(resolvedPath, 'utf-8');
      if (content.length > 10000) {
        console.error(chalk.red('Error: File content must be 10000 characters or less'));
        process.exit(1);
      }
    }

    // Handle attachments if provided
    let attachmentIds: string[] | undefined;
    if (options.attachment && options.attachment.length > 0) {
      // Validate attachment count
      if (options.attachment.length > 10) {
        console.error(chalk.red('Error: Maximum 10 attachments allowed'));
        process.exit(1);
      }

      // Upload attachments first
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      attachmentIds = [];

      for (const path of options.attachment) {
        const resolvedPath = resolve(path);

        if (!existsSync(resolvedPath)) {
          console.error(chalk.red(`Error: Attachment file not found: ${path}`));
          process.exit(1);
        }

        const fileContent = readFileSync(resolvedPath);
        const fileName = path.split('/').pop() || 'attachment';
        const blob = new Blob([fileContent]);
        const file = new File([blob], fileName);
        const attachment = await client.uploadAttachment(found.workspaceId, found.task.id, file);
        attachmentIds.push(attachment.id);
      }
    }

    await client.sendMessage(found.workspaceId, found.task.id, content, 'user', attachmentIds);

    console.log(chalk.green(`✓ Message sent to task ${found.task.id}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Steer
// ============================================================================
export async function taskSteer(taskId: string, instruction: string) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    await client.steerTask(found.workspaceId, found.task.id, instruction);
    
    console.log(chalk.green(`✓ Steering instruction sent to task ${found.task.id}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Follow-up
// ============================================================================
export async function taskFollowUp(taskId: string, message: string) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    await client.followUpTask(found.workspaceId, found.task.id, message);
    
    console.log(chalk.green(`✓ Follow-up queued for task ${found.task.id}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Task Activity
// ============================================================================
export async function taskActivity(
  taskId: string,
  options: { limit?: number; json?: boolean }
) {
  try {
    const found = await findTaskWorkspace(taskId);
    
    if (!found) {
      console.error(chalk.red(`Task not found: ${taskId}`));
      process.exit(1);
    }
    
    const entries = await client.getTaskActivity(found.workspaceId, found.task.id, options.limit);
    
    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    
    console.log(chalk.bold(`\n📋 Activity for task: ${found.task.frontmatter.title}\n`));
    printActivityEntries(entries);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
