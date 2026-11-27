/**
 * Bounded retry for the atomic temp-then-rename write. On Windows, renaming
 * over a file that another process (or antivirus / an indexer) briefly has
 * open fails with EPERM, EBUSY or EACCES; the lock normally clears within
 * milliseconds.
 *
 * The wait is synchronous (`Atomics.wait`) because the callers are synchronous
 * and run on the Electron main thread, so it blocks that thread. The total
 * wait is capped at {@link RENAME_RETRY_TOTAL_MS} (about 0.9 s), with short
 * early steps (5, 10, 20, 40 ms) so the common brief lock costs almost nothing.
 */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [5, 10, 20, 40, 80, 160, 200, 200, 200];
export const RENAME_RETRY_TOTAL_MS = RENAME_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);

const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function isRetryableRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs `rename`, retrying on EPERM/EBUSY/EACCES with the delays above. Any
 * other error, or the last retryable error once the delays run out, is
 * rethrown unchanged.
 */
export function renameWithRetry(
  rename: () => void,
  options: { sleep?: (ms: number) => void; delaysMs?: readonly number[] } = {}
): void {
  const sleep = options.sleep ?? sleepSync;
  const delays = options.delaysMs ?? RENAME_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      rename();
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt >= delays.length) throw error;
      sleep(delays[attempt]);
    }
  }
}
