/**
 * Serialise async work so overlapping triggers share one in-flight run and at
 * most one follow-up. A 400ms poll that invalidates every in-flight request
 * never applies a slow result; this keeps the first run and queues a refresh.
 */
export function createCoalescedRunner(task: () => Promise<void>): {
  run: () => void;
  dispose: () => void;
} {
  let disposed = false;
  let inFlight = false;
  let queued = false;

  const run = (): void => {
    if (disposed) return;
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(task());
    } catch {
      pending = Promise.resolve();
    }
    void pending.then(
      () => undefined,
      () => undefined
    ).then(() => {
      inFlight = false;
      if (disposed) return;
      if (queued) {
        queued = false;
        run();
      }
    });
  };

  return {
    run,
    dispose: () => {
      disposed = true;
      queued = false;
    }
  };
}
