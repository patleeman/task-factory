// =============================================================================
// Logger Service
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private formatEntry(level: LogLevel, message: string, data?: unknown): string {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    return JSON.stringify(entry);
  }

  debug(message: string, data?: unknown): void {
    if (process.env.DEBUG) {
      console.debug(this.formatEntry('debug', message, data));
    }
  }

  info(message: string, data?: unknown): void {
    console.info(this.formatEntry('info', message, data));
  }

  warn(message: string, data?: unknown): void {
    console.warn(this.formatEntry('warn', message, data));
  }

  error(message: string, data?: unknown): void {
    console.error(this.formatEntry('error', message, data));
  }
}

export const logger = new Logger();
