import { withQueuedLock } from './process-local-queued-lock.js';

/** Serialize checkouts (`git switch`) on a given working tree. */
export function withCheckoutMutationLock<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  return withQueuedLock(`checkout:${cwd}`, run);
}
