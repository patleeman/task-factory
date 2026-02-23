// =============================================================================
// Settings Commands
// =============================================================================

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { ApiClient } from '../api/api-client.js';
import { printAuthProviders, printSkills } from '../utils/format.js';
import type { TaskDefaults } from '../types/index.js';

const client = new ApiClient();

// ============================================================================
// Settings Get
// ============================================================================
export async function settingsGet() {
  try {
    const settings = await client.getGlobalSettings();
    console.log(chalk.bold('\n⚙️  Global Settings\n'));
    console.log(JSON.stringify(settings, null, 2));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Settings Set
// ============================================================================
export async function settingsSet(key: string, value: string) {
  try {
    const settings: Record<string, unknown> = {};
    
    // Try to parse as JSON, otherwise use as string
    try {
      settings[key] = JSON.parse(value);
    } catch {
      settings[key] = value;
    }
    
    await client.setGlobalSettings(settings);
    console.log(chalk.green(`✓ Set ${key} = ${value}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Settings Pi Get
// ============================================================================
export async function settingsPiGet() {
  try {
    const settings = await client.getPiSettings();
    console.log(chalk.bold('\n🤖 Pi Settings\n'));
    console.log(JSON.stringify(settings, null, 2));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Settings Pi Models
// ============================================================================
export async function settingsPiModels() {
  try {
    const models = await client.getPiModels();
    console.log(chalk.bold('\n🤖 Pi Models\n'));
    console.log(JSON.stringify(models, null, 2));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Defaults Get
// ============================================================================
export async function defaultsGet() {
  try {
    const defaults = await client.getTaskDefaults();
    console.log(chalk.bold('\n📝 Task Defaults (Global)\n'));
    printDefaults(defaults);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Defaults Set
// ============================================================================
export async function defaultsSet(options: {
  model?: string;
  'pre-execution-skills'?: string;
  'post-execution-skills'?: string;
}) {
  try {
    const defaults: TaskDefaults = {};
    
    if (options.model) defaults.model = options.model;
    if (options['pre-execution-skills']) {
      defaults.preExecutionSkills = options['pre-execution-skills'].split(',').map(s => s.trim());
    }
    if (options['post-execution-skills']) {
      defaults.postExecutionSkills = options['post-execution-skills'].split(',').map(s => s.trim());
    }
    
    if (Object.keys(defaults).length === 0) {
      console.error(chalk.red('Error: No defaults specified'));
      process.exit(1);
    }
    
    await client.setTaskDefaults(defaults);
    console.log(chalk.green('✓ Task defaults updated'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Defaults Workspace Get
// ============================================================================
export async function defaultsWorkspaceGet(workspaceId: string) {
  try {
    const defaults = await client.getWorkspaceTaskDefaults(workspaceId);
    console.log(chalk.bold(`\n📝 Task Defaults (Workspace: ${workspaceId})\n`));
    printDefaults(defaults);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Defaults Workspace Set
// ============================================================================
export async function defaultsWorkspaceSet(
  workspaceId: string,
  options: {
    model?: string;
    'pre-execution-skills'?: string;
    'post-execution-skills'?: string;
  }
) {
  try {
    const defaults: TaskDefaults = {};
    
    if (options.model) defaults.model = options.model;
    if (options['pre-execution-skills']) {
      defaults.preExecutionSkills = options['pre-execution-skills'].split(',').map(s => s.trim());
    }
    if (options['post-execution-skills']) {
      defaults.postExecutionSkills = options['post-execution-skills'].split(',').map(s => s.trim());
    }
    
    if (Object.keys(defaults).length === 0) {
      console.error(chalk.red('Error: No defaults specified'));
      process.exit(1);
    }
    
    await client.setWorkspaceTaskDefaults(workspaceId, defaults);
    console.log(chalk.green('✓ Workspace task defaults updated'));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

function printDefaults(defaults: TaskDefaults) {
  console.log(`  Model: ${defaults.model || chalk.gray('(not set)')}`);
  console.log(`  Pre-execution skills: ${defaults.preExecutionSkills?.join(', ') || chalk.gray('(not set)')}`);
  console.log(`  Post-execution skills: ${defaults.postExecutionSkills?.join(', ') || chalk.gray('(not set)')}`);
  console.log();
}

// ============================================================================
// Auth Status
// ============================================================================
export async function authStatus() {
  try {
    const result = await client.getAuthStatus();
    printAuthProviders(result.providers);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Auth Set Key
// ============================================================================
export async function authSetKey(provider: string, apiKey: string) {
  try {
    const spinner = clack.spinner();
    spinner.start(`Setting API key for ${provider}...`);
    
    await client.setProviderApiKey(provider, apiKey);
    
    spinner.stop('API key set');
    console.log(chalk.green(`✓ API key set for ${provider}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Auth Clear
// ============================================================================
export async function authClear(provider: string) {
  try {
    const confirmed = await clack.confirm({
      message: `Clear credentials for ${provider}?`,
      initialValue: false,
    });
    
    if (!confirmed) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }
    
    await client.clearProviderCredential(provider);
    console.log(chalk.green(`✓ Cleared credentials for ${provider}`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Skill List
// ============================================================================
export async function skillList() {
  try {
    const skills = await client.listSkills();
    printSkills(skills);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Skill Get
// ============================================================================
export async function skillGet(skillId: string) {
  try {
    const skill = await client.getSkill(skillId);
    console.log(chalk.bold(`\n🛠️  Skill: ${skill.name}\n`));
    console.log(`  ID: ${skill.id}`);
    console.log(`  Hooks: ${skill.hooks?.join(', ') || 'none'}`);
    console.log(`  Description: ${skill.description || 'N/A'}`);
    console.log();
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Factory Skill List
// ============================================================================
export async function factorySkillList() {
  try {
    const skills = await client.listFactorySkills();
    printSkills(skills);
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}

// ============================================================================
// Factory Skill Reload
// ============================================================================
export async function factorySkillReload() {
  try {
    const spinner = clack.spinner();
    spinner.start('Reloading factory skills...');
    
    const result = await client.reloadFactorySkills();
    
    spinner.stop('Skills reloaded');
    console.log(chalk.green(`✓ Reloaded ${result.count} skills`));
  } catch (err: any) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  }
}
