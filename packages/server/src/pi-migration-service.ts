import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  getLegacyPiHomeDir,
  getTaskFactoryAuthPath,
  getTaskFactoryGlobalExtensionsDir,
  getTaskFactoryPiSkillsDir,
  resolveTaskFactoryHomePath,
} from './taskfactory-home.js';

export const PI_MIGRATION_CATEGORIES = ['auth', 'skills', 'extensions'] as const;

export type PiMigrationCategory = (typeof PI_MIGRATION_CATEGORIES)[number];

export type PiMigrationState = 'pending' | 'migrated' | 'skipped' | 'not_needed';

export interface PiMigrationCategoryAvailability {
  auth: boolean;
  skills: boolean;
  extensions: boolean;
}

export interface PiMigrationStatus {
  state: PiMigrationState;
  hasLegacyPiDir: boolean;
  available: PiMigrationCategoryAvailability;
  selectedCategories: PiMigrationCategory[];
  decidedAt?: string;
}

interface PersistedPiMigrationState {
  state: Exclude<PiMigrationState, 'pending'>;
  selectedCategories?: PiMigrationCategory[];
  decidedAt: string;
}

const PI_MIGRATION_STATE_PATH = resolveTaskFactoryHomePath('pi-migration-state.json');

function getLegacyAgentDir(): string {
  return join(getLegacyPiHomeDir(), 'agent');
}

function getLegacyAuthPath(): string {
  return join(getLegacyAgentDir(), 'auth.json');
}

function getLegacySkillsDir(): string {
  return join(getLegacyAgentDir(), 'skills');
}

function getLegacyExtensionsDir(): string {
  return join(getLegacyAgentDir(), 'extensions');
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readPersistedState(): PersistedPiMigrationState | null {
  if (!existsSync(PI_MIGRATION_STATE_PATH)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(PI_MIGRATION_STATE_PATH, 'utf-8')) as Partial<PersistedPiMigrationState>;

    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const normalizedState = raw.state;
    if (normalizedState !== 'migrated' && normalizedState !== 'skipped' && normalizedState !== 'not_needed') {
      return null;
    }

    const selectedCategories = Array.isArray(raw.selectedCategories)
      ? raw.selectedCategories.filter((value): value is PiMigrationCategory => PI_MIGRATION_CATEGORIES.includes(value as PiMigrationCategory))
      : [];

    return {
      state: normalizedState,
      selectedCategories,
      decidedAt: typeof raw.decidedAt === 'string' && raw.decidedAt.trim().length > 0
        ? raw.decidedAt
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function persistState(state: PersistedPiMigrationState): void {
  ensureParentDir(PI_MIGRATION_STATE_PATH);
  writeFileSync(PI_MIGRATION_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function detectAvailability(): PiMigrationCategoryAvailability {
  return {
    auth: existsSync(getLegacyAuthPath()),
    skills: existsSync(getLegacySkillsDir()),
    extensions: existsSync(getLegacyExtensionsDir()),
  };
}

function hasAnyMigratableCategory(availability: PiMigrationCategoryAvailability): boolean {
  return availability.auth || availability.skills || availability.extensions;
}

function copyFileIfPresent(fromPath: string, toPath: string): boolean {
  if (!existsSync(fromPath)) {
    return false;
  }

  ensureParentDir(toPath);
  cpSync(fromPath, toPath, {
    recursive: false,
    force: false,
    errorOnExist: false,
  });
  return true;
}

function copyDirectoryIfPresent(fromPath: string, toPath: string): boolean {
  if (!existsSync(fromPath)) {
    return false;
  }

  mkdirSync(toPath, { recursive: true });
  cpSync(fromPath, toPath, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });

  return true;
}

function toStatus(
  state: PiMigrationState,
  availability: PiMigrationCategoryAvailability,
  hasLegacyPiDir: boolean,
  selectedCategories: PiMigrationCategory[] = [],
  decidedAt?: string,
): PiMigrationStatus {
  return {
    state,
    hasLegacyPiDir,
    available: availability,
    selectedCategories,
    decidedAt,
  };
}

function normalizeSelectedCategories(
  requested: Partial<Record<PiMigrationCategory, boolean>> | undefined,
  availability: PiMigrationCategoryAvailability,
): PiMigrationCategory[] {
  if (!requested) {
    return PI_MIGRATION_CATEGORIES.filter((category) => availability[category]);
  }

  return PI_MIGRATION_CATEGORIES.filter((category) => requested[category] === true && availability[category]);
}

function persistNotNeededIfNoLegacyData(
  availability: PiMigrationCategoryAvailability,
  hasLegacyPiDir: boolean,
): PiMigrationStatus {
  const persisted: PersistedPiMigrationState = {
    state: 'not_needed',
    selectedCategories: [],
    decidedAt: new Date().toISOString(),
  };
  persistState(persisted);
  return toStatus('not_needed', availability, hasLegacyPiDir, [], persisted.decidedAt);
}

export function getPiMigrationStatus(): PiMigrationStatus {
  const persisted = readPersistedState();
  const availability = detectAvailability();
  const hasLegacyPiDir = existsSync(getLegacyPiHomeDir());

  if (persisted) {
    return toStatus(
      persisted.state,
      availability,
      hasLegacyPiDir,
      persisted.selectedCategories ?? [],
      persisted.decidedAt,
    );
  }

  if (!hasLegacyPiDir || !hasAnyMigratableCategory(availability)) {
    return persistNotNeededIfNoLegacyData(availability, hasLegacyPiDir);
  }

  return toStatus('pending', availability, hasLegacyPiDir);
}

export function skipPiMigration(): PiMigrationStatus {
  const availability = detectAvailability();
  const hasLegacyPiDir = existsSync(getLegacyPiHomeDir());
  const decidedAt = new Date().toISOString();

  persistState({
    state: 'skipped',
    selectedCategories: [],
    decidedAt,
  });

  return toStatus('skipped', availability, hasLegacyPiDir, [], decidedAt);
}

export function migrateFromLegacyPi(
  requestedSelections?: Partial<Record<PiMigrationCategory, boolean>>,
): PiMigrationStatus {
  const availability = detectAvailability();
  const hasLegacyPiDir = existsSync(getLegacyPiHomeDir());
  const selectedCategories = normalizeSelectedCategories(requestedSelections, availability);

  if (selectedCategories.includes('auth')) {
    copyFileIfPresent(getLegacyAuthPath(), getTaskFactoryAuthPath());
  }

  if (selectedCategories.includes('skills')) {
    copyDirectoryIfPresent(getLegacySkillsDir(), getTaskFactoryPiSkillsDir());
  }

  if (selectedCategories.includes('extensions')) {
    copyDirectoryIfPresent(getLegacyExtensionsDir(), getTaskFactoryGlobalExtensionsDir());
  }

  const decidedAt = new Date().toISOString();
  persistState({
    state: 'migrated',
    selectedCategories,
    decidedAt,
  });

  return toStatus('migrated', availability, hasLegacyPiDir, selectedCategories, decidedAt);
}
