/**
 * Create Extension Tool
 *
 * Registers a `create_extension` tool that lets the foreman create new TypeScript extensions.
 * Extensions are written to the extensions/ directory with proper module structure.
 */
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';

declare global {
  var __piFactoryCreateExtensionCallbacks: Map<string, {
    createExtension: (payload: {
      name: string;
      audience: 'foreman' | 'task' | 'all';
      typescript: string;
      confirmed?: boolean;
    }) => Promise<{
      success: boolean;
      path?: string;
      error?: string;
      warnings?: string[];
      validationErrors?: string[];
      needsConfirmation?: boolean;
    }>;
    listExtensions: () => Promise<Array<{ name: string; path: string; audience: string }>>;
  }> | undefined;
}

// Valid extension name pattern: lowercase letters, numbers, hyphens (1-64 chars, must start with letter/number)
const EXTENSION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validateExtensionName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim().toLowerCase();

  if (!trimmed) {
    return { valid: false, error: 'Extension name is required' };
  }

  if (!EXTENSION_NAME_PATTERN.test(trimmed)) {
    return {
      valid: false,
      error: 'Extension name must be lowercase letters, numbers, or hyphens (1-64 chars, must start with letter/number)'
    };
  }

  return { valid: true };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'create_extension',
    label: 'Create Extension',
    description:
      'Create a new TypeScript extension that can extend Pi with custom tools. ' +
      'Extensions are stored as .ts files in the extensions/ directory and execute code (unlike skills which are just prompts). ' +
      'The extension will be validated for TypeScript syntax and scanned for dangerous patterns before creation. ' +
      'User confirmation is required before the extension is written.',
    parameters: Type.Object({
      name: Type.String({
        description: 'Extension name (lowercase letters, numbers, hyphens only; 1-64 chars, must start with letter/number)',
      }),
      audience: Type.Union(
        [
          Type.Literal('foreman', { description: 'Only available to foreman (planning)' }),
          Type.Literal('task', { description: 'Only available to task agents (execution)' }),
          Type.Literal('all', { description: 'Available to both foreman and task agents' }),
        ],
        { description: 'Who can use this extension' }
      ),
      typescript: Type.String({
        description: 'TypeScript source code for the extension. Must export a default function that takes an ExtensionAPI parameter.',
      }),
      confirmed: Type.Optional(Type.Boolean({
        description: 'Set to true to confirm creation after reviewing warnings/errors',
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { name, audience, typescript, confirmed } = params;

      const callbacks = globalThis.__piFactoryCreateExtensionCallbacks;
      if (!callbacks || callbacks.size === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Create extension callbacks not available. The extension management service is not initialized.',
          }],
          details: { error: 'Callbacks not available' },
        };
      }

      const [, cb] = callbacks.entries().next().value!;

      // Validate extension name
      const validation = validateExtensionName(name);
      if (!validation.valid) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${validation.error}`,
          }],
          details: { error: validation.error },
        };
      }

      // Validate audience
      if (!audience || !['foreman', 'task', 'all'].includes(audience)) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: Audience must be one of: foreman, task, all',
          }],
          details: { error: 'Invalid audience' },
        };
      }

      // Validate TypeScript source
      if (!typescript || typescript.trim().length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Error: TypeScript source is required.',
          }],
          details: { error: 'Missing TypeScript source' },
        };
      }

      try {
        const result = await cb.createExtension({
          name: name.trim().toLowerCase(),
          audience: audience as 'foreman' | 'task' | 'all',
          typescript: typescript.trim(),
          confirmed,
        });

        if (result.needsConfirmation) {
          let warningText = '';
          if (result.warnings && result.warnings.length > 0) {
            warningText = '\n\nSecurity Warnings:\n' + result.warnings.map(w => `  [WARN] ${w}`).join('\n');
          }
          if (result.validationErrors && result.validationErrors.length > 0) {
            warningText += '\n\nValidation Issues:\n' + result.validationErrors.map(e => `  [ERROR] ${e}`).join('\n');
          }

          return {
            content: [{
              type: 'text' as const,
              text:
                `Extension "${name}" requires confirmation before creation.${warningText}\n\n` +
                `To confirm creation, call create_extension again with confirmed: true.`,
            }],
            details: {
              needsConfirmation: true,
              warnings: result.warnings,
              validationErrors: result.validationErrors,
            },
          };
        }

        if (result.success) {
          let message = `Extension "${name}" created successfully.\n\nPath: ${result.path}\n\nThe extension is now available and will appear in GET /api/factory/extensions.`;

          if (result.warnings && result.warnings.length > 0) {
            message += '\n\nWarnings:\n' + result.warnings.map(w => `  [WARN] ${w}`).join('\n');
          }

          return {
            content: [{
              type: 'text' as const,
              text: message,
            }],
            details: {
              name: name.trim().toLowerCase(),
              path: result.path,
              audience,
              warnings: result.warnings,
            },
          };
        } else {
          return {
            content: [{
              type: 'text' as const,
              text: `Error creating extension: ${result.error}`,
            }],
            details: {
              error: result.error,
              validationErrors: result.validationErrors,
            },
          };
        }
      } catch (err: any) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${err.message || String(err)}`,
          }],
          details: { error: err.message || String(err) },
        };
      }
    },
  });
}
