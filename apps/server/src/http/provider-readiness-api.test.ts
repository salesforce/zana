import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertHost } from '@zana-ai/zcc-db';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { startProviderSignIn } from './provider-readiness-api.js';

let server: ProductServer, root: string, hostId: string, remoteId: string;
let unregister: () => void;
let health: unknown;
let instance = 'first';
let startError = false, stopError = false;
let rpc: ReturnType<typeof vi.spyOn>;
const response = (status = 'unauthenticated') => ({ supported: true, health: { status, loginCommand: 'fixture login --device', localLoginCommand: 'fixture login', secret: 'never-public' } });
const url = (suffix: string) => `${server.url}api/v1/system/providers/auth-fixture/${suffix}`;
const signIn = (body: unknown = { hostId }) => fetch(url('sign-in'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-auth-api-')));
  writeFileSync(join(root, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir: root, origins: { serverPort: 0, devAppPort: 5173 } });
  hostId = upsertHost(server.ctx.db, { name: 'Local', hostKeyHash: 'a'.repeat(64), isPrimary: true, homeDir: root }).id;
  remoteId = upsertHost(server.ctx.db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false, homeDir: '/remote/home' }).id;
  unregister = registerThreadProvider('test-auth', { id: 'auth-fixture', displayName: 'Auth fixture', visibility: 'installed', capabilities: { supportsServiceTier: false, fork: 'none', supportsManualCompaction: false, supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] } }).unregister;
  server.ctx.pluginHostArtifacts.set('test-auth', { path: '/fixture/host.js', digest: 'a'.repeat(64), byteLength: 1, generation: 'g1' });
  instance = 'first'; startError = false; stopError = false; health = response();
  vi.spyOn(server.ctx.hostHub, 'resolveHostId').mockImplementation((id) => id ?? hostId);
  vi.spyOn(server.ctx.hostHub, 'ensureHostSessionReady').mockImplementation(() => ({ instanceId: instance }) as never);
  rpc = vi.spyOn(server.ctx.hostHub, 'callHostOnlineRpc').mockImplementation(async ({ command }) => {
    if (command.type === 'provider.health') return health;
    if (command.type === 'terminal.start') { if (startError) throw new Error('start failed'); return { pid: 123 }; }
    if (command.type === 'terminal.stop') { if (stopError) throw new Error('stop failed'); return {}; }
    throw new Error('unexpected command');
  });
});
afterEach(async () => { unregister(); await server.close(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });

describe('provider readiness HTTP', () => {
  it('uses enrolled host context, strips unknown credential fields, and preserves the Origin guard', async () => {
    const result = await fetch(url(`health?hostId=${remoteId}`));
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ hostId: remoteId, providerId: 'auth-fixture', result: { health: { status: 'unauthenticated' } } });
    expect(JSON.stringify(body)).not.toContain('never-public');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ hostId: remoteId, command: expect.objectContaining({ type: 'provider.health', cwd: '/remote/home' }) }));
    expect((await fetch(url('health'), { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });
  it('rejects unknown providers/hosts and invalid provider responses', async () => {
    expect((await fetch(`${server.url}api/v1/system/providers/missing/health`)).status).toBe(404);
    expect((await fetch(url('health?hostId=missing'))).status).toBe(403);
    health = { supported: true, health: { status: 'invented', loginCommand: null } };
    expect((await fetch(url('health'))).status).toBe(502);
    rpc.mockRejectedValue(Object.assign(new Error('old daemon'), { code: 'unknown_command' }));
    expect(await (await fetch(url('health'))).json()).toMatchObject({ result: { supported: false } });
  });
  it.each(['ready', 'unknown', 'not_installed', 'unsupported_version'])('never starts login when status is %s', async (status) => {
    health = response(status);
    expect((await signIn()).status).toBe(409);
    expect(rpc.mock.calls.every(([input]) => input.command.type !== 'terminal.start')).toBe(true);
  });
  it('does not allow renderer commands, paths, environment, or unsupported/external auth', async () => {
    for (const patch of [{ command: 'unsafe' }, { cwd: '/arbitrary' }, { env: {} }, { localBrowser: 'yes' }]) expect((await signIn({ hostId, ...patch })).status).toBe(400);
    health = { supported: false };
    expect((await signIn()).status).toBe(409);
    health = { supported: true, health: { status: 'expired', loginCommand: null } };
    expect((await signIn()).status).toBe(409);
    expect(server.ctx.terminalSessions.size).toBe(0);
  });
  it('starts exactly one owned terminal, deduplicates concurrent requests, and keeps commands on the selected host', async () => {
    const [a, b] = await Promise.all([signIn({ hostId, localBrowser: true }), signIn({ hostId, localBrowser: true })]);
    expect(a.status, await a.clone().text()).toBe(201); expect(b.status).toBe(201);
    const first = await a.json(), second = await b.json();
    expect(first.value.id).toBe(second.value.id);
    expect(first.value).toMatchObject({ providerSignIn: { providerId: 'auth-fixture' }, status: 'running', hostId });
    expect(rpc.mock.calls.filter(([input]) => input.command.type === 'terminal.start')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ hostId, command: expect.objectContaining({ type: 'terminal.start', root, cwd: root, command: 'fixture login' }) }));
    const remote = await signIn({ hostId: remoteId, localBrowser: true });
    expect(remote.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ hostId: remoteId, command: expect.objectContaining({ command: 'fixture login --device', cwd: '/remote/home' }) }));
    const closed = await fetch(`${server.url}api/v1/terminals/${first.value.id}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(closed.status).toBe(200);
  });
  it('fails closed if the machine changes while health is in flight', async () => {
    rpc.mockImplementation(async () => { instance = 'second'; return response(); });
    expect((await signIn()).status).toBe(409);
    expect(server.ctx.terminalSessions.size).toBe(0);
  });
  it('does not launch without enrolled home evidence', async () => {
    upsertHost(server.ctx.db, { id: hostId, name: 'Local', hostKeyHash: 'a'.repeat(64), homeDir: null });
    expect((await signIn()).status).toBe(409);
  });
  it('bounds simultaneous pending sign-in starts before any process is launched', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    rpc.mockImplementation(async ({ command }) => {
      if (command.type === 'provider.health') { await gate; return response(); }
      return { pid: 123 };
    });
    const hosts = Array.from({ length: 5 }, (_, index) => upsertHost(server.ctx.db, { name: `Bounded-${index}`, hostKeyHash: String(index).repeat(64), homeDir: root }).id);
    const pending = hosts.slice(0, 4).map((id) => startProviderSignIn(server.ctx, 'auth-fixture', id, false));
    await expect(startProviderSignIn(server.ctx, 'auth-fixture', hosts[4]!, false)).rejects.toMatchObject({ status: 429 });
    release(); await Promise.all(pending);
  });
  it.each([false, true])('retains process ownership after a failed start, even if stop also fails (%s)', async (failStop) => {
    startError = true; stopError = failStop;
    expect((await signIn()).status).toBeGreaterThanOrEqual(500);
    const [record] = [...server.ctx.terminalSessions.values()];
    expect(record?.status).toBe(failStop ? 'starting' : 'exited');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ hostId, command: { type: 'terminal.stop', sessionId: record!.id } }));
  });
});
