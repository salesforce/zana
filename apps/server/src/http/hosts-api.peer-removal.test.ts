import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addHostLinkUse, getHost, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { PeerActiveUse } from '../services/peers/peer-active-use.js';
import { PeerConnectionRegistry } from '../services/peers/peer-connections.js';
import { forgetLeftover, removePeerLink } from '../services/hosts/peer-link-view.js';

let server: ProductServer | null = null;
let dataDir = '';

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

const PEER = 'inst-ada';
const url = (path: string) => `${server!.url}api/v1${path}`;

async function start() {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-peer-removal-api-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir, enrollToken: 'enroll-token-enroll-token-enroll', origins: { serverPort: 0, devAppPort: 5173 } });
  const s = server;
  const exec = upsertHost(s.ctx.db, { name: 'laptop', hostKeyHash: 'exec-key', isPrimary: true });
  const link = upsertHost(s.ctx.db, { name: 'Ada', hostKeyHash: 'link-key', enrollmentCapability: 'peer.forward' });
  addHostLinkUse(s.ctx.db, link.id, { pluginId: 'plug-a', scope: 'repo-1', label: 'Plug A' });
  addHostLinkUse(s.ctx.db, link.id, { pluginId: 'plug-b', scope: 'repo-2', label: 'Plug B' });
  const order: string[] = [];
  const remove = vi.fn(async (_hostId: string, _options?: { hooksRan?: boolean }) => { order.push('drop'); return { linkRemoved: true as const }; });
  s.ctx.peerLinkDirectory = { describe: id => id === link.id ? { peerInstanceId: PEER, peerName: 'Ada', state: 'linked' } : undefined, remove };
  const registry = new PeerConnectionRegistry();
  s.ctx.peerConnections = registry;
  vi.spyOn(s.ctx.peerAuthority, 'activePairIds').mockImplementation(async () => { order.push('pairs'); return ['pair-1']; });
  const revoke = vi.spyOn(s.ctx.peerAuthority, 'revoke').mockImplementation(async () => { order.push('revoke'); });
  return { s, exec, link, order, remove, registry, revoke };
}

const del = (path: string) => fetch(url(path), { method: 'DELETE', headers: { 'content-type': 'application/json' } });

describe('GET /api/v1/peer-links/:hostId/activity', () => {
  it('lists a plugin as active for 10 s after its last successful call, by registry label', async () => {
    const { s, exec, link } = await start();
    let now = 1_000_000;
    s.ctx.peerActiveUse = new PeerActiveUse(() => now);
    s.ctx.peerActiveUse.recordSuccess('plug-a', PEER);
    s.ctx.peerActiveUse.recordSuccess('plug-b', 'someone-else');
    now += 9_000;
    expect(await fetch(url(`/peer-links/${link.id}/activity`)).then(r => r.json())).toEqual({ active: [{ pluginId: 'plug-a', label: 'Plug A' }] });
    now += 2_000;
    expect(await fetch(url(`/peer-links/${link.id}/activity`)).then(r => r.json())).toEqual({ active: [] });
    expect((await fetch(url(`/peer-links/${exec.id}/activity`))).status).toBe(404);
    expect((await fetch(url('/peer-links/nope/activity'))).status).toBe(404);
  });

  it('is empty for a link no owner store describes', async () => {
    const { s, link } = await start();
    s.ctx.peerLinkDirectory = { describe: () => undefined };
    s.ctx.peerActiveUse?.recordSuccess('plug-a', PEER);
    expect(await fetch(url(`/peer-links/${link.id}/activity`)).then(r => r.json())).toEqual({ active: [] });
  });
});

