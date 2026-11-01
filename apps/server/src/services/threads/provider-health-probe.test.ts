import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostHub } from '../../http/host-hub.js';
import type { ProviderHealthResult } from '@zana-ai/zcc-contracts/host-rpc';
import { registerThreadProvider } from './thread-provider-catalog.js';
import {
  installedFromHealthResult,
  isUnknownProviderHealthCommand,
  mergeHealthIntoExtraInstalled,
  probeInstalledProviderHealth
} from './provider-health-probe.js';

const FIXTURE_ID = 'acp-health-fixture';

const capabilities = {
  supportsServiceTier: false,
  fork: 'tip' as const,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  permissionModes: ['full' as const]
};

const artifacts = {
  get: () => ({
    path: '/tmp/provider-acp-host.js',
    byteLength: 2048,
    digest: 'ab'.repeat(32),
    generation: '1'
  })
};

function healthResult(
  status: 'ready' | 'not_installed' | 'unauthenticated'
): ProviderHealthResult {
  return {
    supported: true,
    health: {
      status,
      statusMessage: null,
      accountEmail: null,
      planLabel: null,
      installedVersion: null,
      minimumSupportedVersion: null,
      canInstall: false,
      canUpdate: false,
      loginCommand: null
    }
  };
}

function hub(callHostOnlineRpc: HostHub['callHostOnlineRpc'], resolveHostId?: HostHub['resolveHostId']): HostHub {
  return {
    resolveHostId: resolveHostId ?? (() => 'host-1'),
    callHostOnlineRpc
  } as HostHub;
}

describe('installedFromHealthResult', () => {
  it('treats ready and unauthenticated as installed, not_installed as missing, and a noop as unknown', () => {
    expect(installedFromHealthResult(healthResult('ready'))).toBe(true);
    expect(installedFromHealthResult(healthResult('unauthenticated'))).toBe(true);
    expect(installedFromHealthResult(healthResult('not_installed'))).toBe(false);
    expect(installedFromHealthResult({ supported: false })).toBeNull();
  });
});

describe('isUnknownProviderHealthCommand', () => {
  it('recognizes older daemons that do not implement provider.health', () => {
    expect(isUnknownProviderHealthCommand({ code: 'unknown_command' })).toBe(true);
    expect(isUnknownProviderHealthCommand({ code: 'unsupported' })).toBe(true);
    expect(isUnknownProviderHealthCommand({ code: 'timeout' })).toBe(false);
    expect(isUnknownProviderHealthCommand(new Error('offline'))).toBe(false);
  });
});

