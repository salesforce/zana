import type { SessionStats } from '@zana-ai/zcc-domain/product';

/** Preserve last successful counters when a forced exit read cannot produce stats. */
export async function finalSessionStats(
  fresh: SessionStats | null,
  cached: SessionStats | null | undefined,
  previousPending?: Promise<SessionStats | null>
): Promise<SessionStats | null> {
  return fresh ?? cached ?? await previousPending?.catch(() => null) ?? null;
}
