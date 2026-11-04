import { describe, expect, it, vi } from 'vitest';
import { harnessAgentDescriptors, harnessDescriptors } from './harness-via-rpc.js';

describe('harnessAgentDescriptors', () => {
  const project = {
    id: 'project-1', name: 'Project', path: '/workspace/project', createdAt: 0, lastActiveAt: 0, hostId: 'host-1'
  };

  it('rejects unknown, remote, and invalid profiles before host discovery', async () => {
    const callHostOnlineRpc = vi.fn();
    const hub = { resolveHostId: vi.fn(), callHostOnlineRpc } as any;
    await expect(harnessAgentDescriptors({ hub, project: undefined, profile: 'opencode', refresh: false })).resolves.toEqual({ status: 'failure' });
    await expect(harnessAgentDescriptors({ hub, project: { ...project, remote: { host: 'remote' } }, profile: 'opencode', refresh: false })).resolves.toEqual({ status: 'failure' });
    await expect(harnessAgentDescriptors({ hub, project, profile: 'unknown' as any, refresh: false })).resolves.toEqual({ status: 'failure' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('uses registered project path and assigned host, never caller path', async () => {
    const hub = {
      resolveHostId: vi.fn().mockReturnValue('host-1'),
      callHostOnlineRpc: vi.fn().mockResolvedValue({ status: 'success', descriptors: [{ id: 'build', label: 'Build', directLaunchAllowed: true, mode: 'primary', hidden: false }] })
    } as any;
    await expect(harnessAgentDescriptors({ hub, project, profile: 'opencode', refresh: true })).resolves.toMatchObject({ status: 'success' });
    expect(hub.resolveHostId).toHaveBeenCalledWith('host-1');
    expect(hub.callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: { type: 'provider.agent_descriptors', cwd: '/workspace/project', profile: 'opencode', refresh: true }
    });
  });
});

describe('model discovery availability', () => {
  it('coalesces simultaneous probes per host and refreshes after completion', async () => {
    const { harnessVerifyBundle } = await import('./harness-via-rpc.js');
    let release!: (value: { providers: []; extraInstalledAgents: { providerId: string; installed: boolean }[] }) => void;
    const callHostOnlineRpc = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const hub = { resolveHostId: (id: string) => id, callHostOnlineRpc } as any;
    const one = harnessVerifyBundle(hub, 'one');
    const duplicate = harnessVerifyBundle(hub, 'one');
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    release({ providers: [], extraInstalledAgents: [{ providerId: 'extra', installed: true }] });
    expect(await one).toEqual({ availability: [], extraInstalled: { extra: true } });
    await duplicate;
    callHostOnlineRpc.mockResolvedValue({ providers: [] });
    await harnessVerifyBundle(hub, 'one');
    await harnessVerifyBundle(hub, 'two');
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(3);
  });

  it('propagates offline hosts, keeps legacy verification semantics, and retries failed probes', async () => {
    const { harnessVerify, harnessVerifyBundle } = await import('./harness-via-rpc.js');
    const { HostUnavailableError } = await import('./host-hub.js');
    const hub = { resolveHostId: () => 'one', callHostOnlineRpc: vi.fn().mockRejectedValue(new HostUnavailableError()) } as any;
    await expect(harnessVerifyBundle(hub)).rejects.toBeInstanceOf(HostUnavailableError);
    expect(await harnessVerify(hub)).toEqual([]);
    hub.callHostOnlineRpc.mockResolvedValue({ providers: [] });
    expect(await harnessVerifyBundle(hub)).toEqual({ availability: [], extraInstalled: {} });
  });
});


describe('harnessDescriptors live model inventory', () => {
  it('uses the selected execution host inventory without a vendor snapshot', async () => {
    const hub = { resolveHostId: vi.fn().mockReturnValue('remote-host'),
      callHostOnlineRpc: vi.fn().mockResolvedValue({ providers: [{ family: 'opencode', label: 'OpenCode',
        binary: '/remote/bin/opencode', enabled: true, installed: true, alwaysEnabled: false, installHint: 'install' }],
        modelInventories: [{ family: 'opencode', models: ['remote-provider/installed-model'] }] }) } as any;
    const descriptors = await harnessDescriptors(hub, 'remote-host');
    expect(hub.callHostOnlineRpc).toHaveBeenCalledWith({ hostId: 'remote-host',
      command: { type: 'provider.status', includeModelInventory: true } });
    expect(descriptors.find(row => row.id === 'opencode')?.targets?.models).toMatchObject([
      { id: 'remote-provider/installed-model', provider: 'remote-provider' }
    ]);
  });

  it('returns no descriptors for an unavailable host or empty availability', async () => {
    const { HostUnavailableError } = await import('./host-hub.js');
    const hub = { resolveHostId: () => 'missing', callHostOnlineRpc: vi.fn().mockRejectedValue(new HostUnavailableError()) } as any;
    expect(await harnessDescriptors(hub)).toEqual([]);
    hub.callHostOnlineRpc.mockResolvedValue({ providers: [] });
    expect(await harnessDescriptors(hub)).toEqual([]);
  });
});
