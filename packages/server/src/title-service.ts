// =============================================================================
// Title Generation Service
// =============================================================================
// Uses Pi SDK to auto-generate concise task titles from description + criteria

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
 * Resolve a model for title generation using the following precedence:
 * 1. Configured default provider/model from Pi settings
 * 2. First available model from the registry
 * Returns null if no model is available.
 */
async function resolveTitleModel(
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

export async function generateTitle(
  description: string,
  acceptanceCriteria: string[]
): Promise<string> {
  const criteriaText = acceptanceCriteria.length > 0
    ? `\nAcceptance Criteria:\n${acceptanceCriteria.map(c => `- ${c}`).join('\n')}`
    : '';

  const prompt = `Generate a short task title (max 8 words) for this task. Reply with ONLY the title, nothing else.

Task Description:
${description}${criteriaText}`;

  try {
    const authStorage = AuthStorage.create(getTaskFactoryAuthPath());
    const modelRegistry = new ModelRegistry(authStorage);

    // Use configured default model or fall back to available models
    const model = await resolveTitleModel(modelRegistry);

    if (!model) {
      return fallbackTitle(description);
    }

    const loader = new DefaultResourceLoader({
      systemPromptOverride: () =>
        'You generate short, clear task titles. Reply with ONLY the title text. No quotes, no prefix, no explanation.',
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
      await withTimeout(session.prompt(prompt), 10000, undefined);
    } finally {
      unsubscribe();
      session.dispose();
    }

    const title = result.trim().replace(/^["']|["']$/g, '');
    return title || fallbackTitle(description);
  } catch (err) {
    console.error('Title generation failed, using fallback:', err);
    return fallbackTitle(description);
  }
}

function fallbackTitle(description: string): string {
  // Take first line, truncate to ~60 chars
  const firstLine = description.split('\n')[0].trim();
  if (firstLine.length <= 60) return firstLine;
  return firstLine.slice(0, 57) + '...';
}
