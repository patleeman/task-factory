import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(currentDir, '../../../skills');

describe('starter skill hooks metadata', () => {
  it('declares universal hooks for every packaged starter skill', () => {
    const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();

    for (const skillId of skillDirs) {
      const content = readFileSync(join(skillsDir, skillId, 'SKILL.md'), 'utf-8');
      expect(content).toContain('hooks: pre-planning,pre,post');
    }
  });
});
