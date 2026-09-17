import { MONITORED_COUNT_CACHE_KEY, MONITORED_PRS_CACHE_KEY, type MonitoredPr } from '../../lib/types.js';
import type { ModuleHost } from './host.js';

/** Keep failed row actions visible and out of unhandled promise rejections. */
export async function runPrAction(host: ModuleHost, method: string, args: unknown): Promise<void> {
  try {
    const result = await host.call<{ ok: boolean; prs?: MonitoredPr[]; error?: string }>(method, args);
    if (!result?.ok) throw new Error(result?.error || 'The request failed. Please try again.');
    if (Array.isArray(result.prs)) {
      host.cache.set(MONITORED_PRS_CACHE_KEY, result.prs);
      host.cache.set(MONITORED_COUNT_CACHE_KEY, result.prs.length);
      host.cache.refreshBadge();
    }
  } catch (error) {
    host.toast(`Couldn't update PR — ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}
