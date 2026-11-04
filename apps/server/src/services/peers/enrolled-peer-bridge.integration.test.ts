import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from '../../http/product-server.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from '@zana-ai/zcc-host-daemon/server-connection';
import { createCommandRuntime } from '@zana-ai/zcc-host-daemon/command-dispatch';
import { destroyHost, getHost, upsertHost } from '@zana-ai/zcc-db';
import { controlKey, sealControl, openControl } from './peer-control-protocol.js';
import { channelHash } from './enrolled-peer-channels.js';
import { unsealPeerBytes } from './peer-auth.js';
import { readFile } from 'node:fs/promises';

const roots: string[] = [], servers: ProductServer[] = [], connections: EnrolledHostConnection[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function app(dataDir?: string, key = randomBytes(32)) {
  const dir = dataDir ?? await realpath(await mkdtemp(join(tmpdir(), 'peer-real-app-'))); if (!dataDir) roots.push(dir);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key } }); servers.push(server);
  return { server, dir, key };
}
async function enroll(owner: Awaited<ReturnType<typeof app>>, local: Awaited<ReturnType<typeof app>>) {
  const issued = owner.server.ctx.joinCodes.mint();
  const id = issued.hostId;
  const response = await fetch(`${owner.server.url}internal/hosts/enroll`, { method: 'POST', headers: {
    authorization: `Bearer ${issued.joinCode}`, 'content-type': 'application/json' },
    body: JSON.stringify({ protocolVersion: (await import('@zana-ai/zcc-contracts/host-rpc')).HOST_RPC_PROTOCOL_VERSION,
      hostId: id, hostName: 'Test machine', instanceId: randomUUID() }) });
  expect(response.status).toBe(201);
  const credentials = await response.json() as { hostId: string; hostKey: string };
  const runtime = createCommandRuntime({ dataDir: local.dir, emit() {}, loadConfig: () => ({}) });
  const connection = startEnrolledHostConnection({ serverUrl: owner.server.url, ...credentials,
    dataDir: local.dir, localPeerAppDataDir: local.dir, runtime }); connections.push(connection); await connection.ready;
  await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId)).not.toBeNull());
  return credentials;
}
function proposal(a: Awaited<ReturnType<typeof app>>, b: Awaited<ReturnType<typeof app>>, hostId: string) {
  return { pairId: randomUUID(), proposalId: randomUUID(), localInstanceId: a.server.ctx.productInstanceId,
    remoteInstanceId: b.server.ctx.productInstanceId, targetHostId: hostId, pluginId: 'test-plugin', scope: 'opaque-scope', epoch: 1 };
}

