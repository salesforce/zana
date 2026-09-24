/** One non-overlapping sweep per product context, with an explicit shutdown path. */
export function startDeferredRetryLoop(sweep: () => Promise<void>, intervalMs = 5_000): () => void {
  let running = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    void Promise.resolve().then(sweep).catch(() => undefined).finally(() => { running = false; });
  }, intervalMs);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}
