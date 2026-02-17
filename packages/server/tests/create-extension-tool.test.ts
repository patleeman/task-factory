import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import createExtensionTool from '../../../extensions/create-extension.ts';

describe('create_extension extension', () => {
  let tool: any;

  beforeEach(() => {
    tool = undefined;

    createExtensionTool({
      registerTool: (registered: any) => {
        tool = registered;
      },
    } as any);
  });

  afterEach(() => {
    delete (globalThis as any).__piFactoryCreateExtensionCallbacks;
  });

  it('forwards repo-local destination to callbacks', async () => {
    const createExtension = vi.fn().mockResolvedValue({
      success: true,
      path: '/tmp/workspace/.taskfactory/extensions/repo-ext.ts',
      warnings: [],
    });

    (globalThis as any).__piFactoryCreateExtensionCallbacks = new Map([
      ['workspace-1', { createExtension, listExtensions: vi.fn() }],
    ]);

    const result = await tool.execute(
      'tool-call-1',
      {
        name: 'repo-ext',
        audience: 'all',
        typescript: 'export default function () {}',
        destination: 'repo-local',
        confirmed: true,
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createExtension).toHaveBeenCalledWith({
      name: 'repo-ext',
      audience: 'all',
      typescript: 'export default function () {}',
      destination: 'repo-local',
      confirmed: true,
    });

    expect(result.details.destination).toBe('repo-local');
  });

  it('reports global as default destination when not provided', async () => {
    const createExtension = vi.fn().mockResolvedValue({
      success: true,
      path: '/tmp/home/.taskfactory/extensions/global-ext.ts',
      warnings: [],
    });

    (globalThis as any).__piFactoryCreateExtensionCallbacks = new Map([
      ['workspace-1', { createExtension, listExtensions: vi.fn() }],
    ]);

    const result = await tool.execute(
      'tool-call-2',
      {
        name: 'global-ext',
        audience: 'foreman',
        typescript: 'export default function () {}',
      },
      undefined,
      undefined,
      {} as any,
    );

    expect(createExtension).toHaveBeenCalledWith({
      name: 'global-ext',
      audience: 'foreman',
      typescript: 'export default function () {}',
      destination: undefined,
      confirmed: undefined,
    });

    expect(result.details.destination).toBe('global');
  });
});
