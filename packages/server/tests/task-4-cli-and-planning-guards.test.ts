import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

describe('TASK-4 coverage: planning/CLI controls and planning-blocked behavior', () => {
  it('exposes planning CLI commands and JSON-capable task activity/conversation options', () => {
    const cliPath = join(process.cwd(), '..', '..', 'bin', 'task-factory.js');
    const cliSource = readFileSync(cliPath, 'utf-8');

    expect(cliSource).toContain(".command('planning')");
    expect(cliSource).toContain(".command('status')");
    expect(cliSource).toContain(".command('stop')");
    expect(cliSource).toContain(".command('reset')");

    expect(cliSource).toContain(".command('activity <task-id>')");
    expect(cliSource).toContain(".option('-l, --limit <n>', 'Number of entries', parseInt, 50)");
    expect(cliSource).toContain(".command('conversation <task-id>')");
    expect(cliSource).toContain(".option('-l, --limit <n>', 'Number of conversation lines', parseInt, 100)");
    expect(cliSource).toContain(".option('--json', 'Output JSON')");

    // JSON payload fields needed for scriptable introspection.
    expect(cliSource).toContain('entries: (activity || []).map((entry) => ({');
    expect(cliSource).toContain('timestamp: entry.timestamp');
    expect(cliSource).toContain('event: entry.event || \'unknown\'');
    expect(cliSource).toContain('messages: conversationLines.map((message, index) => ({');
    expect(cliSource).toContain("role: 'assistant'");
    expect(cliSource).toContain('content: message');

    expect(cliSource).toContain('EXIT_CODES');
    expect(cliSource).toContain('PLANNING_BLOCKED');
  });

  it('returns structured planning-blocked payload from execute endpoint', () => {
    const serverIndexPath = join(process.cwd(), 'src', 'index.ts');
    const source = readFileSync(serverIndexPath, 'utf-8');

    expect(source).toContain("code: 'PLANNING_BLOCKED'");
    expect(source).toContain('guidance:');
    expect(source).toContain('res.status(409).json');
  });

  it('queue manager emits a planning-blocked system notice for blocked ready tasks', () => {
    const queueManagerPath = join(process.cwd(), 'src', 'queue-manager.ts');
    const source = readFileSync(queueManagerPath, 'utf-8');

    expect(source).toContain('maybeEmitPlanningBlockedNotice');
    expect(source).toContain("action: 'planning_blocked'");
  });
});
