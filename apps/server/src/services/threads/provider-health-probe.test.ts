import { afterEach, describe, expect, it } from 'vitest';
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

  it('returns an empty map when the host cannot be resolved', async () => {
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
