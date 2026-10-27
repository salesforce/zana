import type { ProviderAgentDescriptorsResult, ProviderStatusResult } from '@zana-ai/zcc-contracts/host-rpc';
import type {
  AppConfig,
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  HarnessVerifyResult,
  LaunchProfileId,
  Persona,
  Project
} from '@zana-ai/zcc-domain/product';
import { harnessAdapterDescriptorsFromVerify } from '@zana-ai/zcc-host-daemon/harness/registry';
import { resolveEffectiveHarnessDefault } from '@zana-ai/zcc-host-daemon/harness/effective-default';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import type { HarnessAdapterDescriptor, HarnessAgentDiscoveryResult } from '@zana-ai/zcc-domain/harness-adapter';
import { HostUnavailableError, type HostHub } from './host-hub.js';

const FAMILIES = new Set<HarnessFamily>(['claude', 'cursor', 'codex', 'pi', 'opencode', 'grok', 'mastracode', 'afcode']);

function asVerifyResults(result: ProviderStatusResult): HarnessVerifyResult[] {
  return result.providers.flatMap((entry) => {
    if (!FAMILIES.has(entry.family as HarnessFamily)) return [];
    return [{
      family: entry.family as HarnessFamily,
      label: entry.label,
      binary: entry.binary,
      enabled: entry.enabled,
      alwaysEnabled: entry.alwaysEnabled,
      installed: entry.installed,
      version: entry.version,
      normalizedVersion: entry.normalizedVersion,
      installHint: entry.installHint
    }];
  });
}

function extraInstalledFromStatus(result: ProviderStatusResult): Record<string, boolean> {
  const extra: Record<string, boolean> = {};
  for (const row of result.extraInstalledAgents ?? []) {
    extra[row.providerId] = row.installed;
  }
  return extra;
}

async function providerStatus(hub: HostHub, hostId?: string, includeModelInventory = false): Promise<ProviderStatusResult | null> {
  try {
    const resolved = hub.resolveHostId(hostId);
    return await hub.callHostOnlineRpc<ProviderStatusResult>({
      hostId: resolved,
      command: { type: 'provider.status', ...(includeModelInventory ? { includeModelInventory: true } : {}) }
    });
  } catch (error) {
    if (error instanceof HostUnavailableError) return null;
    throw error;
  }
}

export async function harnessVerify(hub: HostHub, hostId?: string): Promise<HarnessVerifyResult[]> {
  const status = await providerStatus(hub, hostId);
  return status ? asVerifyResults(status) : [];
}

type VerifyBundle = {
  availability: HarnessVerifyResult[];
  extraInstalled: Record<string, boolean>;
};
const pendingBundles = new WeakMap<HostHub, Map<string, Promise<VerifyBundle>>>();

/** Share concurrent probes, but never cache unavailable hosts as an empty roster. */
export async function harnessVerifyBundle(hub: HostHub, hostId?: string): Promise<VerifyBundle> {
  const resolved = hub.resolveHostId(hostId);
  let pending = pendingBundles.get(hub);
  if (!pending) { pending = new Map(); pendingBundles.set(hub, pending); }
  const existing = pending.get(resolved);
  if (existing) return existing;
  const request = hub.callHostOnlineRpc<ProviderStatusResult>({
    hostId: resolved, command: { type: 'provider.status' }
  }).then((status) => ({
    availability: asVerifyResults(status),
    extraInstalled: extraInstalledFromStatus(status)
  })).finally(() => { pending.delete(resolved); });
  pending.set(resolved, request);
  return request;
}

export async function harnessDescriptors(hub: HostHub, hostId?: string): Promise<HarnessAdapterDescriptor[]> {
  const status = await providerStatus(hub, hostId, true);
  const results = status ? asVerifyResults(status) : [];
  if (results.length === 0) return [];
  return harnessAdapterDescriptorsFromVerify(results, status?.modelInventories);
}

/** Server validates project ownership before asking its assigned host to inspect native agents. */
export async function harnessAgentDescriptors(input: {
  hub: HostHub;
  project: Project | undefined;
  profile: LaunchProfileId;
  refresh: boolean;
}): Promise<HarnessAgentDiscoveryResult> {
  if (!input.project || input.project.remote || !VALID_PROFILES.includes(input.profile)) {
    return { status: 'failure' };
  }
  try {
    const hostId = input.hub.resolveHostId(input.project.hostId);
    return await input.hub.callHostOnlineRpc<ProviderAgentDescriptorsResult>({
      hostId,
      command: {
        type: 'provider.agent_descriptors',
        cwd: input.project.path,
        profile: input.profile,
        refresh: input.refresh
      }
    }) as HarnessAgentDiscoveryResult;
  } catch (error) {
    if (error instanceof HostUnavailableError) return { status: 'failure' };
    throw error;
  }
}

export async function harnessEffectiveDefault(input: {
  hub: HostHub;
  project: Project | undefined;
  config: AppConfig;
  personas: readonly Persona[];
  hostId?: string;
}): Promise<EffectiveHarnessDefaultResult> {
  const availability = await harnessVerify(input.hub, input.hostId);
  if (availability.length === 0) {
    return { ok: false, code: 'UNAVAILABLE_DEFAULT', message: 'Default harness unavailable' };
  }
  return resolveEffectiveHarnessDefault({
    project: input.project,
    config: input.config,
    personas: input.personas,
    availability
  });
}
