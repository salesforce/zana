/** A startup step slower than this is logged as a warning. */
export const PLUGIN_STARTUP_SLOW_STEP_MS = 5_000;

export interface PluginStartupTimerOptions {
  now?: () => number;
  warn?: (message: string) => void;
  info?: (message: string) => void;
}

export interface PluginStartupTimer {
  /** Runs one step, records its duration and warns when it is slow. */
  step<T>(label: string, run: () => Promise<T>): Promise<T>;
  /** Logs the total with the slowest steps. Call once, when startup completes. */
  finish(): void;
}

/**
 * Times the steps of `plugins.start()` so a startup that outlasts the thread
 * wait limit can be traced to the step that stalled. A step that throws is
 * still recorded before the error propagates.
 */
export function createPluginStartupTimer(options: PluginStartupTimerOptions = {}): PluginStartupTimer {
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message) => console.warn(message));
  const info = options.info ?? ((message) => console.info(message));
  const startedAt = now();
  const steps: Array<{ label: string; ms: number }> = [];
  return {
    async step(label, run) {
      const stepStart = now();
      try {
        return await run();
      } finally {
        const ms = now() - stepStart;
        steps.push({ label, ms });
        if (ms >= PLUGIN_STARTUP_SLOW_STEP_MS) warn(`[plugins] slow startup step ${label} took ${ms}ms`);
      }
    },
    finish() {
      const slowest = [...steps].sort((a, b) => b.ms - a.ms).slice(0, 3)
        .map((entry) => `${entry.label} ${entry.ms}ms`).join(', ');
      info(`[plugins] startup finished in ${now() - startedAt}ms${slowest ? ` (slowest: ${slowest})` : ''}`);
    }
  };
}
