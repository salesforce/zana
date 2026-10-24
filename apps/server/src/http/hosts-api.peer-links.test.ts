import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addHostLinkUse, destroyHost, getHost, listAllHosts, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import type { PeerLinkDirectory } from '../services/hosts/peer-link-view.js';

let server: ProductServer | null = null;
let dataDir = '';

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

async function start() {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-peer-links-api-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({
    dataDir,
    enrollToken: 'enroll-token-enroll-token-enroll',
    origins: { serverPort: 0, devAppPort: 5173 }
  });
  return server;
}

function seed(s: ProductServer) {
  const db = s.ctx.db;
  const exec = upsertHost(db, { name: 'laptop', hostKeyHash: 'exec-key', isPrimary: true });
  const link = upsertHost(db, { name: 'Zana peer link: Ada (sync only)', hostKeyHash: 'link-key', enrollmentCapability: 'peer.forward' });
  addHostLinkUse(db, link.id, { pluginId: 'plug-a', scope: 'repo-1', label: 'Plug A' });
  addHostLinkUse(db, link.id, { pluginId: 'plug-b', scope: 'repo-2', label: 'Plug B' });
  return { exec, link };
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const url = (path: string) => `${server!.url}api/v1${path}`;

describe('GET /api/v1/peer-links', () => {
  it('lists plugin links with uses and never the execution host', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    const body = await fetch(url('/peer-links')).then(r => r.json()) as { links: Array<Record<string, unknown>> };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({
      hostId: link.id,
      peerInstanceId: null,
      peerName: 'Zana peer link: Ada (sync only)',
      state: 'linked',
      connected: false
    });
    expect(body.links[0]!.uses).toEqual([
      expect.objectContaining({ pluginId: 'plug-a', label: 'Plug A', scope: 'repo-1' }),
      expect.objectContaining({ pluginId: 'plug-b', label: 'Plug B', scope: 'repo-2' })
    ]);
    expect(JSON.stringify(body)).not.toContain(exec.id);
    expect(JSON.stringify(body)).not.toContain('link-key');
  });

  it('marks a use-less forward host unclaimed so it can be removed', async () => {
    const s = await start();
    upsertHost(s.ctx.db, { name: 'laptop', hostKeyHash: 'a', isPrimary: true });
    upsertHost(s.ctx.db, { name: 'orphan', hostKeyHash: 'b', enrollmentCapability: 'peer.forward' });
    const body = await fetch(url('/peer-links')).then(r => r.json()) as { links: Array<{ state: string; uses: unknown[] }> };
    expect(body.links).toEqual([expect.objectContaining({ state: 'unclaimed', uses: [] })]);
  });

  it('prefers the owner-store directory for peer identity, state and a bounded reason', async () => {
    const s = await start();
    const { link } = seed(s);
    const directory: PeerLinkDirectory = {
      describe: id => id === link.id
        ? { peerInstanceId: 'inst-ada', peerName: 'Ada', state: 'failed', reason: 'x'.repeat(500) }
        : undefined
    };
    s.ctx.peerLinkDirectory = directory;
    const body = await fetch(url('/peer-links')).then(r => r.json()) as { links: Array<Record<string, any>> };
    expect(body.links[0]).toMatchObject({ peerInstanceId: 'inst-ada', peerName: 'Ada', state: 'failed' });
    expect(body.links[0]!.reason).toHaveLength(200);
  });

  it('refuses requests the mobile proxy marked', async () => {
    const s = await start();
    seed(s);
    for (const [method, path] of [['GET', '/peer-links'], ['DELETE', '/peer-links/x'], ['DELETE', '/peer-links/x/uses/y']] as const) {
      const response = await fetch(url(path), { method, headers: { ...JSON_HEADERS, 'x-zcc-app-surface': 'mobile' } });
      expect(response.status).toBe(403);
    }
  });

  it('refuses the mobile proxy on every other peer pairing gesture', async () => {
    const s = await start();
    const decide = vi.spyOn(s.ctx.peerAuthority, 'decideIntroduction');
    for (const path of ['/peers/introductions/intro-1/decision', '/hosts/forward-join-codes']) {
      const response = await fetch(url(path), { method: 'POST', headers: { ...JSON_HEADERS, 'x-zcc-app-surface': 'mobile' }, body: JSON.stringify({ decision: 'approved' }) });
      expect(response.status).toBe(403);
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it('exposes only allowlisted introduction decision errors', async () => {
    const s = await start();
    const decide = vi.spyOn(s.ctx.peerAuthority, 'decideIntroduction');
    const post = () => fetch(url('/peers/introductions/intro-1/decision'), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'approved' }) });
    decide.mockRejectedValueOnce(new Error('introduction already decided'));
    expect(await post().then(async r => [r.status, await r.json()])).toEqual([409, { error: 'introduction already decided' }]);
    decide.mockRejectedValueOnce(new Error('ENOENT: /secret/path/peer-pairs.json'));
    expect(await post().then(async r => [r.status, await r.json()])).toEqual([409, { error: 'introduction unavailable' }]);
  });

  it('logs a failed post-approval enrollment without failing the decision', async () => {
    const s = await start();
    vi.spyOn(s.ctx.peerAuthority, 'decideIntroduction').mockResolvedValue({ status: 'approved', introductionId: 'intro-1' } as never);
    s.ctx.peerInstaller = { enroll: vi.fn(async () => { throw new Error('enroll boom'); }), dispose: vi.fn(), whenIdle: vi.fn(async () => undefined) } as never;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await fetch(url('/peers/introductions/intro-1/decision'), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ decision: 'approved' }) });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('intro-1: enroll boom')));
    warn.mockRestore();
  });

  it('404s unknown peer-link paths and unsupported methods', async () => {
    await start();
    expect((await fetch(url('/peer-links/a/b/c/d'))).status).toBe(404);
    expect((await fetch(url('/peer-links/abc'))).status).toBe(404);
  });
});