describe('DELETE /api/v1/peer-links/:hostId removal sequence', () => {
  it('runs plugin handlers, then revokes uses, then drops locally', async () => {
    const { s, link, order, remove, registry, revoke } = await start();
    registry.onRemoving('plug-a', async computerId => { order.push(`hook:${computerId}`); });
    s.ctx.peerActiveUse?.recordSuccess('plug-a', PEER);
    const response = await del(`/peer-links/${link.id}`);
    expect(await response.json()).toEqual({ ok: true, linkRemoved: true });
    expect(order).toEqual([`hook:${PEER}`, 'pairs', 'revoke', 'drop']);
    expect(revoke).toHaveBeenCalledWith('pair-1');
    expect(remove).toHaveBeenCalledWith(link.id, { hooksRan: true });
    expect(s.ctx.peerActiveUse?.activePlugins(PEER)).toEqual([]);
  });

  it('stops before revoke on a failed handler, names the plugin, and Retry re-runs it', async () => {
    const { s, link, order, remove, registry } = await start();
    let fail = true;
    registry.onRemoving('plug-a', async () => { order.push('hook'); if (fail) throw new Error('boom'); });
    const first = await del(`/peer-links/${link.id}`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: false, hookFailures: [{ pluginId: 'plug-a', label: 'Plug A', reason: 'error' }] });
    expect(order).toEqual(['hook']);
    expect(remove).not.toHaveBeenCalled();
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeFalsy();
    fail = false;
    expect(await del(`/peer-links/${link.id}`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(order).toEqual(['hook', 'hook', 'pairs', 'revoke', 'drop']);
    expect(registry.orphansOf('plug-a')).toEqual([]);
  });

  it('Remove anyway skips the handlers, still revokes before the drop, and records a hidden orphan', async () => {
    const { link, order, remove, registry } = await start();
    const hook = vi.fn(async () => { throw new Error('boom'); });
    registry.onRemoving('plug-a', hook);
    await del(`/peer-links/${link.id}`);
    order.length = 0;
    expect(await del(`/peer-links/${link.id}?force=1`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['pairs', 'revoke', 'drop']);
    expect(remove).toHaveBeenCalledWith(link.id, { hooksRan: true });
    expect(registry.orphansOf('plug-a')).toEqual([PEER]);
    expect(registry.orphansOf('plug-b')).toEqual([]);
  });

  it('a revoke failure never blocks the drop, and a bad force value is rejected', async () => {
    const { s, link, order } = await start();
    vi.spyOn(s.ctx.peerAuthority, 'activePairIds').mockRejectedValue(new Error('disk'));
    expect((await del(`/peer-links/${link.id}?force=yes`)).status).toBe(400);
    expect(await del(`/peer-links/${link.id}`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(order).toEqual(['drop']);
  });

  it('a link no owner store describes skips handlers and tears down generically', async () => {
    const { s, link, order, registry } = await start();
    const hook = vi.fn();
    registry.onRemoving('plug-a', hook);
    s.ctx.peerLinkDirectory = { describe: () => undefined };
    expect(await del(`/peer-links/${link.id}`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(hook).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeTruthy();
  });

  it('reports a timed-out handler by its registry name', async () => {
    const { s, link } = await start();
    const registry = s.ctx.peerConnections!;
    vi.spyOn(registry, 'runRemoving').mockResolvedValue([{ pluginId: 'plug-gone', reason: 'timeout' }]);
    s.ctx.plugins = { get: (id: string) => id === 'plug-gone' ? { name: '  Gone Plugin ' } : undefined } as never;
    expect(await removePeerLink(s.ctx, link.id)).toEqual({ status: 'hooks-failed', failures: [{ pluginId: 'plug-gone', label: 'Gone Plugin', reason: 'timeout' }] });
  });
});

describe('DELETE /api/v1/peer-links/:hostId/uses/:pluginId', () => {
  it("revokes a plugin's use once its last use on the computer is stopped, and only then", async () => {
    const { s, link } = await start();
    addHostLinkUse(s.ctx.db, link.id, { pluginId: 'plug-a', scope: 'repo-3', label: 'Plug A' });
    const revokeUse = vi.spyOn(s.ctx.peerAuthority, 'revokeUse').mockResolvedValue([]);
    const stop = vi.fn(async () => undefined);
    s.ctx.peerConnectionUses = { has: () => true, request: async () => 'approved', stop };
    s.ctx.peerActiveUse?.recordSuccess('plug-a', PEER);
    expect(await del(`/peer-links/${link.id}/uses/plug-a?scope=repo-1`).then(r => r.json())).toEqual({ ok: true, linkRemoved: false });
    expect(revokeUse).not.toHaveBeenCalled();
    expect(await del(`/peer-links/${link.id}/uses/plug-a?scope=repo-3`).then(r => r.json())).toEqual({ ok: true, linkRemoved: false });
    expect(revokeUse).toHaveBeenCalledWith('plug-a', PEER);
    expect(stop).toHaveBeenCalledWith('plug-a', PEER);
    expect(s.ctx.peerActiveUse?.isActive('plug-a', PEER)).toBe(false);
  });

  it('a slow or failing use layer never holds the stop back', async () => {
    const { s, link } = await start();
    vi.spyOn(s.ctx.peerAuthority, 'revokeUse').mockRejectedValue(new Error('disk'));
    s.ctx.peerConnectionUses = { has: () => true, request: async () => 'approved', stop: () => new Promise(() => {}) };
    expect(await del(`/peer-links/${link.id}/uses/plug-b`).then(r => r.json())).toEqual({ ok: true, linkRemoved: false });
  });
});

describe('Remove anyway in every stuck state', () => {
  it('completes with throwing handlers, a throwing authority, and a throwing directory.remove (generic fallback)', async () => {
    const { s, link, remove, registry } = await start();
    registry.onRemoving('plug-a', async () => { throw new Error('boom'); });
    registry.onRemoving('plug-b', () => new Promise<void>(() => undefined));
    await registry.runRemoving(PEER, 5);
    vi.spyOn(s.ctx.peerAuthority, 'activePairIds').mockRejectedValue(new Error('disk'));
    remove.mockRejectedValue(new Error('owner store down'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await del(`/peer-links/${link.id}?force=1`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeTruthy();
    const rec = registry.orphanRecords();
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ computerId: PEER, name: 'Ada' });
    expect(rec[0]!.failed.map(f => f.pluginId).sort()).toEqual(['plug-a', 'plug-b']);
  });

  it('a throwing revoke is swallowed under force; non-force still reports directory failure as 503', async () => {
    const { s, link, remove, registry } = await start();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(s.ctx.peerAuthority, 'revoke').mockRejectedValue(new Error('revoke'));
    remove.mockRejectedValueOnce(new Error('down'));
    expect((await del(`/peer-links/${link.id}`)).status).toBe(503);
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeFalsy();
    expect(await del(`/peer-links/${link.id}?force=1`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
    expect(registry.orphanRecords()).toEqual([]);
  });

  it('an unclaimed link (no peer instance) tears down even force-free and ignores throwing handlers', async () => {
    const { s, link, registry } = await start();
    const hook = vi.fn(async () => { throw new Error('boom'); });
    registry.onRemoving('plug-a', hook);
    s.ctx.peerLinkDirectory = { describe: () => undefined };
    for (const suffix of ['', '?force=1']) {
      const again = upsertHost(s.ctx.db, { name: `u${suffix}`, hostKeyHash: `k${suffix}`, enrollmentCapability: 'peer.forward' });
      addHostLinkUse(s.ctx.db, again.id, { pluginId: 'plug-a', scope: 's', label: 'Plug A' });
      expect(await del(`/peer-links/${again.id}${suffix}`).then(r => r.json())).toEqual({ ok: true, linkRemoved: true });
      expect(getHost(s.ctx.db, again.id)?.destroyedAt).toBeTruthy();
    }
    expect(hook).not.toHaveBeenCalled();
    expect(link.id).toBeTruthy();
  });

  it('a link whose owner store has no remove() tears down generically under force', async () => {
    const { s, link, registry } = await start();
    s.ctx.peerLinkDirectory = { describe: () => ({ peerInstanceId: PEER, peerName: 'Ada', state: 'failed' }) };
    expect(await removePeerLink(s.ctx, link.id, { force: true })).toEqual({ status: 'ok', linkRemoved: true });
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeTruthy();
    expect(registry.orphanRecords()).toEqual([]);
  });
});

describe('peer-link leftovers (GET /peer-links/leftover, POST .../forget)', () => {
  async function leftover() {
    const ctx = await start();
    ctx.registry.onRemoving('plug-a', async () => { throw new Error('boom'); });
    await ctx.registry.runRemoving(PEER);
    return ctx;
  }

  it('is empty until a force removal records one, labelled by registry name', async () => {
    const { s, link } = await leftover();
    expect(await fetch(url('/peer-links/leftover')).then(r => r.json())).toEqual({ leftovers: [] });
    s.ctx.plugins = { get: (id: string) => id === 'plug-a' ? { name: ' Plug Alpha ' } : undefined } as never;
    await del(`/peer-links/${link.id}?force=1`);
    expect(await fetch(url('/peer-links/leftover')).then(r => r.json())).toEqual({
      leftovers: [{ computerId: PEER, name: 'Ada', plugins: [{ pluginId: 'plug-a', label: 'Plug Alpha', reason: 'error' }] }]
    });
    // the list route never collides with the link routes
    expect((await fetch(url('/peer-links/leftover'), { method: 'DELETE', headers: { 'content-type': 'application/json' } })).status).toBe(404);
  });

  it('forget: 404 for unknown, happy path retries cleanup once and drops the record', async () => {
    const { s, link, registry, revoke } = await leftover();
    expect((await fetch(url(`/peer-links/leftover/${PEER}/forget`), { method: 'POST', headers: { 'content-type': 'application/json' } })).status).toBe(404);
    await del(`/peer-links/${link.id}?force=1`);
    revoke.mockClear();
    const hook = vi.fn(async () => undefined);
    registry.dispose();
    const fresh = new PeerConnectionRegistry();
    fresh.recordOrphans(PEER, [{ pluginId: 'plug-a', reason: 'error' }], 'Ada');
    fresh.onRemoving('plug-a', hook);
    s.ctx.peerConnections = fresh;
    const changed = vi.fn();
    fresh.onChange(changed);
    s.ctx.peerActiveUse?.recordSuccess('plug-a', PEER);
    const response = await fetch(url(`/peer-links/leftover/${PEER}/forget`), { method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(await response.json()).toEqual({ ok: true });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('pair-1');
    expect(fresh.orphanRecords()).toEqual([]);
    expect(changed).toHaveBeenCalled();
    expect(s.ctx.peerActiveUse?.activePlugins(PEER)).toEqual([]);
    expect((await fetch(url(`/peer-links/leftover/${PEER}/forget`), { method: 'POST', headers: { 'content-type': 'application/json' } })).status).toBe(404);
  });

  it('forget drops the record even when the retry still fails or authority throws', async () => {
    const { s, link, registry } = await leftover();
    await del(`/peer-links/${link.id}?force=1`);
    vi.spyOn(s.ctx.peerAuthority, 'activePairIds').mockRejectedValue(new Error('disk'));
    expect(await forgetLeftover(s.ctx, PEER)).toEqual({ status: 'ok' });
    expect(registry.orphanRecords()).toEqual([]);
    expect(registry.failuresFor(PEER)).toEqual([]);
  });

  it('forget survives a registry whose runRemoving rejects', async () => {
    const { s, link, registry } = await leftover();
    await del(`/peer-links/${link.id}?force=1`);
    vi.spyOn(registry, 'runRemoving').mockRejectedValue(new Error('x'));
    expect(await forgetLeftover(s.ctx, PEER)).toEqual({ status: 'ok' });
    expect(registry.hasOrphan(PEER)).toBe(false);
  });

  it('forgetLeftover is not-found without a registry', async () => {
    const { s } = await start();
    s.ctx.peerConnections = undefined;
    expect(await forgetLeftover(s.ctx, PEER)).toEqual({ status: 'not-found' });
  });
});
