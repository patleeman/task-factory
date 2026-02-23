#!/usr/bin/env node
// =============================================================================
// Task Factory CLI - Main Entry Point
// =============================================================================

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Commands
import { taskList, taskShow, taskUpdate, taskPlanRegenerate, taskCriteriaRegenerate, taskCriteriaCheck, taskConversation, taskMessageSend, taskSteer, taskFollowUp, taskActivity } from './commands/task.js';
import { planningStatus, planningMessages, planningMessageSend, planningStop, planningReset, qaPending, qaRespond, qaAbort } from './commands/planning.js';
import { shelfShow, shelfPush, shelfPushAll, shelfUpdate, shelfRemove, shelfClear, ideaList, ideaAdd, ideaUpdate, ideaDelete, ideaReorder } from './commands/shelf.js';
import { attachmentList, attachmentUpload, attachmentDownload, attachmentDelete } from './commands/attachment.js';
import { automationGet, automationSet, automationEnable, automationDisable } from './commands/automation.js';
import { settingsGet, settingsSet, settingsPiGet, settingsPiModels, defaultsGet, defaultsSet, defaultsWorkspaceGet, defaultsWorkspaceSet, authStatus, authSetKey, authClear, skillList, skillGet, factorySkillList, factorySkillReload } from './commands/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.3.0';
  }
}

// =============================================================================
// CLI Setup
// =============================================================================
const program = new Command()
  .name('task-factory')
  .description('Task Factory CLI - Command line interface for task management')
  .version(getVersion())
  .configureOutput({
    writeErr: (str) => process.stderr.write(chalk.red(str)),
    outputError: (str, write) => write(chalk.red(str)),
  });

// =============================================================================
// Task Commands
// =============================================================================
const taskCmd = program
  .command('task')
  .description('Task management commands');

taskCmd
  .command('list')
  .description('List tasks')
  .option('-w, --workspace <id>', 'Workspace ID')
  .option('-s, --scope <scope>', 'Scope: active, archived, all', 'active')
  .option('-a, --all', 'List tasks from all workspaces')
  .action(taskList);

taskCmd
  .command('show <task-id>')
  .description('Show task details')
  .action(taskShow);

taskCmd
  .command('update <task-id>')
  .description('Update task fields')
  .option('-t, --title <title>', 'Update title')
  .option('-c, --content <content>', 'Update content')
  .option('-a, --acceptance-criteria <criteria>', 'Update acceptance criteria (comma-separated)')
  .option('--pre-execution-skills <skills>', 'Set pre-execution skills (comma-separated)')
  .option('--post-execution-skills <skills>', 'Set post-execution skills (comma-separated)')
  .option('-f, --file <path>', 'Read content from file')
  .action(taskUpdate);

taskCmd
  .command('conversation <task-id>')
  .alias('chat')
  .description('View conversation history for a task')
  .option('-l, --limit <n>', 'Number of messages to show', '100')
  .option('--since <duration>', 'Show messages since (e.g., "2h", "1d")')
  .option('-f, --follow', 'Follow new messages in real-time')
  .option('-e, --export <file>', 'Export to markdown file')
  .option('--json', 'Output as JSON')
  .option('--compact', 'Compact output format')
  .option('--only <role>', 'Filter by role (user/agent)')
  .option('--search <keyword>', 'Search in message content')
  .action(taskConversation);

taskCmd
  .command('activity <task-id>')
  .description('View activity log for a task')
  .option('-l, --limit <n>', 'Number of entries', '50')
  .option('--json', 'Output as JSON')
  .action(taskActivity);

taskCmd
  .command('message <task-id> <content>')
  .description('Send a message to a task')
  .option('--file <path>', 'Read message from file')
  .option('--attachment <paths...>', 'Attach files')
  .action(taskMessageSend);

taskCmd
  .command('steer <task-id> <instruction>')
  .description('Send steering instruction to a task')
  .action(taskSteer);

taskCmd
  .command('follow-up <task-id> <message>')
  .description('Queue a follow-up message for a task')
  .action(taskFollowUp);

// Task Plan Commands
const planCmd = taskCmd.command('plan').description('Task plan management');

