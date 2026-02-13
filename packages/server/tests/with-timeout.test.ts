import { describe, expect, it } from 'vitest';
import { withTimeout } from '../src/with-timeout.js';

describe('withTimeout', () => {
  it('resolves when operation finishes before timeout', async () => {
    const value = await withTimeout(async () => 'ok', 100, 'timed out');
    expect(value).toBe('ok');
  });

  it('rejects with timeout error when operation takes too long', async () => {
    await expect(withTimeout(
      async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 40);
        });
        return 'late';
      },
      5,
      'timed out',
    )).rejects.toThrow('timed out');
  });

  it('preserves original rejection when operation fails before timeout', async () => {
    await expect(withTimeout(
      async () => {
        throw new Error('boom');
      },
      100,
      'timed out',
    )).rejects.toThrow('boom');
  });
});
