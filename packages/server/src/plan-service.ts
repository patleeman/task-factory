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
  type AgentSession,
} from '@mariozechner/pi-coding-agent';
import type { TaskPlan } from '@pi-factory/shared';
import { withTimeout } from './with-timeout.js';

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

  let session: AgentSession | null = null;
  let result = '';

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

    const created = await createAgentSession({
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

    const activeSession = created.session;
    session = activeSession;

    activeSession.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        result += event.assistantMessageEvent.delta;
      }
    });

    const timeoutMessage = 'Plan generation timed out';

    try {
      await withTimeout(async (signal) => {
        signal.addEventListener('abort', () => {
          void activeSession.abort().catch(() => undefined);
        }, { once: true });
        await activeSession.prompt(prompt);
      }, 300000, timeoutMessage);
    } catch (err) {
      // On timeout, abort the streaming request and continue with any partial output.
      if (err instanceof Error && err.message === timeoutMessage) {
        try {
          await activeSession.abort();
        } catch {
          // Ignore abort errors — we'll still parse what we captured.
        }
      } else {
        throw err;
      }
    }

    return parsePlanFromResponse(result, description, acceptanceCriteria);
  } catch (err) {
    console.error('Plan generation failed, using fallback:', err);
    return fallbackPlan(description, acceptanceCriteria);
  } finally {
    session?.dispose();
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
  const goalBase = firstLine || 'Complete the requested task';
  const goal = goalBase.length <= 200 ? goalBase : goalBase.slice(0, 197) + '...';

  const normalizedCriteria = acceptanceCriteria
    .map((criterion) => criterion.trim())
    .filter(Boolean);

  const criteriaForSteps = normalizedCriteria.slice(0, 6);
  const criteriaForValidation = normalizedCriteria.slice(0, 5);

  return {
    goal,
    steps: criteriaForSteps.length > 0
      ? criteriaForSteps.map((criterion) => `Deliver: ${criterion}`)
      : [
          'Understand the existing behavior and constraints',
          'Implement the required changes',
          'Add or update tests',
          'Verify the final behavior matches expectations',
        ],
    validation: criteriaForValidation.length > 0
      ? criteriaForValidation.map((criterion) => `Confirm: ${criterion}`)
      : [
          'Relevant tests pass',
          'Behavior matches the task description',
          'No regressions are introduced',
        ],
    cleanup: [],
    generatedAt: new Date().toISOString(),
  };
}