planCmd
  .command('regenerate <task-id>')
  .description('Regenerate plan for a task')
  .action(taskPlanRegenerate);

// Task Criteria Commands
const criteriaCmd = taskCmd.command('criteria').description('Acceptance criteria management');

criteriaCmd
  .command('regenerate <task-id>')
  .description('Regenerate acceptance criteria')
  .action(taskCriteriaRegenerate);

criteriaCmd
  .command('check <task-id> <index> <status>')
  .description('Update criterion status (pass/fail/pending)')
  .action(taskCriteriaCheck);

// =============================================================================
// Planning Commands
// =============================================================================
const planningCmd = program
  .command('planning')
  .description('Planning session management');

planningCmd
  .command('status <workspace-id>')
  .description('Get planning session status')
  .action(planningStatus);

planningCmd
  .command('messages <workspace-id>')
  .description('Get planning messages')
  .option('-l, --limit <n>', 'Limit number of messages')
  .action(planningMessages);

planningCmd
  .command('message <workspace-id> <content>')
  .description('Send message to planning session')
  .action(planningMessageSend);

planningCmd
  .command('stop <workspace-id>')
  .description('Stop active planning session')
  .action(planningStop);

planningCmd
  .command('reset <workspace-id>')
  .description('Reset planning session')
  .option('--force', 'Skip confirmation')
  .action(planningReset);

// =============================================================================
// Q&A Commands
// =============================================================================
const qaCmd = program
  .command('qa')
  .description('Q&A flow management');

qaCmd
  .command('pending <workspace-id>')
  .description('Get pending Q&A request')
  .action(qaPending);

qaCmd
  .command('respond <workspace-id>')
  .description('Submit Q&A answers')
  .requiredOption('-a, --answers <answers>', 'Comma-separated answers')
  .action(qaRespond);

qaCmd
  .command('abort <workspace-id>')
  .description('Abort Q&A request')
  .action(qaAbort);

// =============================================================================
// Shelf Commands
// =============================================================================
const shelfCmd = program
  .command('shelf')
  .description('Shelf (draft tasks) management');

shelfCmd
  .command('show <workspace-id>')
  .description('Show shelf contents')
  .action(shelfShow);

shelfCmd
  .command('push <workspace-id> <draft-id>')
  .description('Promote draft to task')
  .action(shelfPush);

shelfCmd
  .command('push-all <workspace-id>')
  .description('Promote all drafts to tasks')
  .action(shelfPushAll);

shelfCmd
  .command('update <workspace-id> <draft-id>')
  .description('Update draft content')
  .requiredOption('-c, --content <content>', 'New content')
  .action(shelfUpdate);

shelfCmd
  .command('remove <workspace-id> <item-id>')
  .description('Remove shelf item')
  .option('--force', 'Skip confirmation')
  .action(shelfRemove);

shelfCmd
  .command('clear <workspace-id>')
  .description('Clear all shelf items')
  .option('--force', 'Skip confirmation')
  .action(shelfClear);

// =============================================================================
// Idea Commands
// =============================================================================
const ideaCmd = program
  .command('idea')
  .description('Idea backlog management');

ideaCmd
  .command('list <workspace-id>')
  .description('List ideas')
  .action(ideaList);

ideaCmd
  .command('add <workspace-id> <description>')
  .description('Add new idea')
  .action(ideaAdd);

ideaCmd
  .command('update <workspace-id> <idea-id> <description>')
  .description('Update idea')
  .action(ideaUpdate);

ideaCmd
  .command('delete <workspace-id> <idea-id>')
  .description('Delete idea')
  .option('--force', 'Skip confirmation')
  .action(ideaDelete);

ideaCmd
  .command('reorder <workspace-id>')
  .description('Reorder ideas')
  .requiredOption('-o, --order <ids>', 'Comma-separated idea IDs in new order')
  .action(ideaReorder);

// =============================================================================
// Attachment Commands
// =============================================================================
const attachmentCmd = program
  .command('attachment')
  .description('Attachment management');

attachmentCmd
  .command('list <task-id>')
  .description('List task attachments')
  .action(attachmentList);