it.each(['recovery', 'registration'])('server close drains delayed %s before root removal without rm retry', async mode => {
  const local = await app();
  await local.server.ctx.peerAuthority.recover();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let work: Promise<unknown>;
  if (mode === 'recovery') {
    await local.server.ctx.peerAuthority.revoke('absent');
    const original = local.server.ctx.peerPairs.revoke.bind(local.server.ctx.peerPairs);
    vi.spyOn(local.server.ctx.peerPairs, 'revoke').mockImplementationOnce(async id => {
      entered(); await held; return original(id);
    });
    work = local.server.ctx.peerAuthority.recover().catch(() => undefined);
  } else {
    const original = local.server.ctx.peerChannels.register.bind(local.server.ctx.peerChannels);
    vi.spyOn(local.server.ctx.peerChannels, 'register').mockImplementationOnce(async channel => {
      entered(); await held; return original(channel);
    });
    const { createCipheriv } = await import('node:crypto');
    const key = createHash('sha256').update(local.server.ctx.enrollToken).digest(), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`/api/v1/peer-channel-register:${local.server.ctx.productInstanceId}`));
    const bytes = Buffer.concat([cipher.update(JSON.stringify({ remoteInstanceId: randomUUID(), hostId: randomUUID(),
      hostKey: randomBytes(32).toString('base64url'), capability: 'execution' })), cipher.final()]);
    const sealed = Buffer.concat([Buffer.from('ZCP2'), iv, cipher.getAuthTag(), bytes]).toString('base64url');
    key.fill(0);
    work = fetch(`${local.server.url}api/v1/peer-channel-register`, { method: 'POST', body: JSON.stringify({ sealed }) }).catch(() => undefined);
  }
  await started;
  let closed = false;
  const closing = local.server.close().then(() => { closed = true; });
  try {
    await new Promise(resolve => setTimeout(resolve, 25)); expect(closed).toBe(false);
    expect(getHost(local.server.ctx.db, randomUUID())).toBeNull(); // DB stays live until handlers drain.
  } finally { release(); await closing; await work; }
  servers.splice(servers.indexOf(local.server), 1);
  await rm(local.dir, { recursive: true });
  roots.splice(roots.indexOf(local.dir), 1);
  await local.server.close();
  await new Promise(resolve => setTimeout(resolve, 25));
  await expect(access(local.dir)).rejects.toMatchObject({ code: 'ENOENT' });
  vi.restoreAllMocks();
});
async function lifecycle(server: ProductServer, operation: string, proposal: ReturnType<typeof proposal>) {
  const { localInstanceId: _local, ...wire } = proposal;
  return fetch(`${server.url}api/v1/peer-links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, proposal: wire }) });
}

it('three real apps mutually enroll, activate via production HTTP/daemon bridge, survive restart and revoke remotely', async () => {
  const a = await app(), b = await app(), c = await app();
  const ab = await enroll(a, b);
  const pairAB = proposal(a, b, ab.hostId);
  expect((await lifecycle(a.server, 'activate', pairAB)).status).toBe(409);
  const ba = await enroll(b, a), bc = await enroll(b, c), cb = await enroll(c, b);
  expect((await lifecycle(a.server, 'propose', pairAB)).status).toBe(200);
  expect((await lifecycle(a.server, 'activate', pairAB)).status).toBe(200);
  const pairBC = proposal(b, c, bc.hostId);
  expect((await lifecycle(b.server, 'activate', pairBC)).status).toBe(200);
  expect(await b.server.ctx.peerPairs.grant(pairAB.pairId)).toMatchObject({ targetHostId: ba.hostId, remoteInstanceId: a.server.ctx.productInstanceId });
  expect(await c.server.ctx.peerPairs.grant(pairBC.pairId)).toMatchObject({ targetHostId: cb.hostId });
  // Real plugin route proves canonical v2 transport above the historical 8192-byte truncation boundary.
  const dispatchPeer = vi.fn(async (_plugin: string, _method: string, request: { body: unknown }) => request.body);
  b.server.ctx.plugins = { dispatchPeer, stop() {} } as never;
  const body = JSON.stringify({ text: 'x'.repeat(24_000) }), envelope = (await a.server.ctx.peerPairs.signRequest(pairAB.pairId,
    { pluginId: pairAB.pluginId, scope: pairAB.scope, method: 'echo', body: Buffer.from(body) }))!;
  connections[0]!.runtime.peerForwarder = new (await import('@zana-ai/zcc-host-daemon/peer-forward')).PeerForwarder({
    resolveLocalPeerApp: (await import('@zana-ai/zcc-host-daemon/peer-forward')).createStoredLocalPeerAppResolver(b.dir) });
  const echoed = await a.server.ctx.hostHub.callHostOnlineRpc<{ status: number; body: string }>({ hostId: ab.hostId,
    command: { type: 'peer.forward', ...envelope, method: 'echo', body, timeoutMs: 10_000 } });
  expect(echoed.status).toBe(200); expect(JSON.parse(echoed.body).result.text).toHaveLength(24_000);
  await b.server.close(); servers.splice(servers.indexOf(b.server), 1);
  const restarted = await app(b.dir, b.key); expect(restarted.server.ctx.productInstanceId).toBe(b.server.ctx.productInstanceId);
  const reconnect = startEnrolledHostConnection({ serverUrl: restarted.server.url, ...ba, dataDir: a.dir, localPeerAppDataDir: a.dir,
    runtime: createCommandRuntime({ dataDir: a.dir, emit() {}, loadConfig: () => ({}) }) }); connections.push(reconnect); await reconnect.ready;
  expect(await restarted.server.ctx.peerPairs.grant(pairAB.pairId)).not.toBeNull();
  await a.server.ctx.peerAuthority.revoke(pairAB.pairId); await a.server.ctx.peerAuthority.recover();
  expect(await restarted.server.ctx.peerPairs.grant(pairAB.pairId)).toBeNull();
  expect(await c.server.ctx.peerPairs.grant(pairBC.pairId)).not.toBeNull();
}, 60_000);

it('real paired app survives startup key outage and transient reverse-registry key outage without reset', async () => {
  const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
  const pair = proposal(a, b, ab.hostId); expect((await lifecycle(a.server, 'activate', pair)).status).toBe(200);
  await b.server.close(); servers.splice(servers.indexOf(b.server), 1);
  let available = false;
  const getKey = vi.fn(async () => available ? b.key : null);
  const server = await startProductServer({ dataDir: b.dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey } }); servers.push(server);
  await expect(server.ctx.peerAuthority.recover()).rejects.toThrow('encryption key');
  available = true;
  const reconnect = startEnrolledHostConnection({ serverUrl: server.url, ...ba, dataDir: a.dir, localPeerAppDataDir: a.dir,
    runtime: createCommandRuntime({ dataDir: a.dir, emit() {}, loadConfig: () => ({}) }) }); connections.push(reconnect); await reconnect.ready;
  await server.ctx.peerAuthority.recover();
  expect(await server.ctx.peerPairs.grant(pair.pairId)).not.toBeNull();
  getKey.mockResolvedValueOnce(null);
  await expect(server.ctx.peerPairs.signRequest(pair.pairId, { pluginId: pair.pluginId, scope: pair.scope, method: 'echo', body: Buffer.from('{}') })).rejects.toThrow('encryption key');
  expect(await server.ctx.peerPairs.grant(pair.pairId)).not.toBeNull();
  // First authority snapshot succeeds; second read (reverse registry) loses OS key.
  getKey.mockResolvedValueOnce(b.key).mockResolvedValueOnce(null);
  await expect(server.ctx.peerAuthority.recover()).rejects.toThrow('encryption key');
  await server.ctx.peerAuthority.recover();
  expect(await server.ctx.peerPairs.grant(pair.pairId)).not.toBeNull();
  const body = Buffer.from('{}'), packet = (await a.server.ctx.peerPairs.signRequest(pair.pairId,
    { pluginId: pair.pluginId, scope: pair.scope, method: 'echo', body }))!;
  const lease = await server.ctx.peerPairs.authenticateRequest({ envelope: packet, body, pluginId: pair.pluginId,
    scope: pair.scope, route: packet.route, httpMethod: 'POST' });
  expect(lease).not.toBeNull(); lease?.release();
}, 60_000);

it('authenticated core packets reject replay, wrong recipient/host, capability revocation and cross-pair revoke', async () => {
  const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
  const pair = proposal(a, b, ab.hostId); expect((await lifecycle(a.server, 'activate', pair)).status).toBe(200);
  const channel = (await a.server.ctx.peerChannels.remote(b.server.ctx.productInstanceId))!, host = getHost(a.server.ctx.db, ab.hostId)!;
  const key = controlKey(host.hostKeyHash, channelHash(channel));
  const packet = sealControl({ operation: 'proof', nonce: 'c'.repeat(48) }, { senderId: a.server.ctx.productInstanceId,
    recipientId: b.server.ctx.productInstanceId, senderHostId: ba.hostId, recipientHostId: ab.hostId }, key);
  const post = (input: unknown, headers = {}) => fetch(`${b.server.url}api/v1/peer-control`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) });
  expect((await post({ ...packet, recipientId: randomUUID() })).status).toBe(403);
  expect((await post({ ...packet, senderHostId: randomUUID() })).status).toBe(403);
  expect((await post(packet, { origin: 'http://evil.test' })).status).toBe(403);
  expect((await post(packet, { 'sec-fetch-site': 'same-origin' })).status).toBe(403);
  expect((await post({ ...packet, issuedAt: Date.now() - 60_001 })).status).toBe(403);
  expect((await post({ ...packet, issuedAt: Date.now() + 11_000 })).status).toBe(403);
  expect((await post({ ...packet, sealed: 'x'.repeat(43) })).status).toBe(403);
  const success = await post(packet); expect(success.status).toBe(200);
  expect(openControl(await success.json(), key, true)).toHaveProperty('sealedProof');
  expect((await post(packet)).status).toBe(403);
  const registration = `${b.server.url}api/v1/peer-channel-register`;
  for (const bad of [{}, { sealed: '+' }, { sealed: 'a'.repeat(8193) }, { sealed: 'a'.repeat(43), extra: true }]) {
    expect((await fetch(registration, { method: 'POST', body: JSON.stringify(bad) })).status).toBe(403);
  }
  expect((await fetch(`${b.server.url}api/v1/peer-control`)).status).toBe(403);
  const introductionId = randomUUID();
  const introduction = sealControl({ operation: 'introduction', capability: 'peer.forward', pluginId: pair.pluginId,
    scope: pair.scope, peerInstanceId: randomUUID(), introductionId }, packet, key);
  expect((await post(sealControl({ operation: 'introduction', capability: 'peer.forward', pluginId: pair.pluginId,
    scope: 'unlinked-scope', peerInstanceId: randomUUID(), introductionId: randomUUID() }, packet, key))).status).toBe(403);
  expect((await post(introduction)).status).toBe(200);
  expect(await b.server.ctx.peerAuthority.receivedIntroductions()).toEqual([expect.objectContaining({ introductionId, status: 'pending' })]);
  expect((await post(introduction)).status).toBe(403); // replay
  const listed = await fetch(`${b.server.url}api/v1/peers/introductions`);
  expect(await listed.json()).toEqual({ introductions: [expect.objectContaining({ introductionId, status: 'pending' })] });
  const decide = (id: string, body: string) => fetch(`${b.server.url}api/v1/peers/introductions/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  expect((await decide(introductionId, '{"decision":"enroll"}')).status).toBe(400);
  expect((await decide(introductionId, '{bad')).status).toBe(400);
  expect((await decide(randomUUID(), '{"decision":"approved"}')).status).toBe(409);
  expect(await (await decide(introductionId, '{"decision":"denied"}')).json()).toMatchObject({ introductionId, status: 'denied' });
  expect((await decide(introductionId, '{"decision":"approved"}')).status).toBe(409);
  const wrongPair = sealControl({ operation: 'revoke', proposal: { ...pair, pairId: randomUUID() } }, packet, key);
  expect((await post(wrongPair)).status).toBe(403); expect(await b.server.ctx.peerPairs.grant(pair.pairId)).not.toBeNull();
  upsertHost(b.server.ctx.db, { id: ba.hostId, name: 'Scoped', hostKeyHash: getHost(b.server.ctx.db, ba.hostId)!.hostKeyHash, enrollmentCapability: 'peer.forward' });
  expect((await post(sealControl({ operation: 'proof', nonce: 'd'.repeat(48) }, packet, key))).status).toBe(403);
  destroyHost(a.server.ctx.db, ab.hostId); await a.server.ctx.peerAuthority.recover();
  expect(await a.server.ctx.peerPairs.grant(pair.pairId)).toBeNull(); key.fill(0);
}, 40_000);

