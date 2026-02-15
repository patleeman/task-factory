// =============================================================================
// Logger Service
// =============================================================================

import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export const SERVER_LOG_PATH_ENV_VAR = 'PI_FACTORY_SERVER_LOG_PATH';

function defaultServerLogPath(): string {
  return join(homedir(), '.pi', 'factory', 'logs', 'server.jsonl');
}

function resolveTildePath(rawPath: string): string {
  if (rawPath === '~') {
    return homedir();
  }

  if (rawPath.startsWith('~/')) {
    return join(homedir(), rawPath.slice(2));
  }

  return rawPath;
}

export function resolveServerLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const configuredPath = env[SERVER_LOG_PATH_ENV_VAR];

  if (typeof configuredPath !== 'string') {
    return defaultServerLogPath();
  }

  const trimmedPath = configuredPath.trim();
  if (!trimmedPath) {
    return defaultServerLogPath();
  }

  return resolveTildePath(trimmedPath);
}

export class Logger {
  private readonly logFilePath: string;
  private fileSinkInitialized = false;
  private fileSinkDisabled = false;
  private fileSinkWarningLogged = false;

  constructor(logFilePath: string = resolveServerLogPath()) {
    this.logFilePath = logFilePath;
  }

  private formatEntry(level: LogLevel, message: string, data?: unknown): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    return JSON.stringify(entry);
  }

  private writeToConsole(level: LogLevel, formattedEntry: string): void {
    switch (level) {
      case 'debug':
        console.debug(formattedEntry);
        return;
      case 'info':
        console.info(formattedEntry);
        return;
      case 'warn':
        console.warn(formattedEntry);
        return;
      case 'error':
        console.error(formattedEntry);
        return;
      default:
        console.info(formattedEntry);
    }
  }

  private ensureFileSinkReady(): void {
    if (this.fileSinkInitialized) {
      return;
    }

    mkdirSync(dirname(this.logFilePath), { recursive: true });
    appendFileSync(this.logFilePath, '', 'utf-8');
    this.fileSinkInitialized = true;
  }

  private writeToFile(formattedEntry: string): void {
    if (this.fileSinkDisabled) {
      return;
    }

    try {
      this.ensureFileSinkReady();
      appendFileSync(this.logFilePath, `${formattedEntry}\n`, 'utf-8');
    } catch (error) {
      this.fileSinkDisabled = true;

      if (!this.fileSinkWarningLogged) {
        this.fileSinkWarningLogged = true;

        const errorMessage = error instanceof Error ? error.message : String(error);
        const warningEntry = this.formatEntry(
          'warn',
          'File log sink disabled; continuing with console-only logging.',
          {
            logFilePath: this.logFilePath,
            error: errorMessage,
          },
        );

        console.warn(warningEntry);
      }
    }
  }

  private write(level: LogLevel, message: string, data?: unknown): void {
    const formattedEntry = this.formatEntry(level, message, data);

    this.writeToConsole(level, formattedEntry);
    this.writeToFile(formattedEntry);
  }

  debug(message: string, data?: unknown): void {
    if (!process.env.DEBUG) {
      return;
    }

    this.write('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.write('error', message, data);
  }
}

export const logger = new Logger();