attachmentCmd
  .command('upload <task-id> <file-path>')
  .description('Upload attachment to task')
  .option('--files <paths...>', 'Upload multiple files')
  .action(attachmentUpload);

attachmentCmd
  .command('download <task-id> <attachment-id>')
  .description('Download attachment')
  .option('-o, --output <path>', 'Output file path')
  .action(attachmentDownload);

attachmentCmd
  .command('delete <task-id> <attachment-id>')
  .description('Delete attachment')
  .option('--force', 'Skip confirmation')
  .action(attachmentDelete);

// =============================================================================
// Automation Commands
// =============================================================================
const automationCmd = program
  .command('automation')
  .description('Workflow automation management');

automationCmd
  .command('get <workspace-id>')
  .description('Get automation settings')
  .action(automationGet);

automationCmd
  .command('set <workspace-id>')
  .description('Set automation settings')
  .option('--ready-limit <n>', 'Ready queue limit')
  .option('--executing-limit <n>', 'Executing limit')
  .option('--backlog-to-ready <bool>', 'Enable backlog→ready')
  .option('--ready-to-executing <bool>', 'Enable ready→executing')
  .action(automationSet);

automationCmd
  .command('enable <workspace-id>')
  .description('Enable all automation')
  .action(automationEnable);

automationCmd
  .command('disable <workspace-id>')
  .description('Disable all automation')
  .action(automationDisable);

// =============================================================================
// Settings Commands
// =============================================================================
const settingsCmd = program
  .command('settings')
  .description('Settings management');

settingsCmd
  .command('get')
  .description('Get global settings')
  .action(settingsGet);

settingsCmd
  .command('set <key> <value>')
  .description('Set global setting')
  .action(settingsSet);

settingsCmd
  .command('pi-get')
  .description('Get Pi settings')
  .action(settingsPiGet);

settingsCmd
  .command('pi-models')
  .description('Get Pi models')
  .action(settingsPiModels);

// =============================================================================
// Defaults Commands
// =============================================================================
const defaultsCmd = program
  .command('defaults')
  .description('Task defaults management');

defaultsCmd
  .command('get')
  .description('Get global task defaults')
  .action(defaultsGet);

defaultsCmd
  .command('set')
  .description('Set global task defaults')
  .option('--model <model>', 'Default model')
  .option('--pre-execution-skills <skills>', 'Comma-separated skill IDs')
  .option('--post-execution-skills <skills>', 'Comma-separated skill IDs')
  .action(defaultsSet);

defaultsCmd
  .command('workspace-get <workspace-id>')
  .description('Get workspace task defaults')
  .action(defaultsWorkspaceGet);

defaultsCmd
  .command('workspace-set <workspace-id>')
  .description('Set workspace task defaults')
  .option('--model <model>', 'Default model')
  .option('--pre-execution-skills <skills>', 'Comma-separated skill IDs')
  .option('--post-execution-skills <skills>', 'Comma-separated skill IDs')
  .action(defaultsWorkspaceSet);

// =============================================================================
// Auth Commands
// =============================================================================
const authCmd = program
  .command('auth')
  .description('Authentication management');

authCmd
  .command('status')
  .description('Get auth status')
  .action(authStatus);

authCmd
  .command('set-key <provider> <api-key>')
  .description('Set API key for provider')
  .action(authSetKey);

authCmd
  .command('clear <provider>')
  .description('Clear provider credentials')
  .action(authClear);

// =============================================================================
// Skill Commands
// =============================================================================
const skillCmd = program
  .command('skill')
  .description('Skill management');

skillCmd
  .command('list')
  .description('List Pi skills')
  .action(skillList);

skillCmd
  .command('get <skill-id>')
  .description('Get skill details')
  .action(skillGet);

// =============================================================================
// Factory Skill Commands
// =============================================================================
const factorySkillCmd = program
  .command('factory-skill')
  .description('Factory skill management');

factorySkillCmd
  .command('list')
  .description('List factory skills')
  .action(factorySkillList);

factorySkillCmd
  .command('reload')
  .description('Reload factory skills')
  .action(factorySkillReload);

// =============================================================================
// Parse and Execute
// =============================================================================
program.parse();