it.each(['host-capability', 'host-key', 'host-destroy', 'session', 'channel-capability', 'channel-key', 'channel-host', 'channel-missing'])
  ('rechecks %s after durable replay await before proof or lifecycle dispatch', async mode => {
    const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
    const channel = (await a.server.ctx.peerChannels.remote(b.server.ctx.productInstanceId))!;
    const host = getHost(b.server.ctx.db, ba.hostId)!;
    const key = controlKey(getHost(a.server.ctx.db, ab.hostId)!.hostKeyHash, channelHash(channel));
    const packet = sealControl({ operation: 'proof', nonce: 'e'.repeat(48) }, { senderId: a.server.ctx.productInstanceId,
      recipientId: b.server.ctx.productInstanceId, senderHostId: ba.hostId, recipientHostId: ab.hostId }, key);
    const consume = vi.spyOn(b.server.ctx.peerControlReplay, 'consumeAuthenticated').mockImplementation(async () => {
      if (mode === 'host-capability' || mode === 'host-key') upsertHost(b.server.ctx.db, { id: host.id, name: 'Peer',
        hostKeyHash: mode === 'host-key' ? 'f'.repeat(64) : host.hostKeyHash, enrollmentCapability: mode === 'host-capability' ? 'peer.forward' : 'execution' });
      if (mode === 'host-destroy') destroyHost(b.server.ctx.db, host.id);
      if (mode === 'session') vi.spyOn(b.server.ctx.hostHub, 'getSession').mockReturnValue(null);
      if (mode.startsWith('channel-')) {
        const current = (await b.server.ctx.peerChannels.remote(a.server.ctx.productInstanceId))!;
        await b.server.ctx.peerChannels.register({ ...current, hostKey: mode === 'channel-key' ? 'x'.repeat(32) : current.hostKey,
          hostId: mode === 'channel-host' ? randomUUID() : current.hostId, capability: mode === 'channel-capability' ? 'peer.forward' : 'execution' });
        if (mode === 'channel-missing') vi.spyOn(b.server.ctx.peerChannels, 'remote').mockResolvedValue(null);
      }
      return true;
    });
    try {
      const response = await fetch(`${b.server.url}api/v1/peer-control`, { method: 'POST', body: JSON.stringify(packet) });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'peer control unavailable or not authorized' });
    } finally { consume.mockRestore(); key.fill(0); vi.restoreAllMocks(); }
  }, 40_000);

