import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDebug = process.env.DEBUG;
const originalLogPath = process.env.PI_FACTORY_SERVER_LOG_PATH;

const tempRoots: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function setTempHome(): string {
  const homePath = createTempDir('pi-factory-home-');
  process.env.HOME = homePath;
  process.env.USERPROFILE = homePath;
  return homePath;
}

function readJsonLines(filePath: string): Array<Record<string, unknown>> {
  const content = readFileSync(filePath, 'utf-8').trim();

  if (!content) {
    return [];
  }

  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function loadLoggerModule() {
  vi.resetModules();
  return await import('../src/logger.js');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.DEBUG = originalDebug;

  if (typeof originalLogPath === 'string') {
    process.env.PI_FACTORY_SERVER_LOG_PATH = originalLogPath;
  } else {
    delete process.env.PI_FACTORY_SERVER_LOG_PATH;
  }

  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('logger', () => {
  it('writes info/warn/error entries to both console and file sink', async () => {
    const homePath = setTempHome();
    const customLogPath = join(homePath, 'custom', 'logs', 'server.jsonl');

    process.env.PI_FACTORY_SERVER_LOG_PATH = customLogPath;
    delete process.env.DEBUG;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { logger } = await loadLoggerModule();

    expect(existsSync(customLogPath)).toBe(false);

    logger.info('info message', { requestId: 'req-1' });
    logger.warn('warn message');
    logger.error('error message', { requestId: 'req-2' });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    expect(existsSync(customLogPath)).toBe(true);

    const lines = readFileSync(customLogPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    expect(lines[0]).toBe(String(infoSpy.mock.calls[0][0]));
    expect(lines[1]).toBe(String(warnSpy.mock.calls[0][0]));
    expect(lines[2]).toBe(String(errorSpy.mock.calls[0][0]));

    const levels = lines.map((line) => (JSON.parse(line) as { level: string }).level);
    expect(levels).toEqual(['info', 'warn', 'error']);
  });

  it('uses ~/.taskfactory default path when env override is unset', async () => {
    const homePath = setTempHome();
    const expectedDefaultPath = join(homePath, '.taskfactory', 'logs', 'server.jsonl');

    delete process.env.PI_FACTORY_SERVER_LOG_PATH;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { logger, resolveServerLogPath } = await loadLoggerModule();

    expect(resolveServerLogPath()).toBe(expectedDefaultPath);

    logger.info('default-path-message');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(expectedDefaultPath)).toBe(true);

    const entries = readJsonLines(expectedDefaultPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('default-path-message');
  });

  it('expands ~/ paths in PI_FACTORY_SERVER_LOG_PATH', async () => {
    const homePath = setTempHome();
    const expectedPath = join(homePath, 'custom', 'logs', 'tilde.jsonl');

    process.env.PI_FACTORY_SERVER_LOG_PATH = '~/custom/logs/tilde.jsonl';

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { logger, resolveServerLogPath } = await loadLoggerModule();

    expect(resolveServerLogPath()).toBe(expectedPath);

    logger.info('tilde-path-message');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(existsSync(expectedPath)).toBe(true);
    const entries = readJsonLines(expectedPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe('tilde-path-message');
  });

  it('writes debug logs only when DEBUG is enabled', async () => {
    const homePath = setTempHome();
    const debugLogPath = join(homePath, 'debug', 'server.jsonl');

    process.env.PI_FACTORY_SERVER_LOG_PATH = debugLogPath;

    delete process.env.DEBUG;
    const debugSpyDisabled = vi.spyOn(console, 'debug').mockImplementation(() => {});

    let loggerModule = await loadLoggerModule();
    loggerModule.logger.debug('hidden debug');

    expect(debugSpyDisabled).not.toHaveBeenCalled();
    expect(existsSync(debugLogPath)).toBe(false);

    vi.restoreAllMocks();

    process.env.DEBUG = '1';
    const debugSpyEnabled = vi.spyOn(console, 'debug').mockImplementation(() => {});

    loggerModule = await loadLoggerModule();
    loggerModule.logger.debug('visible debug', { source: 'test' });

    expect(debugSpyEnabled).toHaveBeenCalledTimes(1);
    expect(existsSync(debugLogPath)).toBe(true);

    const entries = readJsonLines(debugLogPath);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('debug');
    expect(entries[0]?.message).toBe('visible debug');
  });

  it('keeps console logging active when file writes fail', async () => {
    const homePath = setTempHome();
    const invalidLogPath = join(homePath, 'invalid-log-target');

    mkdirSync(invalidLogPath, { recursive: true }); // Directory path causes append failures.
    process.env.PI_FACTORY_SERVER_LOG_PATH = invalidLogPath;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { logger } = await loadLoggerModule();

    expect(() => logger.info('first message')).not.toThrow();
    expect(() => logger.info('second message')).not.toThrow();

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const warningEntry = JSON.parse(String(warnSpy.mock.calls[0][0])) as {
      message?: string;
      data?: { logFilePath?: string; error?: string };
    };

    expect(warningEntry.message).toContain('File log sink disabled');
    expect(warningEntry.data?.logFilePath).toBe(invalidLogPath);
    expect(typeof warningEntry.data?.error).toBe('string');
  });
});
