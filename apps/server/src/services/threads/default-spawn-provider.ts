import type { HarnessFamily } from '@zana-ai/zcc-domain/product';
import { canonicalThreadProviderId } from './thread-provider-catalog.js';

/**
 * The provider a plugin-spawned thread runs on when the plugin names none:
 * Settings' default harness, the same choice the composer preselects. Only then
 * the first usable registered provider, so the result never hinges on plugin
 * registration order alone.
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
