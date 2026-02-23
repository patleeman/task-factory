// =============================================================================
// Output Formatting Utilities
// =============================================================================

import chalk from 'chalk';
import Table from 'cli-table3';
import type { ActivityEntry, Attachment, Idea, ShelfDraft } from '../types/index.js';

export function formatDate(isoString: string | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleString();
}

export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '-';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function printWorkspaces(workspaces: Array<{ id: string; name?: string; path: string; createdAt: string }>): void {
  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('ID'), chalk.bold('Name'), chalk.bold('Path'), chalk.bold('Created')],
    colWidths: [12, 25, 45, 20],
  });

  for (const ws of workspaces) {
    table.push([
      ws.id.slice(0, 10),
      ws.name || '-',
      ws.path.length > 40 ? '...' + ws.path.slice(-37) : ws.path,
      formatDate(ws.createdAt),
    ]);
  }

  console.log(table.toString());
}

export function printTasks(
  tasks: Array<{ id: string; frontmatter: { phase: string; title: string; updated: string; workspace?: string } }>,
  options: { showWorkspace?: boolean } = {}
): void {
  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found.'));
    return;
  }

  const { showWorkspace = false } = options;

  const head = [chalk.bold('ID'), chalk.bold('Phase'), chalk.bold('Title')];
  if (showWorkspace) head.push(chalk.bold('Workspace'));
  head.push(chalk.bold('Updated'));

  const table = new Table({ head });

  for (const task of tasks) {
    const phaseColor: Record<string, (s: string) => string> = {
      backlog: chalk.gray,
      ready: chalk.blue,
      executing: chalk.yellow,
      complete: chalk.green,
      archived: chalk.gray,
    };

    const colorFn = phaseColor[task.frontmatter.phase] || chalk.white;

    const row = [
      task.id.slice(0, 8),
      colorFn(task.frontmatter.phase),
      task.frontmatter.title.slice(0, 40) + (task.frontmatter.title.length > 40 ? '...' : ''),
    ];

    if (showWorkspace) row.push(task.frontmatter.workspace?.slice(-20) || '-');
    row.push(formatRelativeTime(task.frontmatter.updated));

    table.push(row);
  }

  console.log(table.toString());
}

