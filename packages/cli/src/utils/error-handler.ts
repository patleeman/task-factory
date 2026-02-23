// =============================================================================
// Centralized Error Handler
// =============================================================================

import chalk from 'chalk';

export interface CLIError extends Error {
  exitCode: number;
  shouldReport: boolean;
}

export function createError(message: string, exitCode = 1, shouldReport = true): CLIError {
  const error = new Error(message) as CLIError;
  error.exitCode = exitCode;
  error.shouldReport = shouldReport;
  return error;
}

export function handleError(err: unknown): never {
  if (err instanceof Error) {
    const cliErr = err as CLIError;
    
    // Only log if we should report
    if (cliErr.shouldReport !== false) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
    
    // Use provided exit code or default to 1
    process.exit(cliErr.exitCode || 1);
  }
  
  // Unknown error type
  console.error(chalk.red(`Unknown error: ${String(err)}`));
  process.exit(1);
}

// Helper to wrap async functions with error handling
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    try {
      return (await fn(...args)) as ReturnType<T>;
    } catch (err) {
      handleError(err);
    }
  };
}

// Validation helpers
export function validateString(value: unknown, name: string, maxLength?: number): string {
  if (typeof value !== 'string') {
    throw createError(`${name} must be a string`);
  }
  if (maxLength && value.length > maxLength) {
    throw createError(`${name} must be ${maxLength} characters or less`);
  }
  return value;
}

export function validateNumber(value: unknown, name: string, min?: number, max?: number): number {
  const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (isNaN(num)) {
    throw createError(`${name} must be a number`);
  }
  if (min !== undefined && num < min) {
    throw createError(`${name} must be at least ${min}`);
  }
  if (max !== undefined && num > max) {
    throw createError(`${name} must be at most ${max}`);
  }
  return num;
}

export function validateBoolean(value: unknown, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  throw createError(`${name} must be "true" or "false"`);
}

export function validateArray<T>(value: unknown, name: string, maxLength?: number): T[] {
  if (!Array.isArray(value)) {
    throw createError(`${name} must be an array`);
  }
  if (maxLength && value.length > maxLength) {
    throw createError(`${name} must have at most ${maxLength} items`);
  }
  return value as T[];
}
