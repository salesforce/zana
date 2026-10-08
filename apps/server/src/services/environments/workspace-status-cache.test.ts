import { describe, expect, it, vi } from 'vitest';
import {
  cachedWorkspaceStatus,
  createWorkspaceStatusCache,
  WORKSPACE_STATUS_TTL_MS,
  workspaceStatusCacheFor
} from './workspace-status-cache.js';

const key = { hostId: 'host-1', workspacePath: '/repo', workspaceProvisionType: 'unmanaged' as const };

function setup() {
  let clock = 0;
  const cache = createWorkspaceStatusCache({ now: () => clock, ttlMs: 1_000, maxEntries: 2 });
  return { cache, advance: (ms: number) => { clock += ms; } };
}

describe('workspace status cache', () => {
  it('joins concurrent callers and reuses a success within the TTL', async () => {
    const { cache, advance } = setup();
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((res) => { resolve = res; }));
    const first = cache.get(key, load);
    const second = cache.get(key, load);
    resolve('status');
    await expect(Promise.all([first, second])).resolves.toEqual(['status', 'status']);
    advance(999);
    await expect(cache.get(key, load)).resolves.toBe('status');
    expect(load).toHaveBeenCalledTimes(1);
    advance(1);
    load.mockResolvedValueOnce('next');
    await expect(cache.get(key, load)).resolves.toBe('next');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not reuse failures', async () => {
    const { cache } = setup();
    const load = vi.fn().mockRejectedValueOnce(new Error('host offline')).mockResolvedValueOnce('ok');
    await expect(cache.get(key, load)).rejects.toThrow('host offline');
    await expect(cache.get(key, load)).resolves.toBe('ok');
  });

  it('keys by host, path and provision type', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 'x');
    await cache.get(key, load);
    await cache.get({ ...key, hostId: 'host-2' }, load);
    await cache.get(key, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidates every provision type for a checkout, and only that checkout', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 'x');
    await cache.get(key, load);
    await cache.get({ ...key, workspacePath: '/repo-2' }, load);
    cache.invalidate('host-1', '/repo');
    await cache.get(key, load);
    await cache.get({ ...key, workspacePath: '/repo-2' }, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('ignores the outcome of a request that was invalidated mid-flight', async () => {
    const { cache } = setup();
    let resolveOld!: (value: string) => void;
    let rejectOld!: (error: Error) => void;
    const old = cache.get(key, () => new Promise<string>((res) => { resolveOld = res; }));
    cache.invalidate('host-1', '/repo');
    const fresh = cache.get(key, async () => 'fresh');
    resolveOld('old');
    await expect(old).resolves.toBe('old');
    await expect(fresh).resolves.toBe('fresh');
    await expect(cache.get(key, async () => 'unused')).resolves.toBe('fresh');

    cache.invalidate('host-1', '/repo');
    const failing = cache.get(key, () => new Promise<string>((_res, rej) => { rejectOld = rej; }));
    cache.invalidate('host-1', '/repo');
    const replacement = cache.get(key, async () => 'replacement');
    rejectOld(new Error('late failure'));
    await expect(failing).rejects.toThrow('late failure');
    await expect(replacement).resolves.toBe('replacement');
    await expect(cache.get(key, async () => 'unused')).resolves.toBe('replacement');
  });

  it('evicts the oldest entry beyond the cap', async () => {
    const { cache } = setup();
    const load = vi.fn(async () => 'x');
    await cache.get({ ...key, workspacePath: '/a' }, load);
    await cache.get({ ...key, workspacePath: '/b' }, load);
    await cache.get({ ...key, workspacePath: '/c' }, load);
    await cache.get({ ...key, workspacePath: '/a' }, load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('shares one cache per host hub and issues the workspace.status RPC', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ isGitRepo: true }));
    const ctx = { hostHub: { callHostOnlineRpc } } as never;
    expect(workspaceStatusCacheFor(ctx)).toBe(workspaceStatusCacheFor(ctx));
    expect(workspaceStatusCacheFor({ hostHub: { callHostOnlineRpc } } as never)).not.toBe(workspaceStatusCacheFor(ctx));
    await Promise.all([cachedWorkspaceStatus(ctx, key), cachedWorkspaceStatus(ctx, key)]);
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: { type: 'workspace.status', workspacePath: '/repo', workspaceProvisionType: 'unmanaged' }
    });
    expect(WORKSPACE_STATUS_TTL_MS).toBeGreaterThan(0);
  });
});