describe('plugin links stay out of execution surfaces', () => {
  it('GET /hosts omits the link and machine routes 404 on it', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    const hosts = await fetch(url('/hosts')).then(r => r.json()) as Array<{ id: string }>;
    expect(hosts.map(h => h.id)).toEqual([exec.id]);
    expect((await fetch(url(`/hosts/${link.id}`))).status).toBe(404);
    expect((await fetch(url(`/hosts/${link.id}/directory`))).status).toBe(404);
    expect((await fetch(url(`/hosts/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS })).status).toBe(404);
    const ceiling = await fetch(url(`/hosts/${link.id}/permission-ceiling`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxPermissionMode: 'auto' })
    });
    expect(ceiling.status).toBe(404);
    expect(getHost(s.ctx.db, link.id)?.maxPermissionMode).toBe('full');
  });
});

describe('DELETE peer-link uses', () => {
  it('removes one scope, then the whole plugin; the link stays with zero uses', async () => {
    const s = await start();
    const { link } = seed(s);
    const first = await fetch(url(`/peer-links/${link.id}/uses/plug-a?scope=repo-1`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, linkRemoved: false });
    const last = await fetch(url(`/peer-links/${link.id}/uses/plug-b`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(await last.json()).toEqual({ ok: true, linkRemoved: false });
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeFalsy();
    expect(listAllHosts(s.ctx.db).map(h => h.id)).toContain(link.id);
  });

  it('404s an unknown host, an execution host, an unknown plugin and a wrong scope', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    for (const path of [
      '/peer-links/nope/uses/plug-a',
      `/peer-links/${exec.id}/uses/plug-a`,
      `/peer-links/${link.id}/uses/ghost`,
      `/peer-links/${link.id}/uses/plug-a?scope=other`
    ]) {
      expect((await fetch(url(path), { method: 'DELETE', headers: JSON_HEADERS })).status).toBe(404);
    }
    expect(getHost(s.ctx.db, exec.id)?.destroyedAt).toBeNull();
    expect(getHost(s.ctx.db, link.id)?.purpose).toMatchObject({ uses: [{}, {}] });
  });

  it('rejects an invalid scope query', async () => {
    const s = await start();
    const { link } = seed(s);
    const response = await fetch(url(`/peer-links/${link.id}/uses/plug-a?scope=`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(response.status).toBe(400);
  });

  it('delegates to the owner store and reports its outcome', async () => {
    const s = await start();
    const { link } = seed(s);
    const release = vi.fn(async () => ({ linkRemoved: false }));
    s.ctx.peerLinkDirectory = { describe: () => undefined, release };
    const response = await fetch(url(`/peer-links/${link.id}/uses/plug-a?scope=repo-1`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(await response.json()).toEqual({ ok: true, linkRemoved: false });
    expect(release).toHaveBeenCalledWith(link.id, 'plug-a', 'repo-1');
    // Core did not touch uses itself: the owner store is the writer.
    expect(getHost(s.ctx.db, link.id)?.purpose).toMatchObject({ uses: [{}, {}] });
  });

  it('falls back to core removal when the owner store does not claim the host', async () => {
    const s = await start();
    const { link } = seed(s);
    s.ctx.peerLinkDirectory = { describe: () => undefined, release: async () => undefined };
    await fetch(url(`/peer-links/${link.id}/uses/plug-a`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(getHost(s.ctx.db, link.id)?.purpose).toMatchObject({ uses: [{ pluginId: 'plug-b' }] });
  });

  it('answers 503 and keeps the link when the owner store fails', async () => {
    const s = await start();
    const { link } = seed(s);
    s.ctx.peerLinkDirectory = { describe: () => undefined, release: async () => { throw new Error('boom'); } };
    const response = await fetch(url(`/peer-links/${link.id}/uses/plug-a`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(response.status).toBe(503);
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeNull();
  });
});

describe('POST peer-link repair', () => {
  const post = (path: string) => fetch(url(path), { method: 'POST', headers: JSON_HEADERS });

  it('delegates to the owner store repair, distinct from resume', async () => {
    const s = await start();
    const { link } = seed(s);
    const repair = vi.fn(async () => ({ repaired: true as const }));
    const resume = vi.fn(async () => ({ paused: false as const }));
    s.ctx.peerLinkDirectory = { describe: () => undefined, repair, resume };
    const response = await post(`/peer-links/${link.id}/repair`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(repair).toHaveBeenCalledWith(link.id);
    expect(resume).not.toHaveBeenCalled();
  });

  it('404s an unknown host, an execution host and an unclaimed link; 503s on failure', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    s.ctx.peerLinkDirectory = { describe: () => undefined, repair: async () => undefined };
    for (const path of ['/peer-links/nope/repair', `/peer-links/${exec.id}/repair`, `/peer-links/${link.id}/repair`]) {
      expect((await post(path)).status).toBe(404);
    }
    s.ctx.peerLinkDirectory = undefined;
    expect((await post(`/peer-links/${link.id}/repair`)).status).toBe(404);
    s.ctx.peerLinkDirectory = { describe: () => undefined, repair: async () => { throw new Error('boom'); } };
    expect((await post(`/peer-links/${link.id}/repair`)).status).toBe(503);
  });

  it('refuses the mobile proxy', async () => {
    const s = await start();
    const { link } = seed(s);
    const response = await fetch(url(`/peer-links/${link.id}/repair`), { method: 'POST', headers: { ...JSON_HEADERS, 'x-zcc-app-surface': 'mobile' } });
    expect(response.status).toBe(403);
  });
});

describe('POST peer-link disconnect / reconnect', () => {
  const post = (path: string) => fetch(url(path), { method: 'POST', headers: JSON_HEADERS });

  it('delegates to the owner store and reports the paused flag', async () => {
    const s = await start();
    const { link } = seed(s);
    const pause = vi.fn(async () => ({ paused: true as const }));
    const resume = vi.fn(async () => ({ paused: false as const }));
    s.ctx.peerLinkDirectory = { describe: () => undefined, pause, resume };
    const down = await post(`/peer-links/${link.id}/disconnect`);
    expect(down.status).toBe(200);
    expect(await down.json()).toEqual({ ok: true, paused: true });
    expect(await (await post(`/peer-links/${link.id}/reconnect`)).json()).toEqual({ ok: true, paused: false });
    expect(pause).toHaveBeenCalledWith(link.id);
    expect(resume).toHaveBeenCalledWith(link.id);
    // The record survives either way.
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeNull();
  });

  it('404s an unknown host, an execution host, a destroyed link and a link no owner store claims', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    const pause = vi.fn(async () => ({ paused: true as const }));
    s.ctx.peerLinkDirectory = { describe: () => undefined, pause, resume: async () => undefined };
    for (const path of ['/peer-links/nope/disconnect', `/peer-links/${exec.id}/disconnect`, `/peer-links/${exec.id}/reconnect`, `/peer-links/${link.id}/reconnect`]) {
      expect((await post(path)).status).toBe(404);
    }
    expect(pause).not.toHaveBeenCalled();
    s.ctx.peerLinkDirectory = undefined;
    expect((await post(`/peer-links/${link.id}/disconnect`)).status).toBe(404);
    destroyHost(s.ctx.db, link.id);
    expect((await post(`/peer-links/${link.id}/disconnect`)).status).toBe(404);
  });

  it('answers 503 when the owner store fails', async () => {
    const s = await start();
    const { link } = seed(s);
    s.ctx.peerLinkDirectory = { describe: () => undefined, pause: async () => { throw new Error('boom'); }, resume: async () => { throw new Error('boom'); } };
    expect((await post(`/peer-links/${link.id}/disconnect`)).status).toBe(503);
    expect((await post(`/peer-links/${link.id}/reconnect`)).status).toBe(503);
  });

  it('refuses the mobile proxy and lists the paused flag', async () => {
    const s = await start();
    const { link } = seed(s);
    const response = await fetch(url(`/peer-links/${link.id}/disconnect`), { method: 'POST', headers: { ...JSON_HEADERS, 'x-zcc-app-surface': 'mobile' } });
    expect(response.status).toBe(403);
    s.ctx.peerLinkDirectory = { describe: () => ({ peerInstanceId: 'inst', peerName: 'Ada', state: 'linked', paused: true }) };
    const body = await fetch(url('/peer-links')).then(r => r.json()) as { links: Array<Record<string, unknown>> };
    expect(body.links[0]).toMatchObject({ paused: true });
  });
});

describe('DELETE peer-link', () => {
  it('removes the link and its uses, tearing down the session', async () => {
    const s = await start();
    const { link } = seed(s);
    const invalidate = vi.spyOn(s.ctx.joinCodes, 'invalidateHost');
    const detach = vi.spyOn(s.ctx.hostHub, 'detach');
    const response = await fetch(url(`/peer-links/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(await response.json()).toEqual({ ok: true, linkRemoved: true });
    expect(invalidate).toHaveBeenCalledWith(link.id);
    expect(detach).toHaveBeenCalledWith(link.id, 'removed');
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).not.toBeNull();
    const body = await fetch(url('/peer-links')).then(r => r.json()) as { links: unknown[] };
    expect(body.links).toEqual([]);
  });

  it('delegates to the owner store when it claims the link', async () => {
    const s = await start();
    const { link } = seed(s);
    const remove = vi.fn(async () => ({ linkRemoved: true as const }));
    s.ctx.peerLinkDirectory = { describe: () => undefined, remove };
    expect((await fetch(url(`/peer-links/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS })).status).toBe(200);
    expect(remove).toHaveBeenCalledWith(link.id);
  });

  it('refuses to remove an execution host or a destroyed link', async () => {
    const s = await start();
    const { exec, link } = seed(s);
    expect((await fetch(url(`/peer-links/${exec.id}`), { method: 'DELETE', headers: JSON_HEADERS })).status).toBe(404);
    destroyHost(s.ctx.db, link.id);
    expect((await fetch(url(`/peer-links/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS })).status).toBe(404);
    expect(getHost(s.ctx.db, exec.id)?.destroyedAt).toBeNull();
  });

  it('answers 503, logs, and keeps the link when the owner store removal fails', async () => {
    const s = await start();
    const { link } = seed(s);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    s.ctx.peerLinkDirectory = { describe: () => undefined, remove: async () => { throw new Error('revoke failed'); } };
    const response = await fetch(url(`/peer-links/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`remove failed for host ${link.id}: revoke failed`));
    warn.mockRestore();
    expect(getHost(s.ctx.db, link.id)?.destroyedAt).toBeNull();
  });
});

describe('plugin link state notes', () => {
  const directory = (id: string): PeerLinkDirectory => ({
    describe: host => host === id ? { peerInstanceId: 'inst-ada', peerName: 'Ada', state: 'linked' } : undefined
  });
  const list = async () => (await fetch(url('/peer-links')).then(r => r.json()) as { links: Array<{ uses: Array<Record<string, any>> }> }).links[0]!.uses;

  it('attaches a plugin note to exactly that plugin and scope use', async () => {
    const s = await start();
    const { link } = seed(s);
    s.ctx.peerLinkDirectory = directory(link.id);
    s.ctx.peerLinkNotes!.set('plug-a', 'inst-ada', 'repo-1', { state: 'attention', label: 'Sync not set up', detail: 'why' });
    s.ctx.peerLinkNotes!.set('plug-b', 'inst-ada', 'other-scope', { state: 'ok', label: 'Stale scope' });
    const uses = await list();
    expect(uses.find(u => u.pluginId === 'plug-a')!.note).toEqual({ state: 'attention', label: 'Sync not set up', detail: 'why' });
    expect(uses.find(u => u.pluginId === 'plug-b')).not.toHaveProperty('note');
    // The note for a scope no use has is dropped, not kept for a later link.
    expect(s.ctx.peerLinkNotes!.get('plug-b', 'inst-ada', 'other-scope')).toBeUndefined();
  });

  it('shows no note when no owner store names the peer', async () => {
    const s = await start();
    seed(s);
    s.ctx.peerLinkNotes!.set('plug-a', 'inst-ada', 'repo-1', { state: 'ok', label: 'x' });
    expect((await list()).every(u => !('note' in u))).toBe(true);
  });

  it('drops a use note when that use is removed, and every note when the link is removed', async () => {
    const s = await start();
    const { link } = seed(s);
    s.ctx.peerLinkDirectory = directory(link.id);
    s.ctx.peerLinkNotes!.set('plug-a', 'inst-ada', 'repo-1', { state: 'ok', label: 'a' });
    s.ctx.peerLinkNotes!.set('plug-b', 'inst-ada', 'repo-2', { state: 'ok', label: 'b' });
    await fetch(url(`/peer-links/${link.id}/uses/plug-a?scope=repo-1`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(s.ctx.peerLinkNotes!.get('plug-a', 'inst-ada', 'repo-1')).toBeUndefined();
    expect(s.ctx.peerLinkNotes!.get('plug-b', 'inst-ada', 'repo-2')).toBeDefined();
    await fetch(url(`/peer-links/${link.id}`), { method: 'DELETE', headers: JSON_HEADERS });
    expect(s.ctx.peerLinkNotes!.size).toBe(0);
  });
});
