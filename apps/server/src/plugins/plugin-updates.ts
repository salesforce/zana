/** How often the server re-checks installed catalog plugins for newer versions. */
export const PLUGIN_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startPluginUpdateSweep(args: {
  checkUpdates: () => Promise<unknown>;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): { stop(): void } {
  const intervalMs = args.intervalMs ?? PLUGIN_UPDATE_CHECK_INTERVAL_MS;
  const setIntervalFn = args.setIntervalFn ?? setInterval;
  const clearIntervalFn = args.clearIntervalFn ?? clearInterval;
  const timer = setIntervalFn(() => {
    void args.checkUpdates().catch(() => undefined);
  }, intervalMs);
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    stop() {
      clearIntervalFn(timer);
    }
  };
}