export function printTaskDetail(task: { id: string; frontmatter: Record<string, unknown>; content?: string }): void {
  const fm = task.frontmatter;

  console.log(chalk.bold('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('║ ') + chalk.cyan.bold(String(fm.title || 'Untitled').padEnd(54)) + chalk.bold(' ║'));
  console.log(chalk.bold('╚══════════════════════════════════════════════════════════╝'));

  console.log(`\n${chalk.bold('ID:')} ${fm.id}`);
  console.log(`${chalk.bold('Phase:')} ${chalk.yellow(String(fm.phase))}`);
  console.log(`${chalk.bold('Workspace:')} ${fm.workspace}`);
  console.log(`${chalk.bold('Created:')} ${formatDate(String(fm.created))}`);
  console.log(`${chalk.bold('Updated:')} ${formatDate(String(fm.updated))}`);

  if (fm.assigned) console.log(`${chalk.bold('Assigned:')} ${fm.assigned}`);
  if (fm.blocked && typeof fm.blocked === 'object' && (fm.blocked as { isBlocked?: boolean }).isBlocked) {
    console.log(`${chalk.red.bold('⚠ BLOCKED:')} ${(fm.blocked as { reason?: string }).reason}`);
  }

  const acceptanceCriteria = fm.acceptanceCriteria as string[] | undefined;
  if (acceptanceCriteria?.length) {
    console.log(`\n${chalk.bold('Acceptance Criteria:')}`);
    for (const criteria of acceptanceCriteria) {
      console.log(`  ${chalk.green('✓')} ${criteria}`);
    }
  }

  const plan = fm.plan as { goal?: string; steps?: string[] } | undefined;
  if (plan) {
    console.log(`\n${chalk.bold('Plan:')}`);
    console.log(`${chalk.dim('Goal:')} ${plan.goal}`);
    if (plan.steps?.length) {
      console.log(chalk.dim('Steps:'));
      for (const step of plan.steps) {
        console.log(`  ${chalk.blue('→')} ${step}`);
      }
    }
  }

  if (task.content) {
    const preview = task.content.slice(0, 500).replace(/\n+/g, ' ');
    console.log(`\n${chalk.bold('Description:')}`);
    console.log(preview.length < task.content.length ? preview + '...' : preview);
  }

  console.log();
}

export function printConversationEntry(entry: ActivityEntry, compact = false): void {
  const time = formatRelativeTime(entry.timestamp);

  if (entry.type === 'chat-message') {
    const isUser = entry.role === 'user';
    const icon = isUser ? '🧑' : '🤖';
    const name = isUser ? 'User' : 'Agent';
    const color = isUser ? chalk.blue : chalk.green;

    if (compact) {
      const content = entry.content || '';
      console.log(`[${time}] ${name.toLowerCase()}: ${content.slice(0, 80)}${content.length > 80 ? '...' : ''}`);
    } else {
      console.log(`${color.bold(`${icon} ${name} (${time})`)}`);
      console.log(chalk.gray('━'.repeat(50)));
      console.log(entry.content || '');
      console.log();
    }
  } else if (entry.type === 'system-event') {
    if (!compact) {
      console.log(chalk.gray(`⚙️  System: ${entry.content}`));
      console.log();
    }
  } else if (entry.type === 'task-separator') {
    if (!compact) {
      console.log(chalk.cyan.bold(`\n─── ${entry.content} ───\n`));
    }
  }
}

export function formatConversationAsMarkdown(
  taskTitle: string,
  entries: ActivityEntry[]
): string {
  let md = `# Conversation: ${taskTitle}\n\n`;
  md += `**Exported:** ${new Date().toISOString()}\n\n`;
  md += `---\n\n`;

  for (const entry of entries) {
    if (entry.type === 'chat-message') {
      const role = entry.role === 'user' ? 'User' : 'Agent';
      md += `## ${role} (${entry.timestamp})\n\n`;
      md += `${entry.content || ''}\n\n`;
    } else if (entry.type === 'system-event') {
      md += `*${entry.content}*\n\n`;
    }
  }

  return md;
}

export function printActivityEntries(entries: ActivityEntry[]): void {
  if (entries.length === 0) {
    console.log(chalk.yellow('No activity entries found.'));
    return;
  }

  for (const entry of entries) {
    const time = formatRelativeTime(entry.timestamp);
    
    switch (entry.type) {
      case 'chat-message':
        if (entry.role === 'user') {
          console.log(`${chalk.blue('🧑 User')} ${chalk.gray(time)}`);
        } else {
          console.log(`${chalk.green('🤖 Agent')} ${chalk.gray(time)}`);
        }
        console.log(`  ${entry.content || ''}`);
        break;
      case 'system-event':
        console.log(`${chalk.gray('⚙️ System')} ${chalk.gray(time)}`);
        console.log(`  ${entry.content || ''}`);
        break;
      case 'phase-change':
        console.log(`${chalk.yellow('🔄 Phase Change')} ${chalk.gray(time)}`);
        console.log(`  ${entry.fromPhase} → ${entry.toPhase}`);
        break;
      default:
        console.log(`${chalk.gray('•')} ${chalk.gray(time)} ${entry.content || ''}`);
    }
    console.log();
  }
}

export function printAttachments(attachments: Attachment[]): void {
  if (attachments.length === 0) {
    console.log(chalk.yellow('No attachments found.'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('ID'), chalk.bold('Name'), chalk.bold('Size'), chalk.bold('Type'), chalk.bold('Created')],
  });

  for (const att of attachments) {
    table.push([
      att.id.slice(0, 8),
      att.name,
      formatBytes(att.size),
      att.mimeType,
      formatRelativeTime(att.createdAt),
    ]);
  }

  console.log(table.toString());
}

export function printShelfDrafts(drafts: ShelfDraft[]): void {
  if (drafts.length === 0) {
    console.log(chalk.yellow('No drafts in shelf.'));
    return;
  }

  console.log(chalk.bold(`\n📦 Shelf Drafts (${drafts.length}):\n`));

  for (const draft of drafts) {
    console.log(`${chalk.cyan(draft.id.slice(0, 8))} ${chalk.gray(formatRelativeTime(draft.createdAt))}`);
    const preview = draft.content.slice(0, 100).replace(/\n+/g, ' ');
    console.log(`  ${preview}${draft.content.length > 100 ? '...' : ''}`);
    console.log();
  }
}

export function printIdeas(ideas: Idea[]): void {
  if (ideas.length === 0) {
    console.log(chalk.yellow('No ideas in backlog.'));
    return;
  }

  console.log(chalk.bold(`\n💡 Idea Backlog (${ideas.length}):\n`));

  const table = new Table({
    head: [chalk.bold('Order'), chalk.bold('ID'), chalk.bold('Description')],
    colWidths: [8, 12, 60],
  });

  for (const idea of ideas) {
    table.push([idea.order, idea.id.slice(0, 8), idea.description.slice(0, 57) + (idea.description.length > 57 ? '...' : '')]);
  }

  console.log(table.toString());
}

export function printAutomationSettings(settings: {
  readyLimit: number;
  executingLimit: number;
  backlogToReady: boolean;
  readyToExecuting: boolean;
}): void {
  console.log(chalk.bold('\n⚙️  Automation Settings\n'));
  console.log(`  Ready Queue Limit:     ${chalk.cyan(settings.readyLimit)}`);
  console.log(`  Executing Limit:       ${chalk.cyan(settings.executingLimit)}`);
  console.log(`  Backlog → Ready:       ${settings.backlogToReady ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
  console.log(`  Ready → Executing:     ${settings.readyToExecuting ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
  console.log();
}

export function printAuthProviders(providers: Array<{ id: string; name: string; hasCredential: boolean; type: string }>): void {
  if (providers.length === 0) {
    console.log(chalk.yellow('No auth providers configured.'));
    return;
  }

  console.log(chalk.bold('\n🔐 Auth Providers\n'));

  for (const provider of providers) {
    const status = provider.hasCredential ? chalk.green('✓ Configured') : chalk.red('✗ Not configured');
    const type = chalk.gray(`(${provider.type})`);
    console.log(`  ${chalk.cyan(provider.name)} ${type} ${status}`);
  }
  console.log();
}

export function printSkills(skills: Array<{ id: string; name: string; description: string; hooks?: string[] }>): void {
  if (skills.length === 0) {
    console.log(chalk.yellow('No skills found.'));
    return;
  }

  console.log(chalk.bold(`\n🛠️  Skills (${skills.length}):\n`));

  for (const skill of skills) {
    console.log(`${chalk.cyan(skill.id)} ${skill.hooks ? chalk.gray(`[${skill.hooks.join(', ')}]`) : ''}`);
    console.log(`  ${skill.name}`);
    if (skill.description) {
      console.log(`  ${chalk.gray(skill.description.slice(0, 100))}`);
    }
    console.log();
  }
}
