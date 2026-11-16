import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import { canonicalThreadProviderId } from './thread-provider-catalog.js';

/**
 * Compatibility fallback for older callers with no explicit thread default:
 * the legacy harness default, then the first usable registration. Configured
 * thread defaults are resolved separately and must never silently fall back.
 */
export function defaultSpawnProviderId(
  providers: ReadonlyArray<{ id: string; unavailableReason?: string }>,
  defaultHarness: HarnessFamily | null | undefined
): string | null {
  const usable = providers.filter((row) => !row.unavailableReason);
  const preferred = defaultHarness ? canonicalThreadProviderId(defaultHarness) : null;
  if (preferred && usable.some((row) => row.id === preferred)) return preferred;
  return usable[0]?.id ?? providers[0]?.id ?? null;
}
