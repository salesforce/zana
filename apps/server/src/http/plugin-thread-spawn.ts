/**
 * Which thread provider a plugin `sdk.threads.spawn` runs on.
 *
 * Precedence: explicit `providerId` (unknown id rejects) → `harness:
 * 'project-default'` (the project's effective AI harness, the same Global →
 * Project resolution a new agent launch uses; rejects when none is usable) →
 * legacy first-registered provider. The legacy fallback is kept only for
 * callers that set neither field, so older plugins keep working; it is NOT
 * used once a caller opts into `harness`.
 */
import type {
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  HarnessVerifyResult,
  LaunchProfileId
} from '@zana-ai/zcc-domain/product';
import { threadProviderIdForHarnessFamily } from '@zana-ai/zcc-domain/launch-provider';
import { defaultSpawnProviderId } from '../services/threads/default-spawn-provider.js';
import { isThreadProviderOffered } from '../services/threads/thread-execution-options.js';
import type { ThreadProviderRecord } from '../services/threads/thread-provider-catalog.js';

export type PluginSpawnPermissionMode = 'accept-edits' | 'auto' | 'full';

export interface PluginSpawnProviderResolution {
  providerId: string;
  /** Set only when the resolved default implies one (yolo → full). */
  permissionMode?: PluginSpawnPermissionMode;
  /** Set for `harness: 'project-default'`: the effective harness whose overrides apply. */
  harness?: { family: HarnessFamily; profile: LaunchProfileId };
}

const SETTINGS_HINT = 'Choose an installed, enabled harness in Settings → AI Harness.';

export class PluginSpawnHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginSpawnHarnessError';
  }
}

export async function resolvePluginSpawnProvider(input: {
  providerId?: string;
  harness?: 'project-default';
  providers: readonly Pick<ThreadProviderRecord, 'id' | 'unavailableReason'>[];
  /** Settings' default harness; steers the legacy fallback toward the composer's preselected provider. */
  defaultHarness?: HarnessFamily | null;
  /** Lazily resolves the project's effective harness; only called for `harness`. */
  effectiveDefault(): Promise<EffectiveHarnessDefaultResult>;
}): Promise<PluginSpawnProviderResolution> {
  const known = (id: string) => input.providers.some((row) => row.id === id);
  if (input.providerId) {
    if (!known(input.providerId)) throw new Error(`unknown thread provider: ${input.providerId}`);
    return { providerId: input.providerId };
  }
  if (input.harness === 'project-default') {
    let result: EffectiveHarnessDefaultResult;
    try {
      result = await input.effectiveDefault();
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : 'the host could not be reached';
      throw new PluginSpawnHarnessError(`No usable AI harness: ${reason}. ${SETTINGS_HINT}`);
    }
    if (!result.ok) throw new PluginSpawnHarnessError(`No usable AI harness: ${result.message}. ${SETTINGS_HINT}`);
    const providerId = threadProviderIdForHarnessFamily(result.family);
    if (!providerId || !known(providerId)) {
      throw new PluginSpawnHarnessError(
        `No usable AI harness: the project default (${result.family}) has no loaded thread provider. `
        + 'Check Plugins, or choose another harness in Settings → AI Harness.'
      );
    }
    const harness = { family: result.family, profile: result.profile };
    return result.profile.endsWith('-yolo') ? { providerId, permissionMode: 'full', harness } : { providerId, harness };
  }
  const first = defaultSpawnProviderId(input.providers, input.defaultHarness);
  if (!first) throw new Error('no thread provider is registered');
  return { providerId: first };
}

/**
 * `available` for `sdk.providers.list`: registered, its plugin bridge loaded,
 * and (when the host could be probed) installed + enabled on that host — the
 * same rule the composer's provider picker uses. With no probe result the
 * host is unknown, so only the bridge state is reported.
 */
export function pluginProviderAvailable(
  provider: Pick<ThreadProviderRecord, 'id' | 'visibility' | 'unavailableReason'>,
  probe: { availability: readonly HarnessVerifyResult[]; extraInstalled: Readonly<Record<string, boolean>> } | null
): boolean {
  if (provider.unavailableReason) return false;
  if (!probe) return true;
  return isThreadProviderOffered(provider, probe.availability, probe.extraInstalled);
}
