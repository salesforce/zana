/**
 * Test-only idle-reap timing. Honored solely inside an isolated E2E home
 * (`ZCC_E2E_HOME`), so a production daemon can never be reconfigured through
 * the environment. Each value must be a positive integer of milliseconds.
 */
export function e2eIdleReapOverrides(
  env: Record<string, string | undefined> = process.env
): { idleReapIntervalMs?: number; idleReapAfterMs?: number } {
  if (!env.ZCC_E2E_HOME) return {};
  const parse = (raw: string | undefined): number | undefined => {
    if (!raw || !/^\d+$/.test(raw)) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  const idleReapIntervalMs = parse(env.ZCC_E2E_IDLE_REAP_INTERVAL_MS);
  const idleReapAfterMs = parse(env.ZCC_E2E_IDLE_REAP_AFTER_MS);
  return {
    ...(idleReapIntervalMs !== undefined ? { idleReapIntervalMs } : {}),
    ...(idleReapAfterMs !== undefined ? { idleReapAfterMs } : {})
  };
}
