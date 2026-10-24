import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from '../../../../apps/server/src/http/product-server.js';
import { createPluginApi, type PluginHandle } from '../../../../apps/server/src/plugins/plugin-api.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from '../../../../apps/host-daemon/src/server-connection.js';
import { createCommandRuntime } from '../../../../apps/host-daemon/src/command-dispatch.js';
import { createStoredLocalPeerAppResolver } from '../../../../apps/host-daemon/src/peer-forward.js';
import { HOST_RPC_PROTOCOL_VERSION } from '../../../../packages/contracts/src/host-rpc.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerGroup } from './peer-group.js';
import { DesignDocPairing, bootstrapScope } from './pairing.js';
import { mergeRosters } from './peer-slots.js';

const roots: string[] = [], servers: ProductServer[] = [], handles: PluginHandle[] = [], connections: EnrolledHostConnection[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.dispose();
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function app() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dd-bilateral-sdk-'))); roots.push(root);
  const key = randomBytes(32);
  const server = await startProductServer({ dataDir: root, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key } }); servers.push(server);
  const handle = createPluginApi('design-docs', join(root, 'plugins', 'design-docs'), { productContext: server.ctx }); handles.push(handle);
  // Fixture dispatch mirrors PluginService while retaining real pair authentication and transport.
  server.ctx.plugins = { dispatchPeer: async (pluginId: string, method: string, request: import('@zana-ai/zcc-plugin-sdk/server').PluginPeerRequest) => {
    const handler = pluginId === 'design-docs' ? handle.peerHandlers.get(method) : undefined;
    if (!handler) throw new Error(`unknown peer ${pluginId} ${method}`);
    return handler(request);
  } } as typeof server.ctx.plugins;
  const db = handle.api.storage.database();
  let group!: DesignDocPeerGroup;
  const store = new DesignDocStore(db, { onMutation: (mutation) => group.sync.recordLocalMutation(mutation) });
  group = new DesignDocPeerGroup(db);
  const pairing = new DesignDocPairing(group, handle.api.sdk.peers); pairing.register(handle.api);
  return { root, server, handle, group, pairing, store, id: server.ctx.productInstanceId };
}
async function enroll(owner: Awaited<ReturnType<typeof app>>, local: Awaited<ReturnType<typeof app>>) {
  const issued = owner.server.ctx.joinCodes.mint();
  const response = await fetch(`${owner.server.url}internal/hosts/enroll`, { method: 'POST', headers: {
    authorization: `Bearer ${issued.joinCode}`, 'content-type': 'application/json' }, body: JSON.stringify({
    protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: issued.hostId, hostName: 'DD peer', instanceId: randomUUID() }) });
  expect(response.status).toBe(201);
  const credentials = await response.json() as { hostId: string; hostKey: string };
  const connection = startEnrolledHostConnection({ serverUrl: owner.server.url, ...credentials, dataDir: local.root, localPeerAppDataDir: local.root,
    runtime: createCommandRuntime({ dataDir: local.root, resolveLocalPeerApp: createStoredLocalPeerAppResolver(local.root),
      emit() {}, loadConfig: () => ({}) }) }); connections.push(connection);
  await connection.ready;
  await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.id)).not.toBeNull());
}

