import { withLiveModelTargets, type LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { resolveModelTarget, UnsupportedModelLevelError } from '@zana-ai/zcc-host-daemon/harness/target-resolution';

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

type DiscoveryScope = Parameters<typeof liveScopedProviderFor>[1];
type LiveView = <P extends LaunchProvider>(provider: P, scope: DiscoveryScope) => Promise<P>;

/**
 * A live-view lookup that lists each harness's inventory at most once per cwd. Use one
 * per resolution pass (for example, one Team admission) so slots on the same harness
 * share a listing instead of each spawning their own.
 */
export function memoizedLiveScopedProviderFor(live: LiveView = liveScopedProviderFor): LiveView {
  const views = new Map<string, Promise<LaunchProvider>>();
  return <P extends LaunchProvider>(provider: P, scope: DiscoveryScope): Promise<P> => {
    const key = `${provider.adapter.descriptor.id}\0${scope.cwd}`;
    let view = views.get(key);
    if (!view) {
      view = live(provider, scope);
      views.set(key, view);
      // A failed listing is not cached, so a later slot can retry.
      view.catch(() => views.delete(key));
    }
    return view as Promise<P>;
  };
}

/**
 * Resolve a slot's model. A tier with no built-in mapping on the given provider can still
 * resolve through the user's tier rules over the live model inventory, so retry once on a
 * launch-scoped view before falling back to the harness default.
 */
export async function resolveSlotModel<P extends LaunchProvider>(
  provider: P,
  input: Parameters<typeof resolveModelTarget>[1],
  scope: DiscoveryScope,
  live: LiveView = liveScopedProviderFor
): Promise<{ model: ReturnType<typeof resolveModelTarget>; provider: P }> {
  try {
    return { model: resolveModelTarget(provider, { ...input, strictTier: true }), provider };
  } catch (error) {
    if (!(error instanceof UnsupportedModelLevelError)) throw error;
    const view = await live(provider, scope);
    return { model: resolveModelTarget(view, input), provider: view };
  }
}
