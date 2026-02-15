import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const sharedTypesPath = resolve(currentDir, '../../shared/src/types.ts');
const executionServicePath = resolve(currentDir, '../src/agent-execution-service.ts');
const planningServicePath = resolve(currentDir, '../src/planning-agent-service.ts');
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');
const executionHookPath = resolve(currentDir, '../../client/src/hooks/useAgentStreaming.ts');
const planningHookPath = resolve(currentDir, '../../client/src/hooks/usePlanningStreaming.ts');

const sharedTypesSource = readFileSync(sharedTypesPath, 'utf-8');
const executionServiceSource = readFileSync(executionServicePath, 'utf-8');
const planningServiceSource = readFileSync(planningServicePath, 'utf-8');
const taskChatSource = readFileSync(taskChatPath, 'utf-8');
const executionHookSource = readFileSync(executionHookPath, 'utf-8');
const planningHookSource = readFileSync(planningHookPath, 'utf-8');

describe('context usage + compaction regression checks', () => {
  it('defines websocket contracts for context usage updates and planning system notices', () => {
    expect(sharedTypesSource).toContain("export interface ContextUsageSnapshot");
    expect(sharedTypesSource).toContain("type: 'agent:context_usage'");
    expect(sharedTypesSource).toContain("type: 'planning:context_usage'");
    expect(sharedTypesSource).toContain("role: 'user' | 'assistant' | 'tool' | 'qa' | 'system'");
  });

  it('broadcasts execution compaction notices and context usage snapshots', () => {
    expect(executionServiceSource).toContain("type: 'agent:context_usage'");
    expect(executionServiceSource).toContain("case 'auto_compaction_start':");
    expect(executionServiceSource).toContain("auto compaction start event");
    expect(executionServiceSource).toContain("case 'auto_compaction_end':");
    expect(executionServiceSource).toContain("outcome: notice.outcome");
  });

  it('broadcasts foreman compaction notices and planning context usage snapshots', () => {
    expect(planningServiceSource).toContain("type: 'planning:context_usage'");
    expect(planningServiceSource).toContain("role: 'system'");
    expect(planningServiceSource).toContain("case 'auto_compaction_start':");
    expect(planningServiceSource).toContain("case 'auto_compaction_end':");
    expect(planningServiceSource).toContain("buildPlanningCompactionEndNotice");
  });

  it('renders context usage in chat status and consumes context usage stream events', () => {
    expect(taskChatSource).toContain('formatContextUsageLabel');
    expect(taskChatSource).toContain('ctx ?');
    expect(taskChatSource).toContain('contextUsageLabel');

    expect(executionHookSource).toContain("case 'agent:context_usage':");
    expect(executionHookSource).toContain('contextUsage: msg.usage');

    expect(planningHookSource).toContain("case 'planning:context_usage':");
    expect(planningHookSource).toContain("if (msg.role === 'system')");
  });
});
