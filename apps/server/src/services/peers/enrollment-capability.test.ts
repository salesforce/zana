import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { openDatabase, upsertHost, getHost } from '@zana-ai/zcc-db';
import { createHostHub } from '../../http/host-hub.js';
import { createProductHub } from '../../http/product-hub.js';
import { handleHostInternalHttp } from '../../http/host-internal.js';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { createProductHttpContext, type ProductHttpContext } from '../../http/product-context.js';
import { hashHostKey } from '../../http/host-hub.js';

const roots: string[] = [], cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function root() { const dir = mkdtempSync(join(tmpdir(), 'enrollment-capability-')); roots.push(dir); return dir; }

it('persists narrow enrollment across restart and never upgrades it on credential repair', () => {
  const file = join(root(), 'zcc.sqlite'), db = openDatabase(file);
  expect(upsertHost(db, { id: 'full', name: 'Full', hostKeyHash: '0'.repeat(64) }).enrollmentCapability).toBe('execution');
  upsertHost(db, { id: 'scoped', name: 'Scoped', hostKeyHash: '1'.repeat(64), enrollmentCapability: 'peer.forward', isPrimary: false });
  db.close(); const reopened = openDatabase(file); cleanup.push(() => reopened.close());
  expect(getHost(reopened, 'scoped')?.enrollmentCapability).toBe('peer.forward');
  expect(upsertHost(reopened, { id: 'scoped', name: 'Repair', hostKeyHash: '2'.repeat(64) }).enrollmentCapability).toBe('peer.forward');
  expect(() => upsertHost(reopened, { name: 'Invalid', hostKeyHash: '0'.repeat(64), enrollmentCapability: 'all' as never })).toThrow('invalid host enrollment capability');
});

it('host hub rejects thread, terminal, filesystem and plugin execution before socket dispatch', async () => {
  const db = openDatabase(join(root(), 'zcc.sqlite')), hub = createHostHub(db, createProductHub());
  cleanup.push(() => { hub.close(); db.close(); });
  upsertHost(db, { id: 'scoped', name: 'Scoped', hostKeyHash: '1'.repeat(64), enrollmentCapability: 'peer.forward' });
  for (const type of ['thread.start', 'term.create', 'host.read_file', 'plugin.host.call']) {
    await expect(hub.callHostOnlineRpc({ hostId: 'scoped', command: { type } as never })).rejects.toThrow('does not authorize command');
  }
  await expect(hub.callHostOnlineRpc({ hostId: 'missing', command: { type: 'peer.forward' } as never })).rejects.toThrow('does not authorize command');
  await expect(hub.callHostOnlineRpc({ hostId: 'scoped', command: { type: 'peer.forward' } as never })).rejects.toThrow('not connected');
});

it('forward-only hello receives no plugin artifacts and execution events detach its session', async () => {
  const db = openDatabase(join(root(), 'zcc.sqlite')), hub = createHostHub(db, createProductHub(), new Map(), { pluginHostGenerations: () => [{ pluginId: 'test-plugin', generation: 'g' }] });
  cleanup.push(() => { hub.close(); db.close(); });
  const hostId = '11111111-1111-4111-8111-111111111111', instanceId = '22222222-2222-4222-8222-222222222222';
  upsertHost(db, { id: hostId, name: 'Scoped', hostKeyHash: '1'.repeat(64), enrollmentCapability: 'peer.forward' });
  const sent: string[] = [], socket = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, send: (text: string) => sent.push(text), close() {} });
  expect(hub.acceptHello(socket as never, hostId, { type: 'host.hello', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId })).toBe(true);
  expect(JSON.parse(sent[0]!).pluginHostGenerations).toEqual([]);
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId, runtime: { threads: [], loadedEnvironments: [] } })));
  expect(hub.connectedHostIds()).toEqual([hostId]);
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId, events: [{ kind: 'terminal.output', terminalId: instanceId, payload: { data: 'denied' } }] })));
  expect(hub.connectedHostIds()).toEqual([]);
});

it('all host internal execution endpoints reject narrow credentials', async () => {
  const dir = root(), ctx: ProductHttpContext = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } });
  cleanup.push(() => { ctx.dispose(); ctx.hostHub.close(); ctx.db.close(); });
  const key = 'k'.repeat(64);
  upsertHost(ctx.db, { id: 'scoped', name: 'Scoped', hostKeyHash: hashHostKey(key), enrollmentCapability: 'peer.forward' });
  const server = createServer(async (req, res) => { if (!await handleHostInternalHttp(req, res, ctx)) res.writeHead(404).end(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    for (const path of ['tool-call', 'interactive-request', 'cli-callback']) {
      const response = await fetch(`http://127.0.0.1:${port}/internal/hosts/${path}`, { method: 'POST', headers: {
        authorization: `Bearer ${key}`, 'x-zcc-host-id': 'scoped', 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'host enrollment does not authorize execution' });
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
