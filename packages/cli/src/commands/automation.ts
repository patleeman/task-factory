// =============================================================================
// Automation Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printAutomationSettings } from '../utils/format.js';

const client = new ApiClient();

// ============================================================================
// Automation Get
// ============================================================================
export async function automationGet(workspaceId: string) {
  try {
    const settings = await client.getAutomationSettings(workspaceId);
    printAutomationSettings(settings);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Automation Set
// ============================================================================
export async function automationSet(
  workspaceId: string,
  options: {
    'ready-limit'?: string;
    'executing-limit'?: string;
    'backlog-to-ready'?: string;
    'ready-to-executing'?: string;
  }
) {
  try {
    const settings: Record<string, unknown> = {};
    
    if (options['ready-limit'] !== undefined) {
      settings.readyLimit = parseInt(options['ready-limit'], 10);
    }
    if (options['executing-limit'] !== undefined) {
      settings.executingLimit = parseInt(options['executing-limit'], 10);
    }
    if (options['backlog-to-ready'] !== undefined) {
      settings.backlogToReady = options['backlog-to-ready'] === 'true';
    }
    if (options['ready-to-executing'] !== undefined) {
      settings.readyToExecuting = options['ready-to-executing'] === 'true';
    }
    
    if (Object.keys(settings).length === 0) {
      console.error(chalk.red('Error: No settings specified'));
      process.exit(1);
    }
    
    const spinner = clack.spinner();
    spinner.start('Updating automation settings...');
    
    await client.setAutomationSettings(workspaceId, settings);
    
    spinner.stop('Settings updated');
    console.log(chalk.green('✓ Automation settings updated'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Automation Enable
// ============================================================================
export async function automationEnable(workspaceId: string) {
  try {
    const spinner = clack.spinner();
    spinner.start('Enabling automation...');
    
    await client.setAutomationSettings(workspaceId, {
      backlogToReady: true,
      readyToExecuting: true,
    });
    
    spinner.stop('Automation enabled');
    console.log(chalk.green('✓ All automation enabled'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Automation Disable
// ============================================================================
export async function automationDisable(workspaceId: string) {
  try {
    const spinner = clack.spinner();
    spinner.start('Disabling automation...');
    
    await client.setAutomationSettings(workspaceId, {
      backlogToReady: false,
      readyToExecuting: false,
    });
    
    spinner.stop('Automation disabled');
    console.log(chalk.yellow('✓ All automation disabled'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
