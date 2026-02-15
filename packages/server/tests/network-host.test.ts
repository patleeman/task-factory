import { describe, expect, it } from 'vitest';
import { getNonLoopbackBindWarning, isLoopbackHost } from '../src/network-host.js';

describe('network-host', () => {
  it('treats loopback host values as loopback bindings', () => {
    const loopbackHosts = [
      '127.0.0.1',
      '127.0.0.42',
      'localhost',
      'LOCALHOST',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
    ];

    for (const host of loopbackHosts) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('treats non-loopback host values as externally reachable bindings', () => {
    const nonLoopbackHosts = ['0.0.0.0', '::', '192.168.1.15', '10.0.0.5'];

    for (const host of nonLoopbackHosts) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it('returns startup warning context for non-loopback binds', () => {
    const warning = getNonLoopbackBindWarning('0.0.0.0', 3000);

    expect(warning).toEqual({
      message: expect.stringContaining('Non-loopback bind host detected'),
      data: {
        host: '0.0.0.0',
        port: 3000,
        exposureRisk: expect.stringContaining('exposed'),
        recommendation: expect.stringContaining('HOST=127.0.0.1'),
      },
    });
  });

  it('does not return startup warning context for loopback binds', () => {
    expect(getNonLoopbackBindWarning('127.0.0.1', 3000)).toBeNull();
    expect(getNonLoopbackBindWarning('localhost', 3000)).toBeNull();
    expect(getNonLoopbackBindWarning('::1', 3000)).toBeNull();
    expect(getNonLoopbackBindWarning(' ::1 ', 3000)).toBeNull();
  });

  it('does not return startup warning context for empty host values', () => {
    expect(getNonLoopbackBindWarning('', 3000)).toBeNull();
    expect(getNonLoopbackBindWarning('   ', 3000)).toBeNull();
  });
});