it.each(['ab', 'ba'])('real two-app %s enrollment rotation rejects old packets in both directions and delivers exact revoke over repaired channel', async direction => {
  const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
  const pair = proposal(a, b, ab.hostId); expect((await lifecycle(a.server, 'activate', pair)).status).toBe(200);
  const body = Buffer.from('{}'), input = { pluginId: pair.pluginId, scope: pair.scope, method: 'echo', body };
  const oldA = (await a.server.ctx.peerPairs.signRequest(pair.pairId, input))!;
  const oldB = (await b.server.ctx.peerPairs.signRequest(pair.pairId, input))!;
  const leaseA = (await a.server.ctx.peerPairs.acquireGrant(pair.pairId, 1, pair.pluginId, pair.scope))!;
  const leaseB = (await b.server.ctx.peerPairs.acquireGrant(pair.pairId, 1, pair.pluginId, pair.scope))!;
  const owner = direction === 'ab' ? a : b, local = direction === 'ab' ? b : a, credentials = direction === 'ab' ? ab : ba;
  const key = randomBytes(32).toString('base64url'), keyHash = createHash('sha256').update(key).digest('hex');
  // Keep the same enrolled host identity: only its credential generation rotates.
  upsertHost(owner.server.ctx.db, { id: credentials.hostId, name: 'Rotated', hostKeyHash: keyHash });
  await local.server.ctx.peerChannels.register({ remoteInstanceId: owner.server.ctx.productInstanceId,
    hostId: credentials.hostId, hostKey: key, capability: 'execution' });
  const dispatchA = vi.fn(), dispatchB = vi.fn();
  a.server.ctx.plugins = { dispatchPeer: dispatchA, stop() {} } as never;
  b.server.ctx.plugins = { dispatchPeer: dispatchB, stop() {} } as never;
  for (const [peer, packet] of [[b, oldA], [a, oldB]] as const) {
    const response = await fetch(new URL(packet.route, peer.server.url), { method: 'POST', body,
      headers: { 'content-type': 'application/json', 'x-zcc-peer-envelope': Buffer.from(JSON.stringify(packet)).toString('base64url') } });
    expect(response.status).toBe(401);
  }
  expect(dispatchA).not.toHaveBeenCalled(); expect(dispatchB).not.toHaveBeenCalled();
  const commit = vi.fn();
  for (const lease of [leaseA, leaseB]) await expect(lease.commitSync(commit)).rejects.toThrow('no longer active');
  expect(commit).not.toHaveBeenCalled();
  for (const [store, packet] of [[b.server.ctx.peerPairs, oldA], [a.server.ctx.peerPairs, oldB]] as const) {
    expect(await store.authenticateRequest({ envelope: packet, body, pluginId: pair.pluginId, scope: pair.scope, route: packet.route, httpMethod: 'POST' })).toBeNull();
    expect(await store.signRequest(pair.pairId, input)).toBeNull();
  }
  const state = async (peer: typeof a) => JSON.parse(unsealPeerBytes(await readFile(join(peer.dir, 'peer-authority', 'authority-v1.bin')),
    peer.key, `authority-v1:${peer.server.ctx.productInstanceId}`).toString());
  expect((await state(a)).records[0].status).toBe('active');
  expect((await state(b)).records[0].status).toBe('active');
  // Old daemon connection is closed before reconnect so it cannot republish stale credentials.
  const previous = connections[direction === 'ab' ? 0 : 1]!;
  await previous.close(); connections.splice(connections.indexOf(previous), 1);
  const reconnect = startEnrolledHostConnection({ serverUrl: owner.server.url, hostId: credentials.hostId, hostKey: key,
    dataDir: local.dir, localPeerAppDataDir: local.dir, runtime: createCommandRuntime({ dataDir: local.dir, emit() {}, loadConfig: () => ({}) }) });
  connections.push(reconnect); await reconnect.ready;
  await vi.waitFor(async () => expect(channelHash((await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId))!)).toBe(keyHash));
  await a.server.ctx.peerAuthority.recover();
  expect((await state(a)).records[0]).toMatchObject({ status: 'revoked', revokeDelivered: true });
  expect((await state(b)).records[0].status).toBe('revoked');
  await expect(a.server.ctx.peerAuthority.activate(pair)).rejects.toThrow('revoked');
  expect(await a.server.ctx.peerPairs.grant(pair.pairId)).toBeNull();
  expect(await b.server.ctx.peerPairs.grant(pair.pairId)).toBeNull();
  await a.server.close(); servers.splice(servers.indexOf(a.server), 1);
  await b.server.close(); servers.splice(servers.indexOf(b.server), 1);
  const restartedA = await app(a.dir, a.key), restartedB = await app(b.dir, b.key);
  expect(await restartedA.server.ctx.peerPairs.grant(pair.pairId)).toBeNull();
  expect(await restartedB.server.ctx.peerPairs.grant(pair.pairId)).toBeNull();
  await expect(restartedA.server.ctx.peerAuthority.activate(pair)).rejects.toThrow('revoked');
}, 60_000);
