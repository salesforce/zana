import { describe, expect, it, vi } from 'vitest';
import { packRpcArgs } from '../../lib/rpc.js';
import { createPluginPanelHost, openSafeExternal, setBadgeRefresh, sharedPanelCache } from './adapter.js';

describe('openSafeExternal', () => {
  it('opens only http(s) URLs', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    openSafeExternal('https://github.com/acme/app/pull/1');
    openSafeExternal('javascript:alert(1)');
    openSafeExternal('not a url');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://github.com/acme/app/pull/1', '_blank', 'noopener,noreferrer');
    vi.unstubAllGlobals();
  });
});

describe('createPluginPanelHost', () => {
  it('packs RPC args and writes through storage/cache/toast/inbox', async () => {
    const calls: Array<{ pluginId: string; method: string; args: unknown }> = [];
    const toast = vi.fn();
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', {
      callRpc: async (pluginId: string, method: string, args?: unknown) => {
        calls.push({ pluginId, method, args });
        if (method === 'listProjects') return [{ id: 'p1', name: 'Alpha' }];
        if (method === 'storageGet') return { badgeMode: 'total' };
        if (method === 'pushInbox') return { id: 'inb' };
        return { ok: true };
      }
    });
    vi.stubGlobal('__ZCC_PLUGIN_RUNTIME__', { toast });
    const host = createPluginPanelHost('pr-monitor');
    await host.call('assignProject', 'https://github.com/a/b/pull/1', 'p1');
    expect(calls.some((c) => c.method === 'assignProject' && Array.isArray(c.args))).toBe(true);
    expect(packRpcArgs(['a', 'b'])).toEqual(['a', 'b']);
    host.cache.set('k', 1);
    expect(sharedPanelCache().get('k')).toBe(1);
    host.cache.delete?.('k');
    expect(sharedPanelCache().get('k')).toBeUndefined();
    const refreshed = vi.fn();
    setBadgeRefresh(refreshed);
    host.cache.refreshBadge?.();
    expect(refreshed).toHaveBeenCalled();
    host.toast('hi', 'info');
    expect(toast).toHaveBeenCalledWith('hi', 'info');
    await expect(host.pushInbox({ comments: 'x', projectId: 'p1' })).resolves.toEqual({ id: 'inb' });
    await expect(host.storage.get('settings')).resolves.toEqual({ badgeMode: 'total' });
    await host.storage.set('settings', { badgeMode: 'unread' });
    await Promise.resolve();
    expect(host.listProjects()).toEqual([{ id: 'p1', name: 'Alpha' }]);
    vi.unstubAllGlobals();
  });
});
