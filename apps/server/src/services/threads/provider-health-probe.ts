import type { ProviderHealthResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { HostHub } from '../../http/host-hub.js';
import type { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import { bridgeLaunchForProvider, listThreadProviders } from './thread-provider-catalog.js';

const PROVIDER_HEALTH_TIMEOUT_MS = 8_000;
const pendingHealth = new WeakMap<HostHub, Map<string, Promise<Record<string, boolean>>>>();

/**
 * Map a health probe onto installed vs missing. `null` means the bridge does
 * not implement health (`supported: false`) — callers must leave extraInstalled
 * unset so family / extra-ACP probes remain in charge. A noop is not "missing".
 */
export function installedFromHealthResult(result: ProviderHealthResult): boolean | null {
  if (result.supported !== true) return null;
  return result.health.status !== 'not_installed';
}

export function isUnknownProviderHealthCommand(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String(error.code);
  return code === 'unknown_command' || code === 'unsupported';
}

/** Ask the target host whether each visibility:installed provider's CLI is present. */
export async function probeInstalledProviderHealth(input: {
  hub: HostHub;
  hostId?: string;
  artifacts: Pick<PluginHostArtifactRegistry, 'get'>;
}): Promise<Record<string, boolean>> {
  const installedIds = listThreadProviders()
    .filter((provider) => provider.visibility === 'installed' && !provider.unavailableReason)
    .map((provider) => provider.id);
  if (installedIds.length === 0) return {};

  let hostId: string;
  try {
    hostId = input.hub.resolveHostId(input.hostId);
  } catch {
    return {};
  }

  const launches = new Map(installedIds.map((id) => [id, bridgeLaunchForProvider(id, input.artifacts)]));
  const key = JSON.stringify([hostId, [...launches]]);
  let pending = pendingHealth.get(input.hub);
  if (!pending) { pending = new Map(); pendingHealth.set(input.hub, pending); }
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const extraInstalled: Record<string, boolean> = {};
    const results = await Promise.allSettled(installedIds.map(async (providerId) => {
      const result = await input.hub.callHostOnlineRpc<ProviderHealthResult>({
        hostId,
        timeoutMs: PROVIDER_HEALTH_TIMEOUT_MS,
        command: {
          type: 'provider.health',
          providerId,
          bridgeLaunch: launches.get(providerId)!
        }
      });
      return { providerId, installed: installedFromHealthResult(result) };
    }));

    for (const result of results) {
      if (result.status === 'rejected' && isUnknownProviderHealthCommand(result.reason)) {
        return {};
      }
    }
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.installed !== null) {
        extraInstalled[result.value.providerId] = result.value.installed;
      }
    }
    return extraInstalled;
  })().finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}

/** Health can confirm presence; it must not veto a daemon extra-ACP `--version` hit. */
export function mergeHealthIntoExtraInstalled(
  extraInstalled: Readonly<Record<string, boolean>>,
  health: Readonly<Record<string, boolean>>
): Record<string, boolean> {
  const next = { ...extraInstalled };
  for (const [id, installed] of Object.entries(health)) {
    if (installed) next[id] = true;
    else if (!(id in next)) next[id] = false;
  }
  return next;
}