describe('probeInstalledProviderHealth', () => {
  const handles: Array<{ unregister(): void }> = [];

  afterEach(() => {
    for (const handle of handles) handle.unregister();
    handles.length = 0;
  });

  it('lets a new host-effective command probe finish while the previous native command is still pending', async () => {
    handles.push(registerThreadProvider('provider-acp', { id: FIXTURE_ID, displayName: 'Fixture', visibility: 'installed', capabilities }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let nativeCommand = '/host/old-wrapper';
    const seen: string[] = [];
    const call = vi.fn(async () => {
      // The target host resolves its own native settings after the coordinator
      // forwards the same static provider declaration on each request.
      const effectiveCommand = nativeCommand;
      seen.push(effectiveCommand);
      if (effectiveCommand === '/host/old-wrapper') await gate;
      return healthResult(effectiveCommand === '/host/old-wrapper' ? 'not_installed' : 'ready');
    });
    const input = { hub: hub(call), artifacts };
    const first = probeInstalledProviderHealth(input);
    nativeCommand = '/host/repaired-wrapper';
    const current = probeInstalledProviderHealth(input);
    expect(seen).toEqual(['/host/old-wrapper', '/host/repaired-wrapper']);
    expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
    expect(await current).toEqual({ [FIXTURE_ID]: true });
    release();
    expect(await first).toEqual({ [FIXTURE_ID]: false });
    await probeInstalledProviderHealth(input);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('does not resolve or contact a host when no installed providers are registered', async () => {
    const call = vi.fn();
    const resolve = vi.fn();
    expect(await probeInstalledProviderHealth({ hub: hub(call, resolve), artifacts })).toEqual({});
    expect(resolve).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it('returns an empty map when the host cannot be resolved', async () => {
    handles.push(registerThreadProvider('provider-acp', {
      id: FIXTURE_ID, displayName: 'Fixture', visibility: 'installed', capabilities
    }));
    const result = await probeInstalledProviderHealth({
      hub: hub(async () => {
        throw new Error('should not call');
      }, () => {
        throw new Error('no host');
      }),
      artifacts
    });
    expect(result).toEqual({});
  });

  it('keeps healthy provider results when another probe fails and retries the failed provider later', async () => {
    const otherId = 'other-health-fixture';
    for (const id of [FIXTURE_ID, otherId]) {
      handles.push(registerThreadProvider('provider-acp', {
        id, displayName: id, visibility: 'installed', capabilities
      }));
    }
    let fail = true;
    const call = vi.fn(async (input: Parameters<HostHub['callHostOnlineRpc']>[0]) => {
      const command = input.command as { providerId: string };
      if (fail && command.providerId === FIXTURE_ID) throw new Error('host probe timed out');
      return healthResult('ready');
    });
    const input = { hub: hub(call), artifacts };
    expect(await probeInstalledProviderHealth(input)).toEqual({ [otherId]: true });
    fail = false;
    expect(await probeInstalledProviderHealth(input)).toEqual({ [FIXTURE_ID]: true, [otherId]: true });
    expect(call).toHaveBeenCalledTimes(4);
  });

  it('skips broken plugins so their unavailable bridges cannot fail healthy installation probes', async () => {
    handles.push(registerThreadProvider('broken-plugin', {
      id: 'broken-health-fixture', displayName: 'Broken', visibility: 'installed', capabilities
    }, null, 'host build failed'));
    handles.push(registerThreadProvider('provider-acp', {
      id: FIXTURE_ID, displayName: 'Healthy', visibility: 'installed', capabilities
    }));
    const call = vi.fn(async () => healthResult('ready'));
    const result = await probeInstalledProviderHealth({ hub: hub(call), artifacts });
    expect(result).toEqual({ [FIXTURE_ID]: true });
    expect(call).toHaveBeenCalledOnce();
  });

  it('falls back to an empty map when the daemon does not know provider.health', async () => {
    handles.push(registerThreadProvider('provider-acp', {
      id: FIXTURE_ID,
      displayName: 'Health Fixture',
      visibility: 'installed',
      capabilities
    }));
    const result = await probeInstalledProviderHealth({
      hub: hub(async () => {
        throw Object.assign(new Error('unknown command'), { code: 'unknown_command' });
      }),
      artifacts
    });
    expect(result).toEqual({});
  });

  it('records installed vs not_installed from that host', async () => {
    handles.push(registerThreadProvider('provider-acp', {
      id: FIXTURE_ID,
      displayName: 'Health Fixture',
      visibility: 'installed',
      capabilities
    }));
    const result = await probeInstalledProviderHealth({
      hub: hub(async (input) => {
        const command = input.command as { type: string; providerId: string };
        expect(command.type).toBe('provider.health');
        if (command.providerId === FIXTURE_ID) return healthResult('not_installed');
        return healthResult('ready');
      }),
      hostId: 'sfwork',
      artifacts
    });
    expect(result[FIXTURE_ID]).toBe(false);
  });

  it('leaves a health noop unset so family or extra-ACP probes can still offer the provider', async () => {
    handles.push(registerThreadProvider('provider-acp', {
      id: FIXTURE_ID,
      displayName: 'Health Fixture',
      visibility: 'installed',
      capabilities
    }));
    const result = await probeInstalledProviderHealth({
      hub: hub(async (input) => {
        const command = input.command as { providerId: string };
        if (command.providerId === FIXTURE_ID) return { supported: false };
        return healthResult('ready');
      }),
      artifacts
    });
    expect(result[FIXTURE_ID]).toBeUndefined();
  });
});

describe('mergeHealthIntoExtraInstalled', () => {
  it('lets health confirm presence but not veto a daemon extra-ACP hit', () => {
    expect(mergeHealthIntoExtraInstalled({ 'acp-omp': true }, { 'acp-omp': false, 'acp-opencode': false }))
      .toEqual({ 'acp-omp': true, 'acp-opencode': false });
    expect(mergeHealthIntoExtraInstalled({}, { 'acp-opencode': true })).toEqual({ 'acp-opencode': true });
    expect(mergeHealthIntoExtraInstalled({ 'acp-opencode': false }, { 'acp-opencode': true }))
      .toEqual({ 'acp-opencode': true });
  });
});
