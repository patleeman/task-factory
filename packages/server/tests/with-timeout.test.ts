import { describe, expect, it } from 'vitest';
import { withTimeout } from '../src/with-timeout.js';

describe('withTimeout', () => {
  it('resolves when promise finishes before timeout', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 100, 'timed out');
    expect(value).toBe('ok');
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 40);
    });

    await expect(withTimeout(slow, 5, 'timed out')).rejects.toThrow('timed out');
  });

  it('preserves original rejection when promise fails before timeout', async () => {
    const failed = Promise.reject(new Error('boom'));
    await expect(withTimeout(failed, 100, 'timed out')).rejects.toThrow('boom');
  });
});
