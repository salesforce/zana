export interface CoalescedReconciler {
  request(): Promise<void>;
  dispose(): Promise<void>;
}

/** Retain one running job and one dirty bit, never a queue of triggers. */
export function createCoalescedReconciler(
  reconcile: () => Promise<unknown>,
  warn: (error: unknown) => void
): CoalescedReconciler {
  let disposed = false;
  let queued = false;
  let running: Promise<void> | undefined;

  async function drain(): Promise<void> {
    try {
      while (queued && !disposed) {
        queued = false;
        try {
          await reconcile();
        } catch (error) {
          warn(error);
        }
        // Yield between passes so a busy producer cannot monopolize the loop.
        if (queued && !disposed) await new Promise<void>(resolve => setImmediate(resolve));
      }
    } finally {
      running = undefined;
    }
  }

  return {
    request: () => {
      if (disposed) return Promise.resolve();
      queued = true;
      running ??= Promise.resolve().then(drain);
      return running;
    },
    dispose: async () => {
      disposed = true;
      queued = false;
      await running;
    }
  };
}
