import { withLiveModelTargets, type LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';

/**
 * Per-slot launch-scoped view of a shared provider for Team route snapshots.
 * Slots resolve concurrently, so each slot probes its own live inventory and
 * resolves through its own view; nothing is written onto the shared singleton.
 * Providers without a probe (or with an empty/unavailable one) return unchanged.
 */
export async function liveScopedProviderFor<P extends LaunchProvider>(
  sharedProvider: P,
  discoveryInput: { cwd: string; config: Parameters<NonNullable<LaunchProvider['discoverModelTargets']>>[0]['config'] }
): Promise<P> {
  const liveModels = sharedProvider.discoverModelTargets
    ? await sharedProvider.discoverModelTargets(discoveryInput)
    : undefined;
  return withLiveModelTargets(sharedProvider, liveModels);
}
