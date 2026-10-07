import { beforeEach, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { discoverProjectCli } from './cli-discovery.js';

const db = vi.hoisted(() => ({ getPrimaryHost: vi.fn(), getEnvironment: vi.fn(), listHosts: vi.fn(() => []) }));
vi.mock('@zana-ai/zcc-db', () => db);
const primary = '958f6398-7da4-4bf7-a061-3bed9eae981a', remote = 'be0f67f4-fbba-4f32-bf32-d33f54f445f5';
const environmentId = '24e7c7d0-4c65-42ac-9e39-346c8f5b69ce';
beforeEach(() => { vi.clearAllMocks(); db.getPrimaryHost.mockReturnValue({ id: primary }); db.getEnvironment.mockReturnValue(undefined); });
function fixture() {
  const project = { id: 'p', path: '/primary', hostId: primary, sources: [{ id: 's', hostId: remote, path: '/secondary' }] };
  const rpc = vi.fn(async (): Promise<unknown> => ({ query: 'version', version: '1.2.3' }));
  const ready = vi.fn();
  const ctx = { toProjects: () => [project], config: { getConfig: () => ({}) }, hostHub: {
    resolveHostId: (id: string) => id, ensureHostSessionReady: ready, callHostOnlineRpc: rpc
  } } as unknown as ProductHttpContext;
  const request = { projectId: 'p', profile: 'opencode', query: 'version', nativeAgentDiscoveryEnabled: true };
  return { project, rpc, ready, ctx, request, run: (patch: object = {}, deadline = Date.now() + 60_000) => discoverProjectCli(ctx, { ...request, ...patch }, deadline) };
}
it('routes to a registered source and never reads the same local path', async () => {
  const f = fixture();
  expect(await f.run({ hostId: remote })).toEqual({ query: 'version', version: '1.2.3' });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith({ hostId: remote, timeoutMs: 18_000, command: {
    type: 'provider.cli_discovery', root: '/secondary', cwd: '/secondary', profile: 'opencode', query: 'version', nativeAgentDiscoveryEnabled: true
  } });
  await f.run(); expect(f.rpc).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: primary }));
  delete (f.project as { hostId?: string }).hostId;
  await f.run(); expect(f.rpc).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: primary }));
});
it('uses only an authorized ready environment and sends cwd for daemon confinement', async () => {
  const f = fixture();
  const env = { projectId: 'p', hostId: remote, path: '/worktree', status: 'ready' };
  for (const value of [undefined, { ...env, projectId: 'other' }, { ...env, hostId: primary }, { ...env, status: 'destroying' }, { ...env, path: null }]) {
    db.getEnvironment.mockReturnValue(value);
    await expect(f.run({ hostId: remote, environmentId })).rejects.toThrow('environment');
  }
  expect(f.rpc).not.toHaveBeenCalled();
  db.getEnvironment.mockReturnValue(env);
  await f.run({ hostId: remote, environmentId, cwd: '/worktree/src' });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: expect.objectContaining({ root: '/worktree', cwd: '/worktree/src' }) }));
});
it('rejects unregistered identities, unbound SSH, extra properties, offline hosts and expired requests', async () => {
  const f = fixture();
  for (const patch of [{ projectId: 'missing' }, { hostId: environmentId }, { root: '/private' }, { profile: 'invalid' }]) {
    await expect(f.run(patch)).rejects.toThrow();
  }
  await expect(f.run({}, Date.now() - 1)).rejects.toThrow('timed out');
  f.ready.mockImplementationOnce(() => { throw new Error('offline'); }); await expect(f.run()).rejects.toThrow('offline');
  Object.assign(f.project, { hostId: undefined, remote: { host: 'ssh' } }); await expect(f.run()).rejects.toThrow('remote host');
  expect(f.rpc).not.toHaveBeenCalled();
});
it('uses the bound SSH daemon and registered remote root regardless of the local placeholder', async () => {
  const f = fixture();
  Object.assign(f.project, { hostId: remote, remote: { host: 'ssh-box', remotePath: '/remote-checkout' } });
  await f.run();
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hostId: remote, command: expect.objectContaining({
    root: '/remote-checkout', cwd: '/remote-checkout'
  }) }));
  await f.run({ hostId: remote, cwd: '/remote-checkout/src' });
  expect(f.rpc).toHaveBeenLastCalledWith(expect.objectContaining({ command: expect.objectContaining({ cwd: '/remote-checkout/src' }) }));
  f.rpc.mockClear();
  await expect(f.run({ hostId: primary })).rejects.toThrow('remote host');
  await expect(f.run({ environmentId })).rejects.toThrow('remote host');
  expect(f.rpc).not.toHaveBeenCalled();
});
it('resolves remote HOME from the daemon and rejects a remote root changed during discovery', async () => {
  const f = fixture();
  const ssh = { host: 'ssh-box', remotePath: undefined as string | undefined };
  Object.assign(f.project, { hostId: remote, remote: ssh });
  f.rpc.mockImplementation(async (args?: any) => args?.command.type === 'host.browse_directory'
    ? { directory: '/remote-home' } : { query: 'version', version: '1.2.3' });
  await f.run();
  expect(f.rpc).toHaveBeenCalledWith(expect.objectContaining({ hostId: remote, command: expect.objectContaining({
    type: 'provider.cli_discovery', root: '/remote-home', cwd: '/remote-home'
  }) }));
  ssh.remotePath = '/first';
  f.rpc.mockImplementationOnce(async () => { ssh.remotePath = '/changed'; return { query: 'version' }; });
  await expect(f.run()).rejects.toThrow('changed');
});
it('rejects invalid, mismatched and late replies and revalidates a source mutated in place', async () => {
  const f = fixture();
  f.rpc.mockResolvedValueOnce({ query: 'models', models: [] }); await expect(f.run()).rejects.toThrow('match');
  f.rpc.mockResolvedValueOnce({ query: 'version', token: 'secret' }); await expect(f.run()).rejects.toThrow();
  f.rpc.mockRejectedValueOnce(new Error('lost host')); await expect(f.run()).rejects.toThrow('lost host');
  f.rpc.mockImplementationOnce(async () => {
    f.project.sources[0]!.path = '/replaced'; return { query: 'version', version: '1.2.3' };
  });
  await expect(f.run({ hostId: remote })).rejects.toThrow('changed');
  const now = Date.now(); const time = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    f.rpc.mockImplementationOnce(async () => { time.mockReturnValue(now + 1000); return { query: 'version' }; });
    await expect(f.run({}, now + 500)).rejects.toThrow('timed out');
  } finally { time.mockRestore(); }
});
it('serializes probes per host and fences an owner changed while queued', async () => {
  const f = fixture(); let finish!: (value: unknown) => void;
  f.rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = f.run({ hostId: remote }); await vi.waitFor(() => expect(f.rpc).toHaveBeenCalledTimes(1));
  const second = f.run({ hostId: remote });
  await f.run(); expect(f.rpc).toHaveBeenCalledTimes(2);
  f.project.sources[0]!.path = '/new-checkout'; finish({ query: 'version' });
  await expect(first).rejects.toThrow('changed'); await expect(second).rejects.toThrow('changed');
  expect(f.rpc).toHaveBeenCalledTimes(2);
  await f.run({ hostId: remote }); expect(f.rpc).toHaveBeenCalledTimes(3);
});
