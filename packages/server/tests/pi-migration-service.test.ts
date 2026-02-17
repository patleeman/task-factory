import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = createTempDir('pi-factory-home-');
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

async function importMigrationService() {
  vi.resetModules();
  return import('../src/pi-migration-service.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('pi-migration-service', () => {
  it('returns pending when legacy ~/.pi data exists and no decision has been persisted', async () => {
    const homePath = setTempHome();
    const legacyAgentDir = join(homePath, '.pi', 'agent');
    mkdirSync(legacyAgentDir, { recursive: true });
    writeFileSync(join(legacyAgentDir, 'auth.json'), '{"openai":{"type":"api_key","key":"test"}}\n', 'utf-8');

    const { getPiMigrationStatus } = await importMigrationService();
    const status = getPiMigrationStatus();

    expect(status.state).toBe('pending');
    expect(status.hasLegacyPiDir).toBe(true);
    expect(status.available).toEqual({ auth: true, skills: false, extensions: false });
    expect(status.selectedCategories).toEqual([]);
    expect(existsSync(join(homePath, '.taskfactory', 'pi-migration-state.json'))).toBe(false);
  });

  it('persists not_needed and skips prompting when ~/.pi does not exist', async () => {
    const homePath = setTempHome();

    const { getPiMigrationStatus } = await importMigrationService();
    const first = getPiMigrationStatus();

    expect(first.state).toBe('not_needed');
    expect(first.hasLegacyPiDir).toBe(false);
    expect(first.selectedCategories).toEqual([]);

    const statePath = join(homePath, '.taskfactory', 'pi-migration-state.json');
    expect(existsSync(statePath)).toBe(true);

    const persisted = JSON.parse(readFileSync(statePath, 'utf-8')) as {
      state: string;
      selectedCategories: string[];
      decidedAt: string;
    };

    expect(persisted.state).toBe('not_needed');
    expect(persisted.selectedCategories).toEqual([]);
    expect(typeof persisted.decidedAt).toBe('string');

    const second = getPiMigrationStatus();
    expect(second.state).toBe('not_needed');
    expect(second.selectedCategories).toEqual([]);
  });

  it('copies only selected categories and persists migrated decision', async () => {
    const homePath = setTempHome();
    const legacyAgentDir = join(homePath, '.pi', 'agent');

    mkdirSync(join(legacyAgentDir, 'skills', 'legacy-skill'), { recursive: true });
    mkdirSync(join(legacyAgentDir, 'extensions'), { recursive: true });
    writeFileSync(join(legacyAgentDir, 'auth.json'), '{"anthropic":{"type":"api_key","key":"secret"}}\n', 'utf-8');
    writeFileSync(join(legacyAgentDir, 'skills', 'legacy-skill', 'SKILL.md'), '---\nname: legacy-skill\ndescription: Legacy skill\n---\n', 'utf-8');
    writeFileSync(join(legacyAgentDir, 'extensions', 'legacy-extension.ts'), 'export default function () {}\n', 'utf-8');

    const { migrateFromLegacyPi, getPiMigrationStatus } = await importMigrationService();

    const status = migrateFromLegacyPi({
      auth: true,
      skills: false,
      extensions: true,
    });

    expect(status.state).toBe('migrated');
    expect(status.selectedCategories).toEqual(['auth', 'extensions']);

    expect(existsSync(join(homePath, '.taskfactory', 'agent', 'auth.json'))).toBe(true);
    expect(existsSync(join(homePath, '.taskfactory', 'extensions', 'legacy-extension.ts'))).toBe(true);
    expect(existsSync(join(homePath, '.taskfactory', 'agent', 'skills', 'legacy-skill', 'SKILL.md'))).toBe(false);

    const persisted = JSON.parse(readFileSync(join(homePath, '.taskfactory', 'pi-migration-state.json'), 'utf-8')) as {
      state: string;
      selectedCategories: string[];
    };
    expect(persisted.state).toBe('migrated');
    expect(persisted.selectedCategories).toEqual(['auth', 'extensions']);

    const followUpStatus = getPiMigrationStatus();
    expect(followUpStatus.state).toBe('migrated');
    expect(followUpStatus.selectedCategories).toEqual(['auth', 'extensions']);
  });

  it('persists skip decision so pending prompt does not reappear', async () => {
    const homePath = setTempHome();
    const legacyAgentDir = join(homePath, '.pi', 'agent');
    mkdirSync(legacyAgentDir, { recursive: true });
    writeFileSync(join(legacyAgentDir, 'auth.json'), '{"openai":{"type":"api_key","key":"test"}}\n', 'utf-8');

    const { getPiMigrationStatus, skipPiMigration } = await importMigrationService();

    expect(getPiMigrationStatus().state).toBe('pending');

    const skipped = skipPiMigration();
    expect(skipped.state).toBe('skipped');
    expect(skipped.selectedCategories).toEqual([]);

    const persisted = JSON.parse(readFileSync(join(homePath, '.taskfactory', 'pi-migration-state.json'), 'utf-8')) as {
      state: string;
      selectedCategories: string[];
    };
    expect(persisted.state).toBe('skipped');
    expect(persisted.selectedCategories).toEqual([]);

    const followUp = getPiMigrationStatus();
    expect(followUp.state).toBe('skipped');
    expect(followUp.selectedCategories).toEqual([]);
  });
});
