import type { ProviderStatusResult } from '@zana-ai/zcc-contracts/host-rpc';
import type {
  AppConfig,
  EffectiveHarnessDefaultResult,
  HarnessFamily,
  HarnessVerifyResult,
  Persona,
  Project
} from '@zana-ai/zcc-domain/product';
import { harnessAdapterDescriptorsFromVerify } from '@zana-ai/zcc-host-daemon/harness/registry';
import { resolveEffectiveHarnessDefault } from '@zana-ai/zcc-host-daemon/harness/effective-default';
import type { HarnessAdapterDescriptor } from '@zana-ai/zcc-domain/harness-adapter';
import { HostUnavailableError, type HostHub } from './host-hub.js';

const FAMILIES = new Set<HarnessFamily>(['claude', 'cursor', 'codex', 'pi', 'opencode']);

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

async function providerStatus(hub: HostHub, hostId?: string): Promise<ProviderStatusResult | null> {
  try {
    const resolved = hub.resolveHostId(hostId);
    return await hub.callHostOnlineRpc<ProviderStatusResult>({
      hostId: resolved,
      command: { type: 'provider.status' }
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

export async function harnessDescriptors(hub: HostHub, hostId?: string): Promise<HarnessAdapterDescriptor[]> {
  const results = await harnessVerify(hub, hostId);
  if (results.length === 0) return [];
  return harnessAdapterDescriptorsFromVerify(results);
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
