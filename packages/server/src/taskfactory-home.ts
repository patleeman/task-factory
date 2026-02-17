import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const TASK_FACTORY_HOME_DIR = join(homedir(), '.taskfactory');
const LEGACY_PI_HOME_DIR = join(homedir(), '.pi');
const LEGACY_TASK_FACTORY_HOME_DIR = join(LEGACY_PI_HOME_DIR, 'factory');

export function getTaskFactoryHomeDir(): string {
  if (!existsSync(TASK_FACTORY_HOME_DIR)) {
    mkdirSync(TASK_FACTORY_HOME_DIR, { recursive: true });
  }

  return TASK_FACTORY_HOME_DIR;
}

export function resolveTaskFactoryHomePath(...segments: string[]): string {
  return join(getTaskFactoryHomeDir(), ...segments);
}

export function getTaskFactoryAgentDir(): string {
  return resolveTaskFactoryHomePath('agent');
}

export function resolveTaskFactoryAgentPath(...segments: string[]): string {
  return join(getTaskFactoryAgentDir(), ...segments);
}

export function getTaskFactoryAuthPath(): string {
  return resolveTaskFactoryAgentPath('auth.json');
}

export function getTaskFactoryPiSkillsDir(): string {
  return resolveTaskFactoryAgentPath('skills');
}

export function getTaskFactoryGlobalExtensionsDir(): string {
  return resolveTaskFactoryHomePath('extensions');
}

export function getTaskFactoryExecutionSkillsDir(): string {
  return resolveTaskFactoryHomePath('skills');
}

export function resolveWorkspaceTaskFactoryPath(workspacePath: string, ...segments: string[]): string {
  return join(workspacePath, '.taskfactory', ...segments);
}

export function getWorkspaceTaskFactoryExtensionsDir(workspacePath: string): string {
  return resolveWorkspaceTaskFactoryPath(workspacePath, 'extensions');
}

export function getWorkspaceTaskFactorySkillsDir(workspacePath: string): string {
  return resolveWorkspaceTaskFactoryPath(workspacePath, 'skills');
}

export function getLegacyPiHomeDir(): string {
  return LEGACY_PI_HOME_DIR;
}

export function getLegacyTaskFactoryHomeDir(): string {
  return LEGACY_TASK_FACTORY_HOME_DIR;
}