it('real core safe SDK: two independent DD databases negotiate bootstrap, consent, admit and revoke without secrets', async () => {
  const a = await app(), b = await app(); await enroll(a, b); await enroll(b, a);
  const [founder, follower] = a.id < b.id ? [a, b] : [b, a];
  const repo = founder.group.sync.localRepository()!.repoId;
  founder.store.create({ title: 'Existing private document', template: 'blank' }, { kind: 'user', label: 'You', threadId: null });
  expect(await follower.pairing.enable(founder.id)).toMatchObject({ configured: false, lifecycleAvailable: true });
  expect(founder.group.roster()).toBeNull();
  await founder.pairing.enable(follower.id); await follower.pairing.retry(true); await founder.pairing.retry(true);
  expect(follower.group.roster()).toEqual(founder.group.roster());
  expect(follower.group.sync.localRepository()!.repoId).toBe(repo);
  expect(follower.store.list()).toEqual([]);
  expect(founder.group.sync.readyIntents(repo)).toEqual([]);
  const status = await founder.pairing.status();
  expect(status.members.every((member) => member.authorized)).toBe(true);
  expect(status.members).toHaveLength(2);
  expect(status.configured).toBe(true);
  expect(founder.group.roster()).toMatchObject({ version: 1, rosterEpoch: 1, digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(founder.group.roster()!.seats).toHaveLength(8);
  expect(status).toMatchObject({ installerAvailable: false, introductionsAvailable: true });
  const grants = await founder.handle.api.sdk.peers.list();
  expect(grants.map((grant) => grant.scope).sort()).toEqual([bootstrapScope(a.id, b.id), repo].sort());
  expect(JSON.stringify(status)).not.toMatch(/hostKey|secret|token|targetHostId/);
  await founder.pairing.revoke(follower.id);
  expect(await founder.handle.api.sdk.peers.list()).toEqual([]);
  await expect(follower.handle.api.sdk.peers.call(founder.id, 'group-hello', {}, { scope: repo })).rejects.toThrow();
  await founder.server.ctx.peerAuthority.recover();
  expect(await follower.handle.api.sdk.peers.list()).toEqual([]);
  expect(founder.group.roster()).toHaveProperty('rosterEpoch', 1);
}, 60_000);

it('real SDK lost admission ACK then sponsor self-leave recovers immutable receipt and delegated admission on existing grant', async () => {
  const a = await app(), b = await app(), c = await app(), d = await app();
  await enroll(a, b); await enroll(b, a); await enroll(b, c); await enroll(c, b); await enroll(c, d); await enroll(d, c);
  const [founder, follower] = a.id < b.id ? [a, b] : [b, a];
  await founder.pairing.enable(follower.id); await follower.pairing.enable(founder.id); await founder.pairing.retry(true);
  await b.pairing.enable(c.id);
  const joinHandler = b.handle.peerHandlers.get('group-join')!;
  b.handle.peerHandlers.set('group-join', async (request) => { await joinHandler(request); throw new Error('lost admission ACK'); });
  const sdk = b.handle.api.sdk.peers, call = sdk.call;
  sdk.call = async (...args) => { if (args[0] === c.id && args[1] === 'group-roster') throw new Error('delivery held'); return call(...args); };
  await c.pairing.enable(b.id); expect(c.group.roster()).toBeNull();
  const frozen = c.group.consent()!.request!, immutable = b.group.admit(frozen, c.id);
  // Link revocation never waits on delivery; hold b's local teardown so c's receipt recovery runs over the still-existing grant.
  const revoke = sdk.revoke; let teardownHeld = true;
  sdk.revoke = async (...args) => { if (teardownHeld) throw new Error('teardown offline'); return revoke(...args); };
  await b.pairing.remove(b.group.sync.localRepository()!.replicaId);
  expect(c.group.roster()).toBeNull(); expect(b.group.removalDeliveryPending(c.id)).toBe(true);
  expect(b.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
  const jobs = b.group.jobs(), enable = vi.spyOn(c.handle.api.sdk.peers, 'enable');
  await c.pairing.retry(true);
  expect(c.group.roster()!.members.some((member) => member.machineId === b.id)).toBe(false);
  expect(c.group.roster()!.members.some((member) => member.machineId === c.id)).toBe(true);
  expect(b.group.admit(frozen, c.id)).toEqual(immutable); expect(b.group.jobs()).toEqual(jobs); expect(enable).not.toHaveBeenCalled();
  expect(c.group.hasCapacity()).toBe(true);
  // Once teardown can run, b drops its link to c even though the removal roster to c is still held.
  teardownHeld = false; await b.pairing.retry(true);
  expect((await sdk.list()).some((peer) => peer.id === c.id)).toBe(false);
  await c.pairing.enable(d.id); await d.pairing.enable(c.id);
  expect(d.group.roster()!.members.some((member) => member.machineId === d.id)).toBe(true);
  expect(d.group.roster()!.members.some((member) => member.machineId === b.id)).toBe(false);
}, 60_000);

it('real SDK cyclic retirements converge after lost seal ACK and restart; failed teardown stays visible', async () => {
  const a = await app(), b = await app(), c = await app();
  for (const [owner, local] of [[a, b], [b, a], [a, c], [c, a], [b, c], [c, b]] as const) await enroll(owner, local);
  const [founder, follower] = a.id < b.id ? [a, b] : [b, a];
  await founder.pairing.enable(follower.id); await follower.pairing.enable(founder.id); await founder.pairing.retry(true);
  await a.pairing.enable(c.id); await c.pairing.enable(a.id); await a.pairing.retry(true); await b.pairing.retry(true);
  await b.handle.api.sdk.peers.enable(c.id, { scope: a.group.roster()!.repoId });
  const barrier = [a.group.remove(b.group.sync.localRepository()!.replicaId).roster,
    b.group.remove(c.group.sync.localRepository()!.replicaId).roster, c.group.remove(a.group.sync.localRepository()!.replicaId).roster].reduce(mergeRosters);
  a.group.apply(barrier, c.id); b.group.apply(barrier, a.id); c.group.apply(barrier, b.id);
  const restarted = new DesignDocPairing(new DesignDocPeerGroup(a.handle.api.storage.database()), a.handle.api.sdk.peers);
  const handler = b.handle.peerHandlers.get('group-retire')!;
  let lost = false;
  b.handle.peerHandlers.set('group-retire', async (request) => { const response = await handler(request); if (!lost) { lost = true; throw new Error('lost seal ACK'); } return response; });
  a.handle.api.sdk.peers.revoke = async () => { throw new Error('teardown offline'); };
  for (let cycle = 0; cycle < 6; cycle++) { await restarted.retry(true); await b.pairing.retry(true); await c.pairing.retry(true); }
  for (const target of [a, b, c]) {
    expect(target.group.roster()!.members).toEqual([]); expect(target.group.roster()!.removals).toHaveLength(3);
    expect(target.group.sync.localRepository()!.groupId).toBeNull();
    expect(target.group.jobs().some((job) => job.kind === 'retire' && job.state !== 'done')).toBe(false);
    // Link teardown no longer waits on delivery, so a best-effort roster job may outlive the link it needed
    // (the remote has already dropped its side, so core answers 401).
    expect(target.group.jobs().filter((job) => job.kind === 'roster' && job.state !== 'done' && !/the other computer has not finished setting up|not (pair )?authorized|peer request failed: 401/.test(job.error ?? ''))
      .map((job) => job.error)).toEqual([]);
    expect(target.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
  }
  expect(a.group.roster()).toEqual(b.group.roster()); expect(b.group.roster()).toEqual(c.group.roster());
  expect(a.group.jobs().some((job) => job.kind === 'local-revoke' && job.error === 'teardown offline')).toBe(true);
}, 60_000);

it('real SDK retirement seals disconnected sponsor frontier and preserves prior newcomer admission', async () => {
  const a = await app(), b = await app(), c = await app(), d = await app();
  await enroll(a, b); await enroll(b, a); await enroll(a, c); await enroll(c, a); await enroll(b, d); await enroll(d, b);
  const [founder, follower] = a.id < b.id ? [a, b] : [b, a];
  await founder.pairing.enable(follower.id); await follower.pairing.enable(founder.id); await founder.pairing.retry(true);
  await a.pairing.enable(c.id); await c.pairing.enable(a.id); await a.pairing.retry(true); await b.pairing.retry(true);
  const sdk = b.handle.api.sdk.peers, call = sdk.call;
  sdk.call = async (...args) => {
    if (args[0] === a.id && args[1] === 'group-roster') throw new Error('offline roster path');
    return call(...args);
  };
  await b.pairing.enable(d.id); await d.pairing.enable(b.id);
  expect(b.group.roster()!.members.some((member) => member.machineId === d.id)).toBe(true);
  expect(a.group.roster()!.members.some((member) => member.machineId === d.id)).toBe(false);
  const pending = a.group.remove(b.group.sync.localRepository()!.replicaId);
  expect(pending.stage).toBe('retiring'); expect(pending.roster.members.some((member) => member.machineId === b.id)).toBe(true);
  const original = b.handle.peerHandlers.get('group-retire')!;
  let lost = false;
  b.handle.peerHandlers.set('group-retire', async (request) => {
    const value = await original(request);
    if (!lost) { lost = true; throw new Error('lost seal ACK'); }
    return value;
  });
  await a.pairing.retry(true); const seal = b.group.roster()!.closures[0];
  await a.pairing.retry(true); await a.pairing.retry(true); await c.pairing.retry(true);
  expect(b.group.roster()!.closures[0]).toEqual(seal);
  expect(a.group.roster()!.members.some((member) => member.machineId === d.id)).toBe(true);
  expect(c.group.roster()!.members.some((member) => member.machineId === d.id)).toBe(true);
  expect(a.group.roster()!.members.some((member) => member.machineId === b.id)).toBe(false);
  expect((await a.handle.api.sdk.peers.list()).some((peer) => peer.id === d.id)).toBe(false);
}, 60_000);

it('real SDK rejects remote localOnly and ACKs self-leave retries without historical write authority', async () => {
  const a = await app(), b = await app(), c = await app();
  await enroll(a, b); await enroll(b, a); await enroll(a, c); await enroll(c, a);
  const [founder, follower] = a.id < b.id ? [a, b] : [b, a];
  await founder.pairing.enable(follower.id); await follower.pairing.enable(founder.id); await founder.pairing.retry(true);
  await a.pairing.enable(c.id); await c.pairing.enable(a.id); await a.pairing.retry(true); await b.pairing.retry(true);
  const scope = a.group.roster()!.repoId;
  await expect(a.handle.api.sdk.peers.call(b.id, 'group-revoke', { peerId: c.id, scope, localOnly: true }, { scope })).rejects.toThrow();
  const original = b.handle.peerHandlers.get('group-roster')!;
  let lost = false;
  b.handle.peerHandlers.set('group-roster', async (request) => {
    const result = await original(request);
    if (!lost) { lost = true; throw new Error('lost ACK after real SDK commit'); }
    return result;
  });
  // Link revocation never waits on delivery; hold a's local teardown so the ACK retry runs over the still-existing grant.
  const sdk = a.handle.api.sdk.peers, revoke = sdk.revoke; let teardownHeld = true;
  sdk.revoke = async (...args) => { if (teardownHeld) throw new Error('teardown offline'); return revoke(...args); };
  await a.pairing.remove(a.group.sync.localRepository()!.replicaId);
  expect(a.group.removalDeliveryPending(b.id)).toBe(true);
  expect(a.group.jobs().some((job) => job.kind === 'local-revoke' && /waiting for/.test(job.error ?? ''))).toBe(false);
  expect(b.group.roster()!.members.some((member) => member.machineId === a.id)).toBe(false);
  const prior = b.group.roster(), jobs = b.group.jobs();
  const ack = await a.handle.api.sdk.peers.call(b.id, 'group-roster', a.group.roster(), { scope });
  expect(ack).toEqual({ roster: prior }); expect(b.group.jobs()).toEqual(jobs);
  teardownHeld = false; await a.pairing.retry(true);
  expect(a.group.removalDeliveryPending(b.id)).toBe(false);
  expect(await a.handle.api.sdk.peers.list()).toEqual([]);
  expect(a.group.sync.localRepository()!.groupId).toBeNull();
}, 60_000);
