/**
 * Create Artifact Extension
 *
 * Registers a `create_artifact` tool that the planning agent calls to
 * generate rendered HTML artifacts on the shelf. Used for research summaries,
 * comparison tables, architecture diagrams, mockups, etc.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryShelfCallbacks: Map<string, {
    createDraftTask: (args: any) => Promise<void>;
    createArtifact: (args: any) => Promise<{ id: string; name: string }>;
  }> | undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_artifact',
    label: 'Create Artifact',
    description:
      'Create an HTML artifact on the shelf. Use this for research summaries, comparison tables, ' +
      'architecture diagrams, UI mockups, or any content that benefits from visual presentation. ' +
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
      let createdArtifact: { id: string; name: string } | null = null;

      if (callbacks) {
        for (const [, cb] of callbacks) {
          const created = await cb.createArtifact({ name, html });
          called = true;

          if (created && typeof created.id === 'string' && typeof created.name === 'string') {
            createdArtifact = { id: created.id, name: created.name };
          }
          break;
        }
      }

      if (!called) {
        return {
          content: [{ type: 'text' as const, text: `Artifact "${name}" created (shelf callbacks not available — may not appear on shelf).` }],
          details: {} as Record<string, unknown>,
        };
      }

      if (!createdArtifact) {
        return {
          content: [{
            type: 'text' as const,
            text: `Artifact created: "${name}"\n\nThe user can view it on the shelf.`,
          }],
          details: {} as Record<string, unknown>,
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `Artifact created: "${createdArtifact.name}"\n\nThe user can view it on the shelf.`,
        }],
        details: {
          artifactId: createdArtifact.id,
          artifactName: createdArtifact.name,
        },
      };
    },
  });
}
