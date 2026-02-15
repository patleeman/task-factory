import { cpSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const TASK_FACTORY_HOME_DIR = join(homedir(), '.taskfactory');
const LEGACY_TASK_FACTORY_HOME_DIR = join(homedir(), '.pi', 'factory');

let migrationChecked = false;
let migrationPendingRetry = false;

function migrateLegacyHomeDirIfNeeded(): void {
  if (migrationChecked) {
    return;
  }

  if (existsSync(TASK_FACTORY_HOME_DIR) && !migrationPendingRetry) {
    migrationChecked = true;
    return;
  }

  if (!existsSync(LEGACY_TASK_FACTORY_HOME_DIR)) {
    migrationChecked = true;
    migrationPendingRetry = false;
    return;
  }

  try {
    cpSync(LEGACY_TASK_FACTORY_HOME_DIR, TASK_FACTORY_HOME_DIR, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    migrationChecked = true;
    migrationPendingRetry = false;
  } catch (err) {
    migrationPendingRetry = true;
    console.warn(
      `[TaskFactoryHome] Failed to migrate legacy config dir from ${LEGACY_TASK_FACTORY_HOME_DIR} to ${TASK_FACTORY_HOME_DIR}: ${String(err)}`,
    );
  }
}

export function getTaskFactoryHomeDir(): string {
  migrateLegacyHomeDirIfNeeded();

  if (!existsSync(TASK_FACTORY_HOME_DIR)) {
    mkdirSync(TASK_FACTORY_HOME_DIR, { recursive: true });
  }

  return TASK_FACTORY_HOME_DIR;
}

export function resolveTaskFactoryHomePath(...segments: string[]): string {
  return join(getTaskFactoryHomeDir(), ...segments);
}

export function getLegacyTaskFactoryHomeDir(): string {
  return LEGACY_TASK_FACTORY_HOME_DIR;
}
