// =============================================================================
// Planning Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';

const client = new ApiClient();

// ============================================================================
// Planning Status
// ============================================================================
export async function planningStatus(workspaceId: string) {
  try {
    const status = await client.getPlanningStatus(workspaceId);

    console.log(chalk.bold('\n📋 Planning Status\n'));
    console.log(`  Status: ${formatPlanningStatus(status.status)}`);
    console.log(`  Messages: ${status.messages?.length || 0}`);

    if (status.messages?.length) {
      console.log(chalk.bold('\n  Recent Messages:\n'));
      for (const msg of status.messages.slice(-5)) {
        const role = msg.role === 'user' ? chalk.blue('🧑 You') : chalk.green('🤖 Agent');
        console.log(`  ${role}: ${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}`);
      }
    }
    console.log();
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

function formatPlanningStatus(status: string): string {
  const colors: Record<string, (s: string) => string> = {
    idle: chalk.gray,
    running: chalk.yellow,
    completed: chalk.green,
    error: chalk.red,
  };
  const colorFn = colors[status] || chalk.white;
  return colorFn(status.toUpperCase());
}

// ============================================================================
// Planning Messages
// ============================================================================
export async function planningMessages(workspaceId: string, options: { limit?: number }) {
  try {
    const messages = await client.getPlanningMessages(workspaceId);
    const limit = options.limit || messages.length;

    if (messages.length === 0) {
      console.log(chalk.yellow('No planning messages.'));
      return;
    }

    console.log(chalk.bold(`\n💬 Planning Messages (${Math.min(limit, messages.length)}):\n`));

    for (const msg of messages.slice(-limit)) {
      const role = msg.role === 'user' ? chalk.blue('🧑 You') : chalk.green('🤖 Agent');
      const time = new Date(msg.timestamp).toLocaleTimeString();
      console.log(`${role} ${chalk.gray(time)}`);
      console.log(msg.content);
      console.log();
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Planning Message Send
// ============================================================================
export async function planningMessageSend(workspaceId: string, message: string) {
  try {
    await client.sendPlanningMessage(workspaceId, message);
    console.log(chalk.green('✓ Message sent to planning session'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Planning Stop
// ============================================================================
export async function planningStop(workspaceId: string) {
  try {
    const spinner = clack.spinner();
    spinner.start('Stopping planning session...');

    await client.stopPlanning(workspaceId);

    spinner.stop('Planning session stopped');
    console.log(chalk.green('✓ Planning session stopped'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Planning Reset
// ============================================================================
export async function planningReset(workspaceId: string, options: { force?: boolean }) {
  try {
    if (!options.force) {
      const confirmed = await clack.confirm({
        message: 'Are you sure you want to reset the planning session? This will clear all messages.',
        initialValue: false,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Cancelled.'));
        return;
      }
    }

    const spinner = clack.spinner();
    spinner.start('Resetting planning session...');

    await client.resetPlanning(workspaceId);

    spinner.stop('Planning session reset');
    console.log(chalk.green('✓ Planning session reset'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// QA Pending
// ============================================================================
export async function qaPending(workspaceId: string) {
  try {
    const qa = await client.getPendingQA(workspaceId);

    if (!qa.pending) {
      console.log(chalk.gray('No pending Q&A requests.'));
      return;
    }

    console.log(chalk.bold('\n❓ Pending Questions:\n'));

    if (qa.questions) {
      for (let i = 0; i < qa.questions.length; i++) {
        const q = qa.questions[i];
        console.log(`${chalk.cyan(`${i + 1}.`)} ${q.question}`);
        if (q.type === 'choice' && q.options) {
          for (let j = 0; j < q.options.length; j++) {
            console.log(`   ${chalk.gray(`${j + 1})`)} ${q.options[j]}`);
          }
        }
        console.log();
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// QA Respond
// ============================================================================
export async function qaRespond(workspaceId: string, options: { answers: string }) {
  try {
    const answers = options.answers.split(',').map(s => s.trim());

    await client.respondToQA(workspaceId, answers);

    console.log(chalk.green(`✓ Submitted ${answers.length} answer(s)`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// QA Abort
// ============================================================================
export async function qaAbort(workspaceId: string) {
  try {
    await client.abortQA(workspaceId);
    console.log(chalk.green('✓ Q&A session aborted'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
