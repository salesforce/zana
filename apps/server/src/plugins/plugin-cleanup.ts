import { rm } from 'node:fs/promises';

/** Only disposable, caller-confined directories belong here, never plugin data or journals. */
export async function removePluginTemporaryDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    // A leftover directory must not replace the operation's result. Only orphans
    // under plugins/generations are retried by startup pruning; OS-tmpdir leftovers
    // are left to the OS. Do not retain an unbounded timer queue.
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    console.warn(`[plugins] Temporary directory cleanup failed (${code}): ${path}`);
  }
}
