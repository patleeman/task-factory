/**
 * Create Artifact Extension
 *
 * Registers a `create_artifact` tool that the planning agent calls to
 * generate rendered HTML artifacts inline in the Foreman chat session.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<any>;
    createArtifact: (args: any) => Promise<{ id: string; name: string; html: string; createdAt?: string }>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_artifact',
    label: 'Create Artifact',
    description:
      'Create an HTML artifact inline in the Foreman chat session. ' +
      'Use this for research summaries, comparison tables, architecture diagrams, UI mockups, ' +
      'or any content that benefits from visual presentation. ' +
      'The HTML should be a complete, self-contained document with inline styles.',
    parameters: Type.Object({
      name: Type.String({ description: 'Descriptive name for the artifact (e.g. "OAuth Provider Comparison")' }),
      html: Type.String({
        description: 'Complete HTML content. Use inline styles. Should be self-contained — no external resources.',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { name, html } = params;

      const callbacks = globalThis.__piFactoryShelfCallbacks;
      let called = false;
      let createdArtifact: { id: string; name: string; html: string; createdAt?: string } | null = null;

      if (callbacks) {
        for (const [, cb] of callbacks) {
          const created = await cb.createArtifact({ name, html });
          called = true;

          if (
            created
            && typeof created.id === 'string'
            && typeof created.name === 'string'
            && typeof created.html === 'string'
          ) {
            createdArtifact = {
              id: created.id,
              name: created.name,
              html: created.html,
              createdAt: created.createdAt,
            };
          }
          break;
        }
      }

      if (!called) {
        return {
          content: [{ type: 'text' as const, text: `Artifact "${name}" created (planning callbacks not available — inline card may not appear).` }],
          details: {} as Record<string, unknown>,
        };
      }

      if (!createdArtifact) {
        return {
          content: [{
            type: 'text' as const,
            text: `Artifact created: "${name}"\n\nThe user can open it from the inline chat card.`,
          }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Artifact created: "${createdArtifact.name}"\n\nThe user can open it from the inline chat card.`,
        }],
        details: {
          artifactId: createdArtifact.id,
          artifactName: createdArtifact.name,
          artifactHtml: createdArtifact.html,
          artifact: createdArtifact,
        },
      };
    },
  });
}
