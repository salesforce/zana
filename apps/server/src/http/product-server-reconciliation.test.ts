import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, updateHostSshIdentity, upsertHost } from '@zana-ai/zcc-db';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';
import { hashHostKey } from './host-hub.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | undefined;
let context: ProductHttpContext | undefined;
const dirs: string[] = [];
const sockets: WebSocket[] = [];
const key = 'reconciliation-test-host-key-with-enough-bytes';
const remoteProject = (dir: string, hostId?: string) => ({
  id: 'remote', name: 'Remote', path: join(dir, 'placeholder'), hostId,
  remote: { host: 'devbox', user: 'me', remotePath: '/srv/project' }, createdAt: 1, lastActiveAt: 1
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-project-reconciliation-'));
  dirs.push(dir);
  return dir;
}
function host(ctx: Pick<ProductHttpContext, 'db'>, id: string) {
  upsertHost(ctx.db, { id, name: id, isPrimary: false, hostKeyHash: hashHostKey(key) });
  updateHostSshIdentity(ctx.db, id, { host: 'devbox', user: 'me' });
}
async function connect(id: string) {
  const url = new URL('internal/hosts/ws', server!.url); url.protocol = 'ws:';
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${key}`, 'x-zcc-host-id': id } });
  sockets.push(socket);
  await once(socket, 'open');
  const hello = once(socket, 'message');
  const instanceId = randomUUID();
  socket.send(JSON.stringify({ type: 'host.hello', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: id, instanceId }));
  await hello;
  const ready = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: id, instanceId,
    runtime: { threads: [], loadedEnvironments: [] } }));
  await ready;
  return socket;
}
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close(); server = undefined;
  if (context) {
    context.hostHub.close(); await context.dispose(); context.db.close(); context = undefined;
  }
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('remote projects bind without GET', () => {
  it('backfills persisted projects to offline hosts once context is ready', async () => {
    const dir = fixture();
    const db = openDatabase(join(dir, 'zcc.sqlite'));
    host({ db }, 'offline'); db.close();
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [remoteProject(dir)] }));
    context = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } });
    const emit = vi.spyOn(context.hub, 'emit');
    await vi.waitFor(() => expect(context!.projects.list()[0]).toMatchObject({ hostId: 'offline', remote: { remotePath: '/srv/project' } }));
    expect(emit.mock.calls.filter(([event]) => event === 'projects:changed')).toHaveLength(1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(emit.mock.calls.filter(([event]) => event === 'projects:changed')).toHaveLength(1);
  });

  it('GET never binds or writes even when a matching host appears after startup', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [remoteProject(dir)] }));
    server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 } });
    await server.ctx.remoteProjectReconciler!.request();
    host(server.ctx, 'offline');
    const before = readFileSync(join(dir, 'projects.json'), 'utf8');
    const bind = vi.spyOn(server.ctx.projects, 'bindToHost');
    const response = await fetch(`${server.url}api/v1/projects`);
    expect(response.status).toBe(200);
    expect(bind).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, 'projects.json'), 'utf8')).toBe(before);
  });

  it.each(['POST', 'PATCH'])('project %s triggers eventual binding without a read', async method => {
    const dir = fixture();
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [remoteProject(dir)] }));
    server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 } });
    await server.ctx.remoteProjectReconciler!.request();
    host(server.ctx, 'offline');
    const response = await fetch(`${server.url}api/v1/projects${method === 'PATCH' ? '/remote' : ''}`, {
      method, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(method === 'PATCH' ? { name: 'Renamed' } : { path: dir })
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(server!.ctx.projects.list().find(p => p.id === 'remote')?.hostId).toBe('offline'));
  });

  it('connect and reconnect prefer connected twins without GET', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: [remoteProject(dir)] }));
    server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 } });
    await server.ctx.remoteProjectReconciler!.request();
    const connected = randomUUID();
    host(server.ctx, 'offline'); host(server.ctx, connected);
    const first = await connect(connected);
    await vi.waitFor(() => expect(server!.ctx.projects.list()[0]?.hostId).toBe(connected));
    first.close(); await once(first, 'close');
    await vi.waitFor(() => expect(server!.ctx.hostHub.connectedHostIds()).not.toContain(connected));
    await server.ctx.projects.bindToHost('remote', { hostId: 'offline', path: '/srv/project' });
    await connect(connected);
    await vi.waitFor(() => expect(server!.ctx.projects.list()[0]?.hostId).toBe(connected));
  });
});
