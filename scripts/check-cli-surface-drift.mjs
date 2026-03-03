#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCapabilityContract } from '../bin/task-factory.js';

const repoRoot = process.cwd();
const docsPath = resolve(repoRoot, 'docs/cli-reference.md');
const skillPath = resolve(repoRoot, 'skills/task-factory/SKILL.md');

const docs = readFileSync(docsPath, 'utf-8');
const skill = readFileSync(skillPath, 'utf-8');
const contract = buildCapabilityContract();

const trackedCommands = Object.keys(contract.requiredForAgents);
const available = new Set(contract.commands.available);

const failures = [];

for (const command of trackedCommands) {
  const needle = `task-factory ${command}`;
  const cliHas = available.has(command);
  const docsHas = docs.includes(needle);
  const skillHas = skill.includes(needle);

  if (cliHas && !docsHas) {
    failures.push(`docs missing supported command: ${needle}`);
  }
  if (cliHas && !skillHas) {
    failures.push(`skill missing supported command: ${needle}`);
  }
  if (!cliHas && docsHas) {
    failures.push(`docs mention unsupported command: ${needle}`);
  }
  if (!cliHas && skillHas) {
    failures.push(`skill mentions unsupported command: ${needle}`);
  }
}

if (failures.length > 0) {
  console.error('CLI/doc/skill drift detected:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('CLI/doc/skill drift check passed.');
