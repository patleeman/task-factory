import { isIP } from 'node:net';

const NON_LOOPBACK_STARTUP_WARNING = '[Startup] Non-loopback bind host detected. Task Factory may be reachable from other machines on your network.';

function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }

  return host;
}

function normalizeHost(host: string): string {
  return stripIpv6Brackets(host.trim().toLowerCase());
}

function isIpv4Loopback(host: string): boolean {
  if (isIP(host) !== 4) {
    return false;
  }

  return host.startsWith('127.');
}

function isIpv6Loopback(host: string): boolean {
  if (isIP(host) !== 6) {
    return false;
  }

  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }

  if (host.startsWith('::ffff:')) {
    return isIpv4Loopback(host.slice('::ffff:'.length));
  }

  return false;
}

export function isLoopbackHost(host: string): boolean {
  const normalizedHost = normalizeHost(host);

  if (!normalizedHost) {
    return false;
  }

  if (normalizedHost === 'localhost') {
    return true;
  }

  return isIpv4Loopback(normalizedHost) || isIpv6Loopback(normalizedHost);
}

export interface NonLoopbackBindWarning {
  message: string;
  data: {
    host: string;
    port: number;
    exposureRisk: string;
    recommendation: string;
  };
}

export function getNonLoopbackBindWarning(host: string, port: number): NonLoopbackBindWarning | null {
  const trimmedHost = host.trim();

  if (!trimmedHost || isLoopbackHost(trimmedHost)) {
    return null;
  }

  return {
    message: NON_LOOPBACK_STARTUP_WARNING,
    data: {
      host: trimmedHost,
      port,
      exposureRisk: 'Unauthenticated local-control APIs may be exposed to your local network.',
      recommendation: 'Use HOST=127.0.0.1 unless remote access is intentional.',
    },
  };
}
