// =============================================================================
// Acceptance Criteria Generation Service
// =============================================================================
// Uses Pi SDK to auto-generate acceptance criteria from task description

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { getTaskFactoryAuthPath } from './taskfactory-home.js';
import { loadPiSettings } from './pi-integration.js';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Resolve a model for acceptance criteria generation using the following precedence:
 * 1. Configured default provider/model from Pi settings
 * 2. First available model from the registry
 * Returns null if no model is available.
 */
async function resolveCriteriaModel(
  modelRegistry: ModelRegistry
): Promise<any | null> {
  // Try configured default provider/model first
  const piSettings = loadPiSettings();
  if (piSettings?.defaultProvider && piSettings?.defaultModel) {
    const configuredModel = modelRegistry.find(piSettings.defaultProvider, piSettings.defaultModel);
    if (configuredModel) {
      return configuredModel;
    }
  }

  // Fall back to first available model
  const available = await modelRegistry.getAvailable();
  if (available.length > 0) {
    return available[0];
  }

  return null;
}

export async function generateAcceptanceCriteria(
  description: string,
  plan?: { goal: string; steps: string[]; validation: string[]; cleanup: string[] },
): Promise<string[]> {
  let planContext = '';
  if (plan) {
    planContext = `\n\nPlan:\n- Goal: ${plan.goal}`;
    if (plan.steps.length > 0) {
      planContext += `\n- Steps:\n${plan.steps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
    }
    if (plan.validation.length > 0) {
      planContext += `\n- Validation:\n${plan.validation.map(v => `  - ${v}`).join('\n')}`;
    }
  }

  const prompt = `Generate acceptance criteria for this task. Each criterion should be specific, testable, and concise. Output ONLY a numbered list (1. 2. 3. etc.), nothing else. Generate 3-7 criteria.${plan ? ' Use the plan details to create more precise criteria.' : ''}

Task Description:
${description}${planContext}`;

  try {
    const authStorage = AuthStorage.create(getTaskFactoryAuthPath());
    const modelRegistry = new ModelRegistry(authStorage);

    // Use configured default model or fall back to available models
    const model = await resolveCriteriaModel(modelRegistry);

    if (!model) {
      return fallbackCriteria(description);
    }

    const loader = new DefaultResourceLoader({
      systemPromptOverride: () =>
        'You generate clear, testable acceptance criteria for software tasks. Reply with ONLY a numbered list. No introduction, no explanation, no markdown formatting beyond the list.',
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
    const unsubscribe = session.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        result += event.assistantMessageEvent.delta;
      }
    });

    try {
      await withTimeout(session.prompt(prompt), 15000, undefined);
    } finally {
      unsubscribe();
      session.dispose();
    }

    const criteria = parseCriteriaFromResponse(result);
    return criteria.length > 0 ? criteria : fallbackCriteria(description);
  } catch (err) {
    console.error('Acceptance criteria generation failed, using fallback:', err);
    return fallbackCriteria(description);
  }
}

function parseCriteriaFromResponse(response: string): string[] {
  if (!response.trim()) return [];

  return response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Strip leading numbering like "1. ", "2) ", "- ", "* "
    .map((line) => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function fallbackCriteria(description: string): string[] {
  // Extract a simple criterion from the first meaningful line of the description
  const lines = description
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  if (firstLine.length <= 100) {
    return [`${firstLine} is implemented and working correctly`];
  }
  return [`${firstLine.slice(0, 97)}... is implemented and working correctly`];
}
