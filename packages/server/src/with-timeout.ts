/**
 * Runs an async operation with a timeout and cooperative cancellation.
 *
 * The operation receives an AbortSignal. On timeout, we abort that signal and
 * reject with timeoutMessage (or a default message).
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage?: string,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
          reject(new Error(timeoutMessage || `Operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
