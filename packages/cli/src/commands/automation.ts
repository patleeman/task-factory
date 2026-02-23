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

    // Validate and set ready limit
    if (options['ready-limit'] !== undefined) {
      const value = parseInt(options['ready-limit'], 10);
      if (isNaN(value) || value < 1 || value > 100) {
        console.error(chalk.red('Error: ready-limit must be a number between 1 and 100'));
        process.exit(1);
      }
      settings.readyLimit = value;
    }

    // Validate and set executing limit
    if (options['executing-limit'] !== undefined) {
      const value = parseInt(options['executing-limit'], 10);
      if (isNaN(value) || value < 1 || value > 20) {
        console.error(chalk.red('Error: executing-limit must be a number between 1 and 20'));
        process.exit(1);
      }
      settings.executingLimit = value;
    }

    // Validate boolean options
    if (options['backlog-to-ready'] !== undefined) {
      const value = options['backlog-to-ready'].toLowerCase();
      if (value !== 'true' && value !== 'false') {
        console.error(chalk.red('Error: backlog-to-ready must be "true" or "false"'));
        process.exit(1);
      }
      settings.backlogToReady = value === 'true';
    }

    if (options['ready-to-executing'] !== undefined) {
      const value = options['ready-to-executing'].toLowerCase();
      if (value !== 'true' && value !== 'false') {
        console.error(chalk.red('Error: ready-to-executing must be "true" or "false"'));
        process.exit(1);
      }
      settings.readyToExecuting = value === 'true';
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
