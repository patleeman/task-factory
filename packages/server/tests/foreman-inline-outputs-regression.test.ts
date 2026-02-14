import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const planningServicePath = resolve(currentDir, '../src/planning-agent-service.ts');
const taskChatPath = resolve(currentDir, '../../client/src/components/TaskChat.tsx');

const planningServiceSource = readFileSync(planningServicePath, 'utf-8');
const taskChatSource = readFileSync(taskChatPath, 'utf-8');

describe('foreman inline output regression checks', () => {
  it('stores renderable artifact HTML and draft-task payloads in planning tool metadata', () => {
    expect(planningServiceSource).toContain('artifactHtml: artifactPayload?.html');
    expect(planningServiceSource).toContain('draftTask: draftTaskPayload');
  });

  it('renders inline artifact and draft-task reopen widgets from metadata payloads', () => {
    expect(taskChatSource).toContain("toolName === 'create_artifact'");
    expect(taskChatSource).toContain('artifactHtml');
    expect(taskChatSource).toContain("toolName === 'create_draft_task'");
    expect(taskChatSource).toContain('<InlineDraftTaskWidget');
  });
});
