const reported = new Set<string>();

/**
 * Report a swallowed Settings-search failure ONCE per key. Search keeps working
 * without the failing source (a provider, a value accessor, a fetch), but the
 * failure is visible for debugging. Once-per-key because the corpus rebuilds
 * on keystrokes: a broken accessor must not log on every one.
 */
export function warnSettingsSearchOnce(key: string, message: string, error: unknown): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[settings-search] ${message}`, error);
}

/** Test hook: forget which failures were already reported. */
export function resetSettingsSearchWarnings(): void {
  reported.clear();
}
