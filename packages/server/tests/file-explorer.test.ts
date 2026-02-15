import { describe, expect, it } from 'vitest';
import { getExplorerOpenCommand, openInFileExplorer } from '../src/file-explorer';

describe('file explorer command resolution', () => {
  it('maps darwin to open', () => {
    expect(getExplorerOpenCommand('/tmp/workspace', 'darwin')).toEqual({
      command: 'open',
      args: ['/tmp/workspace'],
    });
  });

  it('maps linux to xdg-open', () => {
    expect(getExplorerOpenCommand('/tmp/workspace', 'linux')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/workspace'],
    });
  });

  it('maps win32 to explorer.exe', () => {
    expect(getExplorerOpenCommand('C:\\workspace', 'win32')).toEqual({
      command: 'explorer.exe',
      args: ['C:\\workspace'],
    });
  });

  it('returns null for unsupported platforms', () => {
    expect(getExplorerOpenCommand('/tmp/workspace', 'aix')).toBeNull();
  });
});

describe('openInFileExplorer validation', () => {
  it('rejects empty target paths', async () => {
    await expect(openInFileExplorer('   ', 'darwin')).rejects.toThrow('Target path is required');
  });

  it('rejects unsupported platforms before spawning', async () => {
    await expect(openInFileExplorer('/tmp/workspace', 'aix')).rejects.toThrow('Unsupported platform: aix');
  });
});
