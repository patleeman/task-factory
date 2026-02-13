import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../..');
const clientSourceDir = resolve(currentDir, '../../client/src');
const extensionsDir = resolve(currentDir, '../../../extensions');
const allowedExtensions = new Set(['.ts', '.tsx']);
const emojiRegex = /\p{Extended_Pictographic}/u;

function collectSourceFiles(dirPath: string): string[] {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!allowedExtensions.has(extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe('iconography regression checks', () => {
  it('keeps client and extension runtime paths free of emoji glyphs', () => {
    const filesToScan = [
      ...collectSourceFiles(clientSourceDir),
      ...collectSourceFiles(extensionsDir),
    ];

    const violations: string[] = [];

    for (const filePath of filesToScan) {
      const content = readFileSync(filePath, 'utf-8');
      if (emojiRegex.test(content)) {
        violations.push(relative(repoRoot, filePath));
      }
    }

    expect(
      violations,
      violations.length > 0
        ? `Emoji glyphs detected in runtime paths:\n${violations.join('\n')}`
        : undefined,
    ).toEqual([]);
  });
});
