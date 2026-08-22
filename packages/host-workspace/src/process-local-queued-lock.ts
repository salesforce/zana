/**
 * FIFO mutex keyed by string. Callers await the returned release, then MUST
 * invoke it (including on throw). Used so git metadata mutations on one
 * common-dir serialize without overlapping `git worktree` / `git switch`.
 */
const tails = new Map<string, Promise<void>>();

export async function withQueuedLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, previous.then(() => current));
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (tails.get(key) === current) tails.delete(key);
  }
}
