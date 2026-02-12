// =============================================================================
// Plan Generation Service
// =============================================================================
// Uses Pi SDK to auto-generate a structured task plan from description + criteria.
// Lightweight, like title-service.ts — no codebase research, just LLM inference.

import { getModel } from '@mariozechner/pi-ai';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import type { TaskPlan } from '@pi-factory/shared';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function generatePlan(
  description: string,
  acceptanceCriteria: string[],
): Promise<TaskPlan> {
  const criteriaText = acceptanceCriteria.length > 0
    ? `\nAcceptance Criteria:\n${acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : '';

  const prompt = `Generate a structured plan for this software task. Output ONLY valid JSON with this exact shape (no markdown fences, no explanation):
{"goal":"...","steps":["..."],"validation":["..."],"cleanup":["..."]}

Rules:
- goal: A single concise sentence describing the objective
- steps: 3-6 high-level implementation summaries (avoid file-by-file detail)
- validation: 2-5 high-level checks to verify the work is correct
- cleanup: 0-3 post-completion cleanup items (empty array if none)

Task Description:
${description}${criteriaText}`;

  try {
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);

    const model =
      getModel('anthropic', 'claude-haiku-4-5') ||
      getModel('anthropic', 'claude-sonnet-4-20250514') ||
      (await modelRegistry.getAvailable())[0];

    if (!model) {
      return fallbackPlan(description, acceptanceCriteria);
    }

    const loader = new DefaultResourceLoader({
      systemPromptOverride: () =>
        'You generate structured task plans as JSON. Reply with ONLY valid JSON. No markdown, no explanation, no code fences.',
    });
    await loader.reload();

    const { session } = await createAgentSession({
      model,
      thinkingLevel: 'off',
      tools: [],
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    });

    let result = '';
    session.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        result += event.assistantMessageEvent.delta;
      }
    });

    await withTimeout(session.prompt(prompt), 15000, undefined);
    session.dispose();

    const plan = parsePlanFromResponse(result, description, acceptanceCriteria);
    return plan;
  } catch (err) {
    console.error('Plan generation failed, using fallback:', err);
    return fallbackPlan(description, acceptanceCriteria);
  }
}

function parsePlanFromResponse(
  response: string,
  description: string,
  acceptanceCriteria: string[],
): TaskPlan {
  if (!response.trim()) {
    return fallbackPlan(description, acceptanceCriteria);
  }

  try {
    // Strip markdown code fences if present
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.goal === 'string' &&
      Array.isArray(parsed.steps) &&
      Array.isArray(parsed.validation)
    ) {
      return {
        goal: parsed.goal,
        steps: parsed.steps.map(String),
        validation: parsed.validation.map(String),
        cleanup: Array.isArray(parsed.cleanup) ? parsed.cleanup.map(String) : [],
        generatedAt: new Date().toISOString(),
      };
    }
  } catch {
    // JSON parse failed — fall through
  }

  return fallbackPlan(description, acceptanceCriteria);
}

function fallbackPlan(
  description: string,
  acceptanceCriteria: string[],
): TaskPlan {
  const firstLine = description.split('\n')[0].trim();
  const goal = firstLine.length <= 200 ? firstLine : firstLine.slice(0, 197) + '...';

  return {
    goal,
    steps: acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((c, i) => `Step ${i + 1}: Implement "${c}"`)
      : [
          'Understand the current codebase structure',
          'Implement the required changes',
          'Write tests for the new functionality',
          'Verify all tests pass',
        ],
    validation: acceptanceCriteria.length > 0
      ? acceptanceCriteria.map(c => `Verify: ${c}`)
      : [
          'All new tests pass',
          'No existing tests broken',
          'Code lints cleanly',
        ],
    cleanup: [],
    generatedAt: new Date().toISOString(),
  };
}
