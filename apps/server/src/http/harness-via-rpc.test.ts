import { describe, expect, it, vi } from 'vitest';
import { harnessAgentDescriptors } from './harness-via-rpc.js';

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
