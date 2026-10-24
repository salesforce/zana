import { afterEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('./fetch-with-app-surface.js', () => ({ fetchWithAppSurface: vi.fn(), apiJson }));

import { peerLinks } from './product-client.js';

describe('peerLinks client', () => {
  afterEach(() => apiJson.mockReset());

  it('lists links', async () => {
    apiJson.mockResolvedValue({ links: [] });
    await expect(peerLinks.list()).resolves.toEqual({ links: [] });
    expect(apiJson).toHaveBeenCalledWith('/peer-links');
  });

  it('removes a use with and without scope, encoding ids', async () => {
    apiJson.mockResolvedValue({ ok: true });
    await peerLinks.removeUse('h/1', 'p 2');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h%2F1/uses/p%202', { method: 'DELETE' });
    await peerLinks.removeUse('h', 'p', 's&1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h/uses/p?scope=s%261', { method: 'DELETE' });
  });

  it('removes, disconnects and reconnects a link', async () => {
    apiJson.mockResolvedValue({ ok: true });
    await peerLinks.removeLink('a b');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/a%20b', { method: 'DELETE' });
    await peerLinks.removeLink('a b', { force: true });
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/a%20b?force=1', { method: 'DELETE' });
    await peerLinks.activity('h/1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h%2F1/activity');
    await peerLinks.disconnect('h');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h/disconnect', { method: 'POST' });
    await peerLinks.reconnect('h');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h/reconnect', { method: 'POST' });
    await peerLinks.repair('h/1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/h%2F1/repair', { method: 'POST' });
  });

  it('lists and forgets leftover access, encoding the computer id', async () => {
    apiJson.mockResolvedValue({ leftovers: [] });
    await expect(peerLinks.leftovers()).resolves.toEqual({ leftovers: [] });
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/leftover');
    await peerLinks.forgetLeftover('c/1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-links/leftover/c%2F1/forget', { method: 'POST' });
  });

  it('propagates failures', async () => {
    apiJson.mockRejectedValue(new Error('403'));
    await expect(peerLinks.disconnect('h')).rejects.toThrow('403');
  });
});
