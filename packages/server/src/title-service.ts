// =============================================================================
// Title Generation Service
// =============================================================================
// Uses Pi SDK to auto-generate concise task titles from description + criteria

import { getModel } from '@mariozechner/pi-ai';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
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
    const authStorage = new AuthStorage();
    const modelRegistry = new ModelRegistry(authStorage);

    // Use a fast cheap model for title generation
    const model =
      getModel('anthropic', 'claude-haiku-4-5') ||
      getModel('anthropic', 'claude-sonnet-4-20250514') ||
      (await modelRegistry.getAvailable())[0];

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
    session.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        result += event.assistantMessageEvent.delta;
      }
    });

    await withTimeout(session.prompt(prompt), 10000, undefined);
    session.dispose();

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
