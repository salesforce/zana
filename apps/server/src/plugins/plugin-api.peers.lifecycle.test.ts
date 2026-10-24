import { generateSeed, publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from '../http/product-server.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from '@zana-ai/zcc-host-daemon/server-connection';
import { createCommandRuntime } from '@zana-ai/zcc-host-daemon/command-dispatch';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { addHostLinkUse, openDatabase, removeHostLinkUse, upsertHost } from '@zana-ai/zcc-db';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPluginApi, type PluginHandle } from './plugin-api.js';
import { InvitationError, PeerInvitations, type InvitationTransport, type PeerInvitationsOptions } from '../services/peers/peer-invitation.js';
import type { PeerLinkView } from '../services/peers/peer-links.js';
import { PeerConnectionRegistry } from '../services/peers/peer-connections.js';
import { NOTES_PER_PLUGIN_MAX, PluginLinkNotes } from '../services/peers/plugin-link-notes.js';

const roots: string[] = [], servers: ProductServer[] = [], connections: EnrolledHostConnection[] = [], handles: PluginHandle[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.dispose();
  for (const connection of connections.splice(0)) await connection.close();
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function app(directory?: string, key = randomBytes(32)) {
  const dir = directory ?? await realpath(await mkdtemp(join(tmpdir(), 'plugin-peer-lifecycle-')));
  if (!directory) roots.push(dir);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key } });
  servers.push(server);
  return { server, dir, key };
}
function plugin(owner: Awaited<ReturnType<typeof app>>, pluginId = 'test-plugin') {
  const handle = createPluginApi(pluginId, join(owner.dir, 'plugins', pluginId), { productContext: owner.server.ctx });
  handles.push(handle);
  return handle;
}
async function connect(owner: Awaited<ReturnType<typeof app>>, local: Awaited<ReturnType<typeof app>>, credentials: { hostId: string; hostKey: string }) {
  const connection = startEnrolledHostConnection({ serverUrl: owner.server.url, ...credentials, dataDir: local.dir, localPeerAppDataDir: local.dir,
    runtime: createCommandRuntime({ dataDir: local.dir, emit() {}, loadConfig: () => ({}) }) });
  connections.push(connection);
  await connection.ready;
  await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId)).not.toBeNull());
  return connection;
}
async function enroll(owner: Awaited<ReturnType<typeof app>>, local: Awaited<ReturnType<typeof app>>) {
  const issued = owner.server.ctx.joinCodes.mint();
  const response = await fetch(`${owner.server.url}internal/hosts/enroll`, { method: 'POST', headers: {
    authorization: `Bearer ${issued.joinCode}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    hostId: issued.hostId, hostName: 'Peer machine', instanceId: randomUUID() }) });
  expect(response.status).toBe(201);
  const credentials = await response.json() as { hostId: string; hostKey: string };
  const connection = await connect(owner, local, credentials);
  return { ...credentials, connection };
}
async function pair() {
  const a = await app(), b = await app(), ab = await enroll(a, b), ba = await enroll(b, a);
  const handle = plugin(a), remote = plugin(b), peerId = b.server.ctx.productInstanceId;
  return { a, b, ab, ba, handle, remote, peerId };
}
const scope = 'domain-consent-opaque-scope';

it('projects public reachable app identities, activates encrypted mutual authority and reuses IDs across retries/restart', async () => {
  const { a, b, ab, handle, remote, peerId } = await pair();
  const peers = handle.api.sdk.peers;
  expect(await peers.localIdentity()).toEqual({ id: a.server.ctx.productInstanceId });
  expect(await peers.features()).toEqual({ lifecycle: true, introductions: true, installer: true, invitations: true });
  const installer = a.server.ctx.peerInstaller;
  (a.server.ctx as { peerInstaller?: unknown }).peerInstaller = undefined;
  try { expect(await peers.features()).toEqual({ lifecycle: true, introductions: true, installer: false, invitations: true }); }
  finally { (a.server.ctx as { peerInstaller?: unknown }).peerInstaller = installer; }
  expect(await peers.enrolled()).toEqual([{ id: peerId, hostId: ab.hostId, name: 'Peer machine', connected: true }]);
  const [grant, concurrent] = await Promise.all([peers.enable(peerId, { scope }), peers.enable(peerId, { scope })]);
  expect(concurrent).toEqual(grant);
  expect(Object.keys(grant).sort()).toEqual(['grantEpoch', 'id', 'pairId', 'proposalId', 'scope']);
  expect(await peers.enable(peerId, { scope })).toEqual(grant);
  expect(await remote.api.sdk.peers.enable(a.server.ctx.productInstanceId, { scope })).toMatchObject({ pairId: grant.pairId, proposalId: grant.proposalId });
  for (const owner of [a, b]) {
    for (const file of ['peer-authority/authority-v1.bin', 'peer-pairs/pairs-v2.bin']) {
      const bytes = await readFile(join(owner.dir, file));
      expect(bytes.subarray(0, 4).toString()).toBe('ZCP2');
      expect(bytes.includes(Buffer.from(scope))).toBe(false);
    }
  }
  await ab.connection.close(); connections.splice(connections.indexOf(ab.connection), 1);
  await handle.dispose(); await a.server.close(); servers.splice(servers.indexOf(a.server), 1);
  const restarted = await app(a.dir, a.key);
  await connect(restarted, b, ab);
  const retry = plugin(restarted);
  expect(await retry.api.sdk.peers.enable(peerId, { scope })).toEqual(grant);
  expect(await retry.api.sdk.peers.list()).toHaveLength(1);
}, 60_000);

it('retries durable proposal after lost import ACK and full app restart without minting a second binding', async () => {
  const { a, b, ab, handle, peerId } = await pair();
  const original = b.server.ctx.peerAuthority.import.bind(b.server.ctx.peerAuthority);
  const imported = vi.spyOn(b.server.ctx.peerAuthority, 'import').mockImplementationOnce(async (...args) => {
    await original(...args);
    throw new Error('lost import ACK');
  });
  await expect(handle.api.sdk.peers.enable(peerId, { scope })).rejects.toThrow('peer control rejected');
  const proposals = await a.server.ctx.peerAuthority.proposals('test-plugin', peerId, scope);
  expect(proposals).toHaveLength(1);
  expect(await a.server.ctx.peerPairs.list('test-plugin')).toEqual([]);
  await ab.connection.close(); connections.splice(connections.indexOf(ab.connection), 1);
  await handle.dispose(); await a.server.close(); servers.splice(servers.indexOf(a.server), 1);
  const restarted = await app(a.dir, a.key);
  await connect(restarted, b, ab);
  const grant = await plugin(restarted).api.sdk.peers.enable(peerId, { scope });
  expect(grant).toMatchObject({ pairId: proposals[0]!.pairId, proposalId: proposals[0]!.proposalId });
  expect(imported.mock.calls.map(([proposal]) => proposal.pairId)).toEqual([grant.pairId, grant.pairId]);
}, 60_000);

it('rejects unilateral enrollment, arbitrary host IDs and weak reverse capabilities', async () => {
  const a = await app(), b = await app(), ab = await enroll(a, b), handle = plugin(a), peerId = b.server.ctx.productInstanceId;
  expect(await handle.api.sdk.peers.enrolled()).toEqual([]);
  await expect(handle.api.sdk.peers.enable(peerId, { scope })).rejects.toThrow('mutual enrollment unavailable');
  await enroll(b, a);
  await expect(handle.api.sdk.peers.enable(ab.hostId, { scope })).rejects.toThrow('mutual enrollment unavailable');
  const channel = (await a.server.ctx.peerChannels.remote(peerId))!;
  await a.server.ctx.peerChannels.register({ ...channel, capability: 'peer.forward' });
  expect(await handle.api.sdk.peers.enrolled()).toEqual([]);
  await expect(handle.api.sdk.peers.enable(peerId, { scope })).rejects.toThrow('verified peer app unavailable');
  expect(await a.server.ctx.peerPairs.list('test-plugin')).toEqual([]);
}, 40_000);

it('denies wrong-app route binding and hides credentials from channel introspection', async () => {
  const { a, handle } = await pair();
  const wrongId = randomUUID();
  await a.server.ctx.peerChannels.register({ remoteInstanceId: wrongId, hostId: randomUUID(), hostKey: 'private-channel-key'.repeat(3), capability: 'execution' });
  const channels = await a.server.ctx.peerChannels.list();
  expect(channels.every(channel => Object.keys(channel).sort().join(',') === 'capability,remoteInstanceId')).toBe(true);
  await expect(handle.api.sdk.peers.enable(wrongId, { scope })).rejects.toThrow('verified peer app unavailable');
  expect(await a.server.ctx.peerAuthority.proposals('test-plugin', wrongId, scope)).toEqual([]);
  expect((await handle.api.sdk.peers.enrolled()).some(peer => peer.id === wrongId)).toBe(false);
}, 40_000);

it('binds plugin identity and exact scope for revoke/introduction, delivers introductions as consent requests only', async () => {
  const { a, b, handle, peerId } = await pair();
  const other = plugin(a, 'other-plugin');
  const grant = await handle.api.sdk.peers.enable(peerId, { scope });
  const unrelated = await handle.api.sdk.peers.enable(peerId, { scope: 'other-scope' });
  await other.api.sdk.peers.revoke(peerId, { scope });
  expect(await a.server.ctx.peerPairs.grant(grant.pairId)).not.toBeNull();
  await expect(other.api.sdk.peers.call(peerId, 'echo', {}, { scope })).rejects.toThrow('not authorized');
  for (const extra of [{ pluginId: 'other-plugin' }, { hostId: randomUUID() }, { pairId: grant.pairId }]) {
    await expect(handle.api.sdk.peers.enable(peerId, { scope, ...extra })).rejects.toThrow('invalid peer lifecycle request');
    await expect(handle.api.sdk.peers.revoke(peerId, { scope, ...extra })).rejects.toThrow('invalid peer lifecycle request');
  }
  // Third peer only extends this test's scope-matched introduction group.
  const c = await app(); await enroll(a, c); await enroll(c, a);
  const thirdId = c.server.ctx.productInstanceId;
  await handle.api.sdk.peers.enable(thirdId, { scope });
  await expect(other.api.sdk.peers.introduce(thirdId, { sponsorPeerId: peerId, scope })).rejects.toThrow('scope or recipient mismatch');
  await expect(handle.api.sdk.peers.introduce(thirdId, { sponsorPeerId: peerId, scope: 'other-scope' })).rejects.toThrow('scope or recipient mismatch');
  await expect(handle.api.sdk.peers.introduce(peerId, { sponsorPeerId: peerId, scope })).rejects.toThrow('invalid peer introduction');
  const introduction = await handle.api.sdk.peers.introduce(thirdId, { sponsorPeerId: peerId, scope });
  expect(introduction.status).toBe('pending');
  expect(await handle.api.sdk.peers.introduce(thirdId, { sponsorPeerId: peerId, scope })).toEqual(introduction);
  await a.server.ctx.peerAuthority.recover();
  expect(await a.server.ctx.peerAuthority.introductionStatus(introduction.introductionId)).toBe('complete');
  // Delivery reaches the introduced app as a pending consent request; nothing is enrolled or linked automatically.
  expect(await c.server.ctx.peerAuthority.receivedIntroductions()).toEqual([expect.objectContaining({ introductionId: introduction.introductionId,
    sponsorInstanceId: a.server.ctx.productInstanceId, peerInstanceId: peerId, status: 'pending' })]);
  expect(await c.server.ctx.peerPairs.list('test-plugin')).toHaveLength(1);
  await handle.api.sdk.peers.revoke(peerId, { scope }); await handle.api.sdk.peers.revoke(peerId, { scope });
  await a.server.ctx.peerAuthority.recover();
  expect(await a.server.ctx.peerPairs.grant(grant.pairId)).toBeNull();
  expect(await b.server.ctx.peerPairs.grant(grant.pairId)).toBeNull();
  expect(await a.server.ctx.peerPairs.grant(unrelated.pairId)).not.toBeNull();
  expect(await a.server.ctx.peerAuthority.introductionStatus(introduction.introductionId)).toBe('blocked');
}, 60_000);

it.each(['abort', 'dispose'] as const)('cancels in-flight %s before activation and prevents late lifecycle work', async mode => {
  const { a, handle, peerId } = await pair();
  const call = vi.spyOn(a.server.ctx.hostHub, 'callHostOnlineRpc').mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = expect(handle.api.sdk.peers.enable(peerId, { scope, signal: controller.signal })).rejects.toThrow(mode === 'abort' ? 'caller cancelled' : 'stale');
  // waitFor defaults to a 1s window; under full parallel-suite load the enable() round-trip can take
  // longer to reach the spied call, so give these spy gates explicit headroom.
  await vi.waitFor(() => expect(call).toHaveBeenCalled(), { timeout: 15_000 });
  if (mode === 'abort') controller.abort(new Error('caller cancelled')); else await handle.dispose();
  await pending;
  expect(await a.server.ctx.peerAuthority.proposals('test-plugin', peerId, scope)).toEqual([]);
  expect(await a.server.ctx.peerPairs.list('test-plugin')).toEqual([]);
  if (mode === 'dispose') {
    await expect(handle.api.sdk.peers.localIdentity()).rejects.toThrow('stale');
    await expect(handle.api.sdk.peers.features()).rejects.toThrow('stale');
    await expect(handle.api.sdk.peers.enrolled()).rejects.toThrow('stale');
    await expect(handle.api.sdk.peers.revoke(peerId, { scope })).rejects.toThrow('stale');
    await expect(handle.api.sdk.peers.introduce(peerId, { sponsorPeerId: randomUUID(), scope })).rejects.toThrow('stale');
  }
}, 40_000);

it.each(['abort', 'dispose'] as const)('stops %s during credential import; delayed ACK cannot activate and retry keeps durable IDs', async mode => {
  const { a, b, handle, peerId } = await pair();
  const original = b.server.ctx.peerAuthority.import.bind(b.server.ctx.peerAuthority);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const imported = vi.spyOn(b.server.ctx.peerAuthority, 'import').mockImplementationOnce(async (...args) => { await held; return original(...args); });
  const activated = vi.spyOn(b.server.ctx.peerAuthority, 'acceptActivation');
  const controller = new AbortController();
  const pending = expect(handle.api.sdk.peers.enable(peerId, { scope, signal: controller.signal })).rejects.toThrow(mode === 'abort' ? 'cancelled' : /cancelled|stale/);
  // waitFor defaults to a 1s window; under full parallel-suite load the enable() round-trip can take
  // longer to reach the mocked import, so give these spy gates explicit headroom.
  await vi.waitFor(() => expect(imported).toHaveBeenCalled(), { timeout: 15_000 });
  if (mode === 'abort') controller.abort(new Error('caller cancelled')); else await handle.dispose();
  await pending;
  const [proposal] = await a.server.ctx.peerAuthority.proposals('test-plugin', peerId, scope);
  expect(proposal).toBeDefined();
  release();
  await vi.waitFor(() => expect(imported.mock.settledResults[0]?.type).toBe('fulfilled'), { timeout: 15_000 });
  expect(activated).not.toHaveBeenCalled();
  expect(await a.server.ctx.peerPairs.list('test-plugin')).toEqual([]);
  expect(await b.server.ctx.peerPairs.list('test-plugin')).toEqual([]);
  const retry = mode === 'dispose' ? plugin(a) : handle;
  expect(await retry.api.sdk.peers.enable(peerId, { scope })).toMatchObject({ pairId: proposal!.pairId, proposalId: proposal!.proposalId });
}, 40_000);

it('refuses ambiguous manual proposals and existing bindings to a different local host', async () => {
  const { a, ab, handle, peerId } = await pair();
  const grant = await handle.api.sdk.peers.enable(peerId, { scope });
  await expect(a.server.ctx.peerAuthority.ensureProposal({ pluginId: 'test-plugin', remoteInstanceId: peerId, scope, targetHostId: randomUUID() }))
    .rejects.toThrow('peer destination mismatch');
  await a.server.ctx.peerAuthority.propose({ pairId: randomUUID(), proposalId: randomUUID(), localInstanceId: a.server.ctx.productInstanceId,
    remoteInstanceId: peerId, pluginId: 'test-plugin', targetHostId: ab.hostId, scope, epoch: 1 });
  await expect(handle.api.sdk.peers.enable(peerId, { scope })).rejects.toThrow('ambiguous');
  expect(await a.server.ctx.peerPairs.grant(grant.pairId)).not.toBeNull();
}, 40_000);

it('product wiring gates connection hosts on an approved use and leaves execution enrollments ungated', async () => {
  const { a, ab, handle, peerId } = await pair();
  const db = a.server.ctx.db, authority = a.server.ctx.peerAuthority;
  const link = upsertHost(db, { id: randomUUID(), name: 'Zana peer link: Peer (sync only)', hostKeyHash: 'd'.repeat(64), enrollmentCapability: 'peer.forward', isPrimary: false });
  const input = { pluginId: 'test-plugin', remoteInstanceId: peerId, targetHostId: link.id, scope };
  await expect(authority.ensureProposal(input)).rejects.toThrow('use_not_approved');
  addHostLinkUse(db, link.id, { pluginId: 'other-plugin', scope, label: 'Other' });
  await expect(authority.ensureProposal(input)).rejects.toThrow('use_not_approved');
  addHostLinkUse(db, link.id, { pluginId: 'test-plugin', scope, label: 'Test' });
  // Past the use gate: the forward-only host has no live enrollment, so the proof step refuses instead.
  await expect(authority.ensureProposal(input)).rejects.toThrow('mutual enrollment unavailable');
  removeHostLinkUse(db, link.id, 'test-plugin');
  await expect(authority.ensureProposal(input)).rejects.toThrow('use_not_approved');
  await expect(handle.api.sdk.peers.enable(peerId, { scope })).resolves.toMatchObject({ id: peerId });
  expect((await authority.proposals('test-plugin', peerId, scope))[0]).toMatchObject({ targetHostId: ab.hostId });
}, 40_000);

it('rejects malformed lifecycle input, unavailable runtimes and pre-cancelled requests before authority work', async () => {
  const { a, handle, peerId } = await pair();
  const bare = createPluginApi('bare', join(a.dir, 'bare')); handles.push(bare);
  for (const run of [() => bare.api.sdk.peers.localIdentity(), () => bare.api.sdk.peers.enrolled(), () => bare.api.sdk.peers.enable(peerId, { scope }),
    () => bare.api.sdk.peers.revoke(peerId, { scope }), () => bare.api.sdk.peers.introduce(peerId, { sponsorPeerId: randomUUID(), scope })]) {
    await expect(run()).rejects.toThrow('not available');
  }
  expect(await bare.api.sdk.peers.features()).toEqual({ lifecycle: false, introductions: false, installer: false, invitations: false });
  for (const invalidScope of ['', '\u0000', 'x'.repeat(1025)]) await expect(handle.api.sdk.peers.enable(peerId, { scope: invalidScope })).rejects.toThrow('invalid peer lifecycle request');
  for (const invalidId of ['!', a.server.ctx.productInstanceId]) await expect(handle.api.sdk.peers.enable(invalidId, { scope })).rejects.toThrow('invalid peer lifecycle request');
  const signal = AbortSignal.abort(new Error('pre-cancelled'));
  for (const run of [() => handle.api.sdk.peers.enrolled({ signal }), () => handle.api.sdk.peers.enable(peerId, { scope, signal }),
    () => handle.api.sdk.peers.introduce(peerId, { sponsorPeerId: randomUUID(), scope, signal })]) await expect(run()).rejects.toThrow('pre-cancelled');
  // Disconnected enrollment is not a reachable app mapping.
  for (const connection of connections.splice(0)) await connection.close();
  upsertHost(a.server.ctx.db, { id: randomUUID(), name: 'Offline', hostKeyHash: 'f'.repeat(64) });
  expect(await handle.api.sdk.peers.enrolled()).toEqual([]);
}, 40_000);

it('fake harness records exact public lifecycle signatures and rejects cancelled/stale calls', async () => {
  const { zcc, harness } = createFakePluginHost();
  const grant = { id: 'app-b', pairId: 'pair-1', proposalId: 'proposal-1', scope, grantEpoch: 1 };
  const stubs = { localIdentity: { id: 'app-a' }, enrolled: [{ id: 'app-b', hostId: 'host-b', name: 'Peer', connected: true }], enable: grant,
    revoke: undefined, introduce: { introductionId: 'intro-1', status: 'pending' } };
  for (const [method, value] of Object.entries(stubs)) harness.sdk.stub(`peers.${method}`, async () => value);
  expect(await zcc.sdk.peers.localIdentity()).toEqual(stubs.localIdentity);
  expect(await zcc.sdk.peers.enrolled()).toEqual(stubs.enrolled);
  expect(await zcc.sdk.peers.features()).toEqual({ lifecycle: false, introductions: false, installer: false, invitations: false });
  expect(await zcc.sdk.peers.enable('app-b', { scope })).toEqual(grant);
  await zcc.sdk.peers.revoke('app-b', { scope });
  expect(await zcc.sdk.peers.introduce('app-c', { sponsorPeerId: 'app-b', scope })).toEqual(stubs.introduce);
  expect(harness.sdk.callsTo('peers.enable')).toEqual([['app-b', { scope }]]);
  expect(harness.sdk.callsTo('peers.revoke')).toEqual([['app-b', { scope }]]);
  expect(harness.sdk.callsTo('peers.introduce')).toEqual([['app-c', { sponsorPeerId: 'app-b', scope }]]);
  const signal = AbortSignal.abort(new Error('cancelled'));
  for (const run of [() => zcc.sdk.peers.enrolled({ signal }), () => zcc.sdk.peers.enable('app-b', { scope, signal }),
    () => zcc.sdk.peers.introduce('app-c', { sponsorPeerId: 'app-b', scope, signal })]) await expect(run()).rejects.toThrow('cancelled');
  await harness.dispose();
  for (const run of [() => zcc.sdk.peers.localIdentity(), () => zcc.sdk.peers.features(), () => zcc.sdk.peers.enrolled(),
    () => zcc.sdk.peers.enable('app-b', { scope }), () => zcc.sdk.peers.revoke('app-b', { scope }),
    () => zcc.sdk.peers.introduce('app-c', { sponsorPeerId: 'app-b', scope })]) await expect(run()).rejects.toThrow('stale');
});

it('holds per-plugin storage epochs in core, outside plugin folders, across restarts and folder wipes', async () => {
  const first = await app();
  const handle = plugin(first), other = plugin(first, 'other-plugin');
  expect(await handle.api.sdk.peers.storageEpoch!()).toBe(0);
  expect(await handle.api.sdk.peers.advanceStorageEpoch!(0)).toBe(1);
  await expect(handle.api.sdk.peers.advanceStorageEpoch!(0)).rejects.toThrow('storage epoch mismatch');
  expect(await other.api.sdk.peers.storageEpoch!()).toBe(0);
  await handle.dispose();
  await expect(handle.api.sdk.peers.storageEpoch!()).rejects.toThrow('stale');
  // Restoring or wiping the plugin folder does not roll the core counter back.
  await rm(join(first.dir, 'plugins', 'test-plugin'), { recursive: true, force: true });
  await servers.splice(servers.indexOf(first.server), 1)[0]!.close();
  const restarted = await app(first.dir, first.key);
  const again = plugin(restarted);
  expect(await again.api.sdk.peers.storageEpoch!()).toBe(1);
  expect(await again.api.sdk.peers.advanceStorageEpoch!(1)).toBe(2);
});

it('reports the storage epoch unavailable without a peer key or epoch store, and never advances from a stale context', async () => {
  const keyless = await realpath(await mkdtemp(join(tmpdir(), 'plugin-epoch-keyless-')));
  roots.push(keyless);
  const server = await startProductServer({ dataDir: keyless, origins: { serverPort: 0 } });
  servers.push(server);
  const handle = createPluginApi('test-plugin', join(keyless, 'plugins', 'test-plugin'), { productContext: server.ctx });
  handles.push(handle);
  expect(await handle.api.sdk.peers.storageEpoch!()).toBeNull();
  const bare = createPluginApi('test-plugin', join(keyless, 'plugins', 'bare'), { productContext: { ...server.ctx, pluginStorageEpochs: undefined } });
  handles.push(bare);
  expect(await bare.api.sdk.peers.storageEpoch!()).toBeNull();
  await expect(bare.api.sdk.peers.advanceStorageEpoch!(0)).rejects.toThrow('plugin storage epoch unavailable');

  const owner = await app();
  const live = plugin(owner);
  const advance = vi.spyOn(owner.server.ctx.pluginStorageEpochs!, 'advance');
  const pending = live.api.sdk.peers.advanceStorageEpoch!(0);
  await vi.waitFor(() => expect(advance).toHaveBeenCalled());
  const isLive = advance.mock.calls[0]![2]!;
  expect(isLive()).toBe(true);
  await pending;
  await live.dispose();
  expect(isLive()).toBe(false);
});

it('fake host keeps an in-memory storage epoch for plugin tests', async () => {
  const host = createFakePluginHost({ pluginId: 'test-plugin' });
  expect(await host.zcc.sdk.peers.storageEpoch!()).toBe(0);
  expect(await host.zcc.sdk.peers.advanceStorageEpoch!(0)).toBe(1);
  await expect(host.zcc.sdk.peers.advanceStorageEpoch!(0)).rejects.toThrow('storage epoch mismatch');
  host.harness.storageEpoch = null;
  expect(await host.zcc.sdk.peers.storageEpoch!()).toBeNull();
  await expect(host.zcc.sdk.peers.advanceStorageEpoch!(1)).rejects.toThrow('unavailable');
  await host.harness.dispose();
});

// ---- Plugin-neutral invitations -------------------------------------------------------------------------------
const INV_SCOPE = 'repo:alpha';
function invitationWorld() {
  const approvals = new Map<string, { pluginId: string; binding: string }>();
  const services = new Map<string, PeerInvitations>();
  /** Which instance minted an invitation's Connect code, and which invitations have an established bootstrap link. */
  const inviterOf = new Map<string, string>(), linked = new Set<string>();
  const make = async (name: string, extra: Partial<PeerInvitationsOptions> = {}) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'plugin-invite-')));
    roots.push(dir);
    const instanceId = randomUUID();
    const transport: InvitationTransport = {
      async post(link, kind, _id, body) {
        const service = services.get(link.recipientId)!, attested = { redeemerId: instanceId };
        try { return { status: 200, body: kind === 'redeem' ? await service.acceptRedeem(body, attested) : await service.acceptExchange(body, attested) }; }
        catch (error) { if (error instanceof InvitationError) return { status: 409, body: { error: error.code } }; throw error; }
      }
    };
    const links = {
      create: vi.fn(async ({ invitationId }: { invitationId: string }) => {
        inviterOf.set(invitationId, instanceId);
        const hostId = randomUUID();
        return { offer: { v: 1 as const, endpoint: { host: 'inviter.local', port: 22, user: 'inviter', hostKey: publicKeyLine(generateSeed()) },
          bootstrapSeed: generateSeed(), listenPort: 40_000, targetPort: 40_001, hostId, joinCode: `zcde_${'A'.repeat(24)}` }, expiresAt: Date.now() + 600_000 };
      }),
      redeem: vi.fn(async () => undefined)
    };
    const service = new PeerInvitations({ directory: join(dir, 'inv'), instanceId, keyProvider: { getKey: async () => Buffer.alloc(32, 7) },
      localName: () => `Computer ${name}`, transport, links,
      linkRef: invitationId => linked.has(invitationId) ? { hostId: randomUUID(), recipientId: inviterOf.get(invitationId)! } : null,
      verifyOwnerApproval: (token, pluginId, binding) => {
        const entry = typeof token === 'string' ? approvals.get(token) : undefined;
        if (!entry || entry.pluginId !== pluginId || entry.binding !== JSON.stringify(binding)) return false;
        approvals.delete(token as string);
        return true;
      }, ...extra });
    services.set(instanceId, service);
    cleanups.push(async () => { service.dispose(); await service.whenIdle(); });
    return { service, dir, links };
  };
  const sign = (pluginId: string, binding: unknown) => { const token = randomUUID(); approvals.set(token, { pluginId, binding: JSON.stringify(binding) }); return token; };
  /** The inviter's reverse link came up: the redeemer can now deliver over the bootstrap plane. */
  const connectLink = async (redeemer: PeerInvitations, invitationId: string) => { linked.add(invitationId); await redeemer.nudge(invitationId); };
  return { make, sign, connectLink };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
/** Per-test plugin root, removed after the test (never the shared OS tmpdir). */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-invite-scratch-'));
  roots.push(dir);
  return dir;
}
function inviteApi(dir: string, pluginId: string, productContext: Record<string, unknown>) {
  const handle = createPluginApi(pluginId, join(dir, 'plugins', pluginId), { productContext: { productInstanceId: randomUUID(), ...productContext } as never });
  handles.push(handle);
  return handle.api.sdk.peers;
}
const link = (over: Partial<PeerLinkView> = {}): PeerLinkView => ({ pairingId: randomUUID(), peerInstanceId: randomUUID(), pluginId: 'sync-plugin', scope: INV_SCOPE,
  role: 'inviter', phase: 'linked', state: 'connected', capability: 'peer.forward', ...over });

const SECRET_SHAPES = /zccinv1\.|secret|hostKey|joinCode|credential|consentDigest|tokenHash|locator|https:\/\//i;

it('invites, redeems and decides through the SDK with redacted projections and owner-proof-only approval', async () => {
  const w = invitationWorld();
  const a = await w.make('a'), b = await w.make('b');
  const pa = inviteApi(a.dir, 'sync-plugin', { peerInvitations: a.service }), pb = inviteApi(b.dir, 'sync-plugin', { peerInvitations: b.service });
  const created = await pa.createInvitation!({ scope: INV_SCOPE });
  expect(Object.keys(created).sort()).toEqual(['code', 'expiresAt', 'invitationId', 'token']);
  const redeemed = await pb.redeemInvitation!({ token: created.token, code: created.code });
  expect(redeemed).toMatchObject({ role: 'redeemer', state: 'redeeming', scope: INV_SCOPE, peer: { name: 'Computer a' } });
  expect(b.links.redeem).toHaveBeenCalledTimes(1);
  await w.connectLink(b.service, created.invitationId);
  expect(await pb.invitationStatus!({ invitationId: created.invitationId })).toMatchObject({ role: 'redeemer', state: 'reserved' });
  const view = await pa.invitationStatus!({ invitationId: created.invitationId });
  expect(view).toMatchObject({ role: 'inviter', state: 'reserved', peer: { name: 'Computer b' } });
  expect(await pa.invitationStatus!({ invitationId: created.invitationId, refresh: true })).toMatchObject({ state: 'reserved' });
  expect(await pb.invitationStatus!({ invitationId: created.invitationId, refresh: true })).toMatchObject({ state: 'reserved' });
  // Nothing after create may carry the token or any internal field.
  const everything = JSON.stringify([redeemed, view, await pa.listInvitations!(), await pb.listInvitations!({ limit: 5 })]);
  expect(everything).not.toMatch(SECRET_SHAPES);
  expect(everything).not.toContain(created.token);
  expect(Object.keys(view).sort()).toEqual(['consentExpiresAt', 'expiresAt', 'generation', 'invitationId', 'inviterDecision', 'localFingerprint', 'pairingId', 'peer', 'redeemerDecision', 'role', 'scope', 'state']);

  const sheet = await pa.invitationApproval!({ invitationId: created.invitationId });
  expect(sheet.title).toBe('Pair with another computer');
  expect(sheet.summary).toContain('Computer b');
  // Approve: missing, malformed, oversized, forged-binding and other-plugin proofs are all refused with the same fixed message.
  const forged = w.sign('sync-plugin', { ...sheet.binding, revision: 'x' });
  const otherPlugin = w.sign('other-plugin', sheet.binding);
  for (const ownerProof of [undefined, '', 'nope', 'x'.repeat(5000), forged, otherPlugin, 42 as never]) {
    await expect(pa.decideInvitation!({ invitationId: created.invitationId, decision: 'approved', ownerProof })).rejects.toThrow('Owner approval is required');
  }
  expect((await pa.invitationStatus!({ invitationId: created.invitationId })).inviterDecision).toBe('pending');
  const proof = w.sign('sync-plugin', sheet.binding);
  expect(await pa.decideInvitation!({ invitationId: created.invitationId, decision: 'approved', ownerProof: proof })).toMatchObject({ inviterDecision: 'approved' });
  // Proof is single-use.
  await expect(pa.decideInvitation!({ invitationId: created.invitationId, decision: 'approved', ownerProof: proof })).rejects.toThrow('not ready');
  // The redeemer consented by pasting the invitation: it has no approval sheet and cannot approve or deny again.
  await expect(pb.invitationApproval!({ invitationId: created.invitationId })).rejects.toThrow('not ready');
  await expect(pb.decideInvitation!({ invitationId: created.invitationId, decision: 'approved', ownerProof: w.sign('sync-plugin', sheet.binding) })).rejects.toThrow('not ready');
  expect((await pb.invitationStatus!({ invitationId: created.invitationId })).redeemerDecision).toBe('approved');
  await pb.cancelInvitation!({ invitationId: created.invitationId });
  await pb.cancelInvitation!({ invitationId: created.invitationId });
}, 30_000);

it('throttles plugin refresh polling to the service refresh limit', async () => {
  const w = invitationWorld();
  const a = await w.make('a'), b = await w.make('b');
  const pa = inviteApi(a.dir, 'sync-plugin', { peerInvitations: a.service }), pb = inviteApi(b.dir, 'sync-plugin', { peerInvitations: b.service });
  const created = await pa.createInvitation!({ scope: INV_SCOPE });
  await pb.redeemInvitation!({ token: created.token, code: created.code });
  // The redeemer still owes its delivery (no bootstrap link yet), so refresh may poll, but only once per interval.
  const refresh = vi.spyOn(b.service, 'refresh'), poll = vi.spyOn(b.service, 'poll');
  for (let i = 0; i < 25; i++) expect(await pb.invitationStatus!({ invitationId: created.invitationId, refresh: true })).toMatchObject({ state: 'redeeming' });
  expect(refresh).toHaveBeenCalledTimes(25);
  expect(poll.mock.calls.length).toBeLessThanOrEqual(1);
  expect(b.links.redeem.mock.calls.length).toBeLessThanOrEqual(2);
  // Without refresh the stored status is read and nothing is delivered.
  await pb.invitationStatus!({ invitationId: created.invitationId });
  expect(refresh).toHaveBeenCalledTimes(25);
});

it('cancels an open invitation without proof and isolates invitations per plugin', async () => {
  const w = invitationWorld();
  const a = await w.make('a'), b = await w.make('b');
  const mine = inviteApi(a.dir, 'sync-plugin', { peerInvitations: a.service }), other = inviteApi(a.dir, 'other-plugin', { peerInvitations: a.service });
  const theirs = inviteApi(b.dir, 'other-plugin', { peerInvitations: b.service });
  const created = await mine.createInvitation!({ scope: INV_SCOPE });
  expect(await other.listInvitations!()).toEqual([]);
  expect((await mine.listInvitations!()).map(item => item.invitationId)).toEqual([created.invitationId]);
  await expect(other.invitationStatus!({ invitationId: created.invitationId })).rejects.toThrow('Invitation not found');
  await expect(other.cancelInvitation!({ invitationId: created.invitationId })).rejects.toThrow('Invitation not found');
  await expect(other.decideInvitation!({ invitationId: created.invitationId, decision: 'denied' })).rejects.toThrow('Invitation not found');
  await expect(other.invitationApproval!({ invitationId: created.invitationId })).rejects.toThrow('Invitation not found');
  await expect(theirs.redeemInvitation!({ token: created.token, code: created.code })).rejects.toThrow('different plugin');
  expect((await mine.invitationStatus!({ invitationId: created.invitationId })).state).toBe('open');
  await mine.cancelInvitation!({ invitationId: created.invitationId });
  expect((await mine.invitationStatus!({ invitationId: created.invitationId })).state).toBe('cancelled');
  await expect(mine.invitationApproval!({ invitationId: created.invitationId })).rejects.toThrow('not ready');
});

it('rejects invalid scope, malformed arguments and unexpected keys before any invitation work', async () => {
  const create = vi.fn(), redeem = vi.fn(), decide = vi.fn();
  const peers = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { create, redeem, decide, status: vi.fn(), list: vi.fn(), cancel: vi.fn(), poll: vi.fn(), refresh: vi.fn(), approvalRequest: vi.fn() } });
  for (const bad of ['', '\u0000', 'x'.repeat(1025), 7 as never]) await expect(peers.createInvitation!({ scope: bad })).rejects.toThrow('not valid');
  await expect(peers.createInvitation!({ scope: INV_SCOPE, hostKey: 'k' } as never)).rejects.toThrow('not valid');
  await expect(peers.createInvitation!(undefined as never)).rejects.toThrow('not valid');
  for (const bad of ['', 5, 'x'.repeat(4097)]) await expect(peers.redeemInvitation!({ token: bad as never })).rejects.toThrow('not valid');
  await expect(peers.redeemInvitation!({ token: 'zccinv1.x', connectCredential: 'c' } as never)).rejects.toThrow('not valid');
  for (const run of [() => peers.invitationStatus!({ invitationId: '!' }), () => peers.invitationApproval!({ invitationId: 3 as never }),
    () => peers.cancelInvitation!({ invitationId: '' }), () => peers.peerLinks!({ peerId: '!' }), () => peers.reconnectPeer!('!'),
    () => peers.listInvitations!({ limit: 0 }), () => peers.listInvitations!({ limit: 1.5 }), () => peers.listInvitations!({ extra: 1 } as never),
    () => peers.decideInvitation!({ invitationId: randomUUID(), decision: 'maybe' as never })]) await expect(run()).rejects.toThrow();
  await expect(peers.decideInvitation!({ invitationId: randomUUID(), decision: 'approved' })).rejects.toThrow('Owner approval is required');
  expect([create, redeem, decide].every(fn => fn.mock.calls.length === 0)).toBe(true);
});

it('projects an ssh refusal with the ssh_* code as both reason and message', async () => {
  const id = randomUUID();
  const status = { invitationId: id, role: 'redeemer', scope: INV_SCOPE, state: 'failed', reason: 'ssh_unreachable', localFingerprint: 'f', inviterDecision: 'pending',
    redeemerDecision: 'pending', generation: 0, expiresAt: Date.now() + 60_000 };
  const refuse = async () => { throw new InvitationError('ssh_unreachable'); };
  const peers = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { create: vi.fn(), redeem: refuse, status: async () => status, list: vi.fn(), poll: async () => status, refresh: async () => status,
    decide: vi.fn(), cancel: vi.fn(), approvalRequest: vi.fn() } });
  expect(await peers.invitationStatus!({ invitationId: id, refresh: true })).toMatchObject({ state: 'failed', reason: 'ssh_unreachable' });
  const error = await peers.redeemInvitation!({ token: 'zccinv1.' + Buffer.from('{}').toString('base64url'), code: 'ABCD-EFGH' }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(InvitationError);
  expect(error).toMatchObject({ code: 'ssh_unreachable', message: 'ssh_unreachable' });
});

it('maps unknown failures to a fixed message so tokens and secrets never reach plugin errors', async () => {
  const leaky = 'zccinv1.SECRETPAYLOAD hostKey=abc credential=def';
  const fail = async () => { throw new Error(leaky); };
  const peers = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { create: fail, redeem: fail, status: fail, list: fail, poll: fail, refresh: fail, decide: fail, cancel: fail, approvalRequest: fail },
    peerLinks: { links: fail, rotate: fail, release: fail } });
  const token = 'zccinv1.' + Buffer.from('{}').toString('base64url');
  const id = randomUUID();
  const errors: unknown[] = [];
  for (const run of [() => peers.createInvitation!({ scope: INV_SCOPE }), () => peers.redeemInvitation!({ token, code: 'ABCD-EFGH' }), () => peers.invitationStatus!({ invitationId: id }),
    () => peers.invitationStatus!({ invitationId: id, refresh: true }), () => peers.listInvitations!(), () => peers.invitationApproval!({ invitationId: id }),
    () => peers.decideInvitation!({ invitationId: id, decision: 'approved', ownerProof: 'p' }), () => peers.cancelInvitation!({ invitationId: id }),
    () => peers.peerLinks!(), () => peers.reconnectPeer!(id)]) errors.push(await run().then(() => null, (error: unknown) => error));
  for (const error of errors) {
    expect(error).toBeInstanceOf(InvitationError);
    expect((error as Error).message).toBe('Invitations are unavailable');
    expect(JSON.stringify([(error as Error).message, (error as Error).stack?.split('\n')[0]])).not.toMatch(/SECRET|hostKey|credential=/);
  }
  // Redeeming a malformed token through the real service also yields only a fixed message.
  const real = invitationWorld(), a = await real.make('a');
  const realPeers = inviteApi(a.dir, 'sync-plugin', { peerInvitations: a.service });
  await expect(realPeers.redeemInvitation!({ token: 'zccinv1.SECRETPAYLOAD', code: 'ABCD-EFGH' })).rejects.toThrow('This invitation is not valid');
  await expect(realPeers.redeemInvitation!({ token: 'zccinv1.SECRETPAYLOAD', code: 'ABCD-EFGH' })).rejects.not.toThrow(/SECRETPAYLOAD/);
});

it('logs a sanitised diagnostic server-side when a non-Invitation error is reported as unavailable', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const fail = async () => { throw Object.assign(new TypeError('zccinv1.SECRETPAYLOAD hostKey=abc'), { code: 'EBOOM' }); };
  const peers = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { list: fail } });
  await expect(peers.listInvitations!()).rejects.toThrow('Invitations are unavailable');
  expect(log).toHaveBeenCalledTimes(1);
  const line = String(log.mock.calls[0]![0]);
  expect(line).toMatch(/name=TypeError code=EBOOM at=at /);
  expect(line).not.toMatch(/SECRET|hostKey/);
  // A fixed-message InvitationError is expected and not logged.
  const refuse = async () => { throw new InvitationError('not_ready'); };
  const quiet = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { list: refuse } });
  await expect(quiet.listInvitations!()).rejects.toBeInstanceOf(InvitationError);
  expect(log).toHaveBeenCalledTimes(1);
});

it('cancels an invitation minted for a caller that aborted after create resolved, logging cancel failures', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const controller = new AbortController(), invitationId = randomUUID();
  const create = vi.fn(async () => { controller.abort(new Error('caller cancelled')); return { invitationId, token: 'zccinv1.SECRET', expiresAt: 1 }; });
  const cancel = vi.fn(async () => { throw Object.assign(new Error('hostKey=abc'), { code: 'ECANCEL' }); });
  const peers = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { create, cancel } });
  await expect(peers.createInvitation!({ scope: INV_SCOPE, signal: controller.signal })).rejects.toThrow('caller cancelled');
  expect(cancel).toHaveBeenCalledExactlyOnceWith({ pluginId: 'sync-plugin', invitationId });
  expect(log).toHaveBeenCalledOnce();
  expect(String(log.mock.calls[0]![0])).toMatch(/code=ECANCEL/);
  expect(String(log.mock.calls[0]![0])).not.toMatch(/hostKey/);
  // A create that never resolved leaves nothing to cancel.
  const failing = inviteApi(scratch(), 'sync-plugin', { peerInvitations: { create: async () => { throw new InvitationError('not_ready'); }, cancel } });
  await expect(failing.createInvitation!({ scope: INV_SCOPE })).rejects.toBeInstanceOf(InvitationError);
  expect(cancel).toHaveBeenCalledOnce();
});

it('enrolled() keeps listing past an unexpected per-peer failure and logs it without the message', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const dir = scratch(), db = openDatabase(join(dir, 'hosts.sqlite'));
  cleanups.push(async () => db.close());
  const host = upsertHost(db, { name: 'Peer machine', hostKeyHash: 'hash', homeDir: '/home' });
  const broken = randomUUID(), offline = randomUUID(), good = randomUUID();
  const remote = vi.fn(async (id: string) => {
    if (id === broken) throw Object.assign(new TypeError('hostKey=SECRET'), { code: 'EODD' });
    return { remoteInstanceId: id, hostId: host.id, hostKey: 'k'.repeat(32), capability: 'peer.forward' as const };
  });
  const peers = inviteApi(dir, 'sync-plugin', { db, hostHub: { getSession: () => ({}) },
    peerChannels: { list: async () => [broken, offline, good].map(remoteInstanceId => ({ remoteInstanceId, capability: 'peer.forward' })), remote },
    peerAuthority: { resolveHost: async (id: string) => id === good ? host.id : null } });
  expect(await peers.enrolled()).toEqual([{ id: good, hostId: host.id, name: 'Peer machine', connected: true }]);
  // Only the unexpected failure is logged; an unverified (offline) peer is the normal hidden case.
  expect(warn).toHaveBeenCalledOnce();
  expect(String(warn.mock.calls[0]![0])).toMatch(/name=TypeError code=EODD/);
  expect(String(warn.mock.calls[0]![0])).not.toMatch(/SECRET|hostKey/);
});

it('reports invitations unavailable on hosts without the service and keeps legacy lifecycle features intact', async () => {
  const peers = inviteApi(scratch(), 'sync-plugin', { peerAuthority: {} });
  expect(await peers.features()).toEqual({ lifecycle: true, introductions: true, installer: false, invitations: false });
  await expect(peers.createInvitation!({ scope: INV_SCOPE })).rejects.toThrow('Invitations are unavailable');
  await expect(peers.peerLinks!()).rejects.toThrow('Invitations are unavailable');
  expect(typeof peers.enrolled).toBe('function');
  const withService = inviteApi(scratch(), 'sync-plugin', { peerAuthority: {}, peerInvitations: {} });
  expect((await withService.features()).invitations).toBe(true);
  // Fake host: invitations are stubbed per test and report unsupported by default.
  const { zcc, harness } = createFakePluginHost();
  expect(await zcc.sdk.peers.features()).toMatchObject({ invitations: false });
  expect(await zcc.sdk.peers.listInvitations!()).toEqual([]);
  expect(await zcc.sdk.peers.peerLinks!()).toEqual([]);
  const status = { invitationId: 'i', role: 'inviter', scope: INV_SCOPE, state: 'open', localFingerprint: 'f', inviterDecision: 'pending', redeemerDecision: 'pending', generation: 1, expiresAt: 1 };
  const stubs: Record<string, unknown> = { createInvitation: { invitationId: 'i', token: 't', expiresAt: 1 }, redeemInvitation: status, invitationStatus: status,
    invitationApproval: { binding: {}, title: 't' }, decideInvitation: status, cancelInvitation: undefined, reconnectPeer: [] };
  for (const [name, value] of Object.entries(stubs)) harness.sdk.stub(`peers.${name}`, async () => value);
  expect(await zcc.sdk.peers.createInvitation!({ scope: INV_SCOPE })).toEqual(stubs.createInvitation);
  expect(await zcc.sdk.peers.redeemInvitation!({ token: 't' })).toEqual(status);
  expect(await zcc.sdk.peers.invitationStatus!({ invitationId: 'i' })).toEqual(status);
  expect(await zcc.sdk.peers.invitationApproval!({ invitationId: 'i' })).toEqual(stubs.invitationApproval);
  expect(await zcc.sdk.peers.decideInvitation!({ invitationId: 'i', decision: 'approved', ownerProof: 'p' })).toEqual(status);
  await zcc.sdk.peers.cancelInvitation!({ invitationId: 'i' });
  expect(await zcc.sdk.peers.reconnectPeer!('p')).toEqual([]);
  expect(harness.sdk.callsTo('peers.decideInvitation')).toEqual([[{ invitationId: 'i', decision: 'approved', ownerProof: 'p' }]]);
  const signal = AbortSignal.abort(new Error('cancelled'));
  for (const run of [() => zcc.sdk.peers.createInvitation!({ scope: INV_SCOPE, signal }), () => zcc.sdk.peers.redeemInvitation!({ token: 't', signal }),
    () => zcc.sdk.peers.invitationStatus!({ invitationId: 'i', signal }), () => zcc.sdk.peers.listInvitations!({ signal }),
    () => zcc.sdk.peers.invitationApproval!({ invitationId: 'i', signal }), () => zcc.sdk.peers.decideInvitation!({ invitationId: 'i', decision: 'denied', signal }),
    () => zcc.sdk.peers.cancelInvitation!({ invitationId: 'i', signal }), () => zcc.sdk.peers.peerLinks!({ signal }),
    () => zcc.sdk.peers.reconnectPeer!('p', { signal })]) await expect(run()).rejects.toThrow('cancelled');
  await harness.dispose();
  for (const run of [() => zcc.sdk.peers.createInvitation!({ scope: INV_SCOPE }), () => zcc.sdk.peers.redeemInvitation!({ token: 't' }),
    () => zcc.sdk.peers.invitationStatus!({ invitationId: 'i' }), () => zcc.sdk.peers.listInvitations!(), () => zcc.sdk.peers.invitationApproval!({ invitationId: 'i' }),
    () => zcc.sdk.peers.decideInvitation!({ invitationId: 'i', decision: 'denied' }), () => zcc.sdk.peers.cancelInvitation!({ invitationId: 'i' }),
    () => zcc.sdk.peers.peerLinks!(), () => zcc.sdk.peers.reconnectPeer!('p')]) await expect(run()).rejects.toThrow('stale');
});

it('honours abort and stale contexts; a create that completes after dispose is cancelled, not leaked', async () => {
  const w = invitationWorld();
  const a = await w.make('a');
  const handle = createPluginApi('sync-plugin', join(a.dir, 'plugins', 'sync-plugin'), { productContext: { productInstanceId: randomUUID(), peerInvitations: a.service } as never });
  handles.push(handle);
  const peers = handle.api.sdk.peers;
  const pre = AbortSignal.abort(new Error('pre-cancelled'));
  await expect(peers.createInvitation!({ scope: INV_SCOPE, signal: pre })).rejects.toThrow('pre-cancelled');
  await expect(peers.redeemInvitation!({ token: 'zccinv1.x', code: 'ABCD-EFGH', signal: pre })).rejects.toThrow('pre-cancelled');
  await expect(peers.listInvitations!({ signal: pre })).rejects.toThrow('pre-cancelled');
  expect(await a.service.list({ pluginId: 'sync-plugin' })).toEqual([]);
  // Dispose while create is in flight.
  const create = a.service.create.bind(a.service);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(a.service, 'create').mockImplementationOnce(async args => { await held; return create(args); });
  const pending = expect(peers.createInvitation!({ scope: INV_SCOPE })).rejects.toThrow('stale');
  await handle.dispose();
  release();
  await pending;
  await vi.waitFor(async () => {
    const [only] = await a.service.list({ pluginId: 'sync-plugin' });
    expect(only?.state).toBe('cancelled');
  });
  await expect(peers.invitationStatus!({ invitationId: randomUUID() })).rejects.toThrow('stale');
  await expect(peers.peerLinks!()).rejects.toThrow('stale');
  // Abort while a request is in flight surfaces the caller's reason, not a service error.
  const live = inviteApi(a.dir, 'sync-plugin', { peerInvitations: a.service });
  const controller = new AbortController();
  vi.spyOn(a.service, 'list').mockImplementationOnce(async () => { controller.abort(new Error('mid-flight')); return []; });
  await expect(live.listInvitations!({ signal: controller.signal })).rejects.toThrow('mid-flight');
});

it('copies the peer name through the plugin link projection only when the link has one', async () => {
  const named = link({ peerName: 'Bob\'s Mac' });
  const older = link();
  const peers = inviteApi(scratch(), 'sync-plugin', { peerLinks: { links: vi.fn(async () => [named, older]) } });
  const projected = await peers.peerLinks!();
  expect(projected.find(item => item.peerInstanceId === named.peerInstanceId)).toMatchObject({ peerName: 'Bob\'s Mac' });
  expect(projected.find(item => item.peerInstanceId === older.peerInstanceId)).not.toHaveProperty('peerName');
});

it('projects only this plugin\'s peer links, rotates owned peers only, and ties revoke to link release', async () => {
  const mine = link({ pairingId: 'p1', peerInstanceId: randomUUID(), reason: 'peer-offline', state: 'reconnecting', retryInMs: 500, credentialExpiresAt: 99, failure: 'unreachable' });
  const theirs = link({ pluginId: 'other-plugin', peerInstanceId: randomUUID() });
  const all = [mine, theirs];
  const release = vi.fn(async () => true);
  const rotate = vi.fn(async (peer: string) => all.filter(item => item.peerInstanceId === peer));
  const peerLinks = { links: vi.fn(async (peer?: string) => all.filter(item => !peer || item.peerInstanceId === peer)), rotate, release };
  const revokeProposals = vi.fn(async () => []);
  const ctx = { peerLinks, peerAuthority: { proposals: revokeProposals, revoke: vi.fn() } };
  const peers = inviteApi(scratch(), 'sync-plugin', ctx);
  const other = inviteApi(scratch(), 'other-plugin', ctx);
  const projected = await peers.peerLinks!();
  expect(projected).toEqual([{ pairingId: 'p1', peerInstanceId: mine.peerInstanceId, scope: INV_SCOPE, role: 'inviter', phase: 'linked', state: 'reconnecting',
    reason: 'peer-offline', failure: 'unreachable', retryInMs: 500 }]);
  // The Connect machine credential never expires; the internal code expiry is not a credential expiry.
  expect(JSON.stringify(projected)).not.toMatch(/pluginId|capability|credentialExpiresAt/);
  expect(await peers.peerLinks!({ peerId: theirs.peerInstanceId })).toEqual([]);
  expect(await peers.reconnectPeer!(mine.peerInstanceId)).toHaveLength(1);
  await expect(peers.reconnectPeer!(theirs.peerInstanceId)).rejects.toThrow('Invitation not found');
  await expect(peers.reconnectPeer!(randomUUID())).rejects.toThrow('Invitation not found');
  expect(rotate).toHaveBeenCalledTimes(1);
  expect(rotate).toHaveBeenCalledWith(mine.peerInstanceId);
  expect((await other.peerLinks!()).map(item => item.peerInstanceId)).toEqual([theirs.peerInstanceId]);
  // Revoke releases only this plugin's binding for that scope; the link store decides whether the link itself goes.
  await other.revoke(mine.peerInstanceId, { scope: INV_SCOPE });
  expect(release).toHaveBeenLastCalledWith(mine.peerInstanceId, 'other-plugin', INV_SCOPE);
  await peers.revoke(mine.peerInstanceId, { scope: 'another-scope' });
  expect(release).toHaveBeenLastCalledWith(mine.peerInstanceId, 'sync-plugin', 'another-scope');
  await peers.revoke(mine.peerInstanceId, { scope: INV_SCOPE });
  expect(release).toHaveBeenLastCalledWith(mine.peerInstanceId, 'sync-plugin', INV_SCOPE);
  expect(release).toHaveBeenCalledTimes(3);
});

it('lists execution machines only, names plugin-link peers by their owner record, and hides links claimed only by other plugins', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plugin-hosts-')));
  roots.push(dir);
  const db = openDatabase(join(dir, 'zcc.db'));
  const execution = upsertHost(db, { id: randomUUID(), name: 'Build box', hostKeyHash: 'a'.repeat(64) });
  const forward = upsertHost(db, { id: randomUUID(), name: 'Zana peer link: Laptop (sync only)', hostKeyHash: 'b'.repeat(64), enrollmentCapability: 'peer.forward' });
  const foreign = upsertHost(db, { id: randomUUID(), name: 'Zana peer link: Desk (sync only)', hostKeyHash: 'c'.repeat(64), enrollmentCapability: 'peer.forward' });
  addHostLinkUse(db, forward.id, { pluginId: 'sync-plugin', scope: INV_SCOPE, label: 'Sync Plugin' });
  addHostLinkUse(db, foreign.id, { pluginId: 'other-plugin', scope: INV_SCOPE, label: 'Other' });
  const byHost = new Map([[execution.id, randomUUID()], [forward.id, randomUUID()], [foreign.id, randomUUID()]]);
  const channels = [...byHost].map(([hostId, remoteInstanceId]) => ({ remoteInstanceId, hostId, capability: hostId === execution.id ? 'execution' : 'peer.forward' }));
  const ctx = {
    db,
    hostHub: { getSession: () => ({}), connectedHostIds: () => [...byHost.keys()] },
    peerChannels: { list: async () => channels, remote: async (peer: string) => channels.find(channel => channel.remoteInstanceId === peer) ?? null },
    peerAuthority: { resolveHost: async (peer: string, hostIds: string[]) => hostIds.find(hostId => byHost.get(hostId) === peer) ?? null },
    peerPairs: { list: async () => [...byHost].map(([targetHostId, remoteInstanceId], epoch) => ({ remoteInstanceId, targetHostId, scope: INV_SCOPE, epoch, pairId: randomUUID() })) },
    peerLinkDirectory: { describe: (hostId: string) => hostId === forward.id ? { peerInstanceId: byHost.get(forward.id)!, peerName: 'Laptop', state: 'linked' } : undefined }
  };
  const handle = createPluginApi('sync-plugin', join(scratch(), 'plugins', 'sync-plugin'), { productContext: { productInstanceId: randomUUID(), ...ctx } as never });
  handles.push(handle);
  try {
    expect(await handle.api.sdk.hosts.list()).toEqual([{ id: execution.id, name: 'Build box' }]);
    expect((await handle.api.sdk.peers.enrolled()).map(peer => [peer.hostId, peer.name])).toEqual([[execution.id, 'Build box'], [forward.id, 'Laptop']]);
    // Grant names: the owner record names its link; a link nobody describes falls back to its stored name.
    expect((await handle.api.sdk.peers.list()).map(peer => peer.name)).toEqual(['Build box', 'Laptop', 'Zana peer link: Desk (sync only)']);
    // An unclaimed (legacy) link with no uses stays visible so it can still be enabled or removed.
    removeHostLinkUse(db, foreign.id, 'other-plugin');
    expect((await handle.api.sdk.peers.enrolled()).map(peer => peer.hostId)).toEqual([execution.id, forward.id, foreign.id]);
  } finally { db.close(); }
});

it('setPeerLinkNote: a plugin annotates only live links it owns, with validated, bounded notes cleared on revoke and dispose', async () => {
  const mine = link({ peerInstanceId: randomUUID() });
  const theirs = link({ pluginId: 'other-plugin', peerInstanceId: randomUUID() });
  const gone = link({ peerInstanceId: randomUUID(), phase: 'removed' });
  const all = [mine, theirs, gone];
  const peerLinkNotes = new PluginLinkNotes();
  const ctx = { peerLinkNotes, peerLinks: { links: vi.fn(async (peer?: string) => all.filter(item => !peer || item.peerInstanceId === peer)), rotate: vi.fn(), release: vi.fn(async () => true) },
    peerAuthority: { proposals: vi.fn(async () => []), revoke: vi.fn() } };
  const handle = createPluginApi('sync-plugin', join(scratch(), 'plugins', 'sync-plugin'), { productContext: { productInstanceId: randomUUID(), ...ctx } as never });
  handles.push(handle);
  const peers = handle.api.sdk.peers;
  const note = { state: 'attention', label: 'Sync not set up', detail: 'x' } as const;
  await peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note });
  expect(peerLinkNotes.get('sync-plugin', mine.peerInstanceId, INV_SCOPE)).toEqual(note);
  // Another plugin's link, an unknown peer, a wrong scope and a removed link all read as not found and store nothing.
  for (const [peer, scope] of [[theirs.peerInstanceId, INV_SCOPE], [randomUUID(), INV_SCOPE], [mine.peerInstanceId, 'other-scope'], [gone.peerInstanceId, INV_SCOPE]] as const) {
    await expect(peers.setPeerLinkNote!(peer, { scope, note })).rejects.toThrow('Invitation not found');
    expect(peerLinkNotes.get('sync-plugin', peer, scope)).toBeUndefined();
  }
  expect(peerLinkNotes.get('other-plugin', theirs.peerInstanceId, INV_SCOPE)).toBeUndefined();
  // Validation happens before any link lookup.
  const lookups = ctx.peerLinks.links.mock.calls.length;
  for (const bad of [{ state: 'bad', label: 'x' }, { state: 'ok', label: '' }, { state: 'ok', label: 'x', extra: 1 }, undefined, 'x']) {
    await expect(peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note: bad as never })).rejects.toThrow('not valid');
  }
  await expect(peers.setPeerLinkNote!('!', { scope: INV_SCOPE, note })).rejects.toThrow('not valid');
  await expect(peers.setPeerLinkNote!(mine.peerInstanceId, { scope: '', note })).rejects.toThrow('not valid');
  await expect(peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note, extra: 1 } as never)).rejects.toThrow('not valid');
  expect(ctx.peerLinks.links.mock.calls.length).toBe(lookups);
  // Null clears; a stale note is cleared even when the link has vanished.
  await peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note: null });
  expect(peerLinkNotes.size).toBe(0);
  peerLinkNotes.set('sync-plugin', gone.peerInstanceId, INV_SCOPE, note);
  await expect(peers.setPeerLinkNote!(gone.peerInstanceId, { scope: INV_SCOPE, note: null })).rejects.toThrow('Invitation not found');
  expect(peerLinkNotes.size).toBe(0);
  // Revoke drops the note for that scope.
  await peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note });
  await peers.revoke(mine.peerInstanceId, { scope: INV_SCOPE });
  expect(peerLinkNotes.size).toBe(0);
  // The cap is refused with a fixed reason; another plugin's notes are untouched.
  peerLinkNotes.set('other-plugin', theirs.peerInstanceId, INV_SCOPE, note);
  for (let i = 0; i < NOTES_PER_PLUGIN_MAX; i++) peerLinkNotes.set('sync-plugin', `peer-${i}`, 's', note);
  await expect(peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note })).rejects.toThrow();
  // Dispose (plugin stop / uninstall) clears only this plugin's notes.
  await handle.dispose();
  expect(peerLinkNotes.size).toBe(1);
  expect(peerLinkNotes.get('other-plugin', theirs.peerInstanceId, INV_SCOPE)).toEqual(note);
  await expect(peers.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note })).rejects.toThrow('stale');
});

it('setPeerLinkNote reports unavailable without a notes store or invitation links', async () => {
  const mine = link({ peerInstanceId: randomUUID() });
  const withoutStore = inviteApi(scratch(), 'sync-plugin', { peerLinks: { links: vi.fn(async () => [mine]) } });
  await expect(withoutStore.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note: { state: 'ok', label: 'x' } })).rejects.toThrow('unavailable');
  const withoutLinks = inviteApi(scratch(), 'sync-plugin', { peerLinkNotes: new PluginLinkNotes() });
  await expect(withoutLinks.setPeerLinkNote!(mine.peerInstanceId, { scope: INV_SCOPE, note: null })).rejects.toThrow('unavailable');
});

function connectionsWorld(over: { uses?: Record<string, unknown> } = {}) {
  const mine = link({ peerName: 'Laptop' });
  const other = link({ pluginId: 'other-plugin', peerName: 'Desk', state: 'reconnecting' });
  const bare = link({ pluginId: undefined, scope: undefined, peerName: undefined });
  const pending = link({ phase: 'pending' });
  const all = [mine, other, bare, pending];
  const registry = new PeerConnectionRegistry();
  const release = vi.fn(async () => true);
  const ctx = { peerConnections: registry, peerLinks: { links: vi.fn(async (peer?: string) => all.filter(item => !peer || item.peerInstanceId === peer)), rotate: vi.fn(), release },
    ...over.uses };
  const handle = createPluginApi('sync-plugin', join(scratch(), 'plugins', 'sync-plugin'), { productContext: { productInstanceId: randomUUID(), ...ctx } as never });
  handles.push(handle);
  return { mine, other, bare, pending, registry, release, ctx, connections: handle.api.sdk.peers.connections! };
}

it('connections.list returns every linked computer with only the whitelisted fields', async () => {
  const w = connectionsWorld();
  const rows = await w.connections.list();
  expect(rows).toHaveLength(3);
  expect(rows).toContainEqual({ computerId: w.mine.peerInstanceId, hostname: 'Laptop', state: 'connected', usedByThisPlugin: true });
  expect(rows).toContainEqual({ computerId: w.other.peerInstanceId, hostname: 'Desk', state: 'reconnecting', usedByThisPlugin: false });
  expect(rows).toContainEqual({ computerId: w.bare.peerInstanceId, hostname: 'Computer', state: 'connected', usedByThisPlugin: false });
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(['computerId', 'hostname', 'state', 'usedByThisPlugin']);
  expect(JSON.stringify(rows)).not.toContain('other-plugin');
});

it('connections.list marks a use granted through the use seam', async () => {
  const has = vi.fn(async (_plugin: string, computer: string) => computer === 'x');
  const w = connectionsWorld({ uses: { peerConnectionUses: { has, request: vi.fn(), stop: vi.fn() } } });
  const rows = await w.connections.list();
  expect(rows.find(row => row.computerId === w.bare.peerInstanceId)?.usedByThisPlugin).toBe(false);
  expect(has).toHaveBeenCalledWith('sync-plugin', w.bare.peerInstanceId);
});

it('connections.requestUse refuses unknown computers and a missing approval layer, and relays the seam decision', async () => {
  const w = connectionsWorld();
  await expect(w.connections.requestUse(randomUUID())).rejects.toThrow('not connected');
  await expect(w.connections.requestUse('bad id!')).rejects.toThrow('not connected');
  await expect(w.connections.requestUse(w.bare.peerInstanceId)).rejects.toThrow('not available yet');
  const request = vi.fn(async () => 'pending' as const);
  const v = connectionsWorld({ uses: { peerConnectionUses: { has: vi.fn(async () => false), request, stop: vi.fn() } } });
  expect(await v.connections.requestUse(v.bare.peerInstanceId)).toEqual({ status: 'pending' });
  expect(request).toHaveBeenCalledWith('sync-plugin', v.bare.peerInstanceId, expect.any(AbortSignal));
});

it('connections.stopUsing releases only this plugin\'s uses and never removes the link', async () => {
  const stop = vi.fn(async () => undefined);
  const w = connectionsWorld({ uses: { peerConnectionUses: { has: vi.fn(async () => false), request: vi.fn(), stop } } });
  w.registry.setStatus('sync-plugin', w.mine.peerInstanceId, 'busy');
  await w.connections.stopUsing(w.mine.peerInstanceId);
  expect(w.release).toHaveBeenCalledWith(w.mine.peerInstanceId, 'sync-plugin', INV_SCOPE);
  expect(w.release).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledWith('sync-plugin', w.mine.peerInstanceId);
  expect(w.registry.statusOf('sync-plugin', w.mine.peerInstanceId)).toBeUndefined();
  expect((w.ctx.peerLinks as { remove?: unknown }).remove).toBeUndefined();
  await expect(w.connections.stopUsing(randomUUID())).rejects.toThrow('not connected');
});

it('connections.onChange delivers the plugin\'s list and is released on dispose; onConnectionRemoving is single and released', async () => {
  const w = connectionsWorld();
  const seen = vi.fn();
  w.connections.onChange(seen);
  w.registry.notifyChanged();
  await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  expect(seen.mock.calls[0]![0]).toHaveLength(3);
  const handler = vi.fn(async () => undefined);
  const off = w.connections.onConnectionRemoving(handler);
  expect(() => w.connections.onConnectionRemoving(vi.fn())).toThrow('only one');
  await w.registry.runRemoving(w.mine.peerInstanceId);
  expect(handler).toHaveBeenCalledWith(w.mine.peerInstanceId);
  off();
  await w.registry.runRemoving(w.mine.peerInstanceId);
  expect(handler).toHaveBeenCalledTimes(1);
  w.connections.onConnectionRemoving(handler);
  await handles.at(-1)!.dispose();
  w.registry.notifyChanged();
  await w.registry.runRemoving(w.mine.peerInstanceId);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledTimes(1);
});

it('connections.setStatus validates and stores per plugin', async () => {
  const w = connectionsWorld();
  w.connections.setStatus(w.mine.peerInstanceId, 'Syncing');
  expect(w.registry.statusOf('sync-plugin', w.mine.peerInstanceId)).toBe('Syncing');
  expect(() => w.connections.setStatus('bad id!', 'x')).toThrow();
  w.connections.setStatus(w.mine.peerInstanceId, null);
  expect(w.registry.statusOf('sync-plugin', w.mine.peerInstanceId)).toBeUndefined();
});

it('records active use only for a peers.call that completed; failed calls do not count', async () => {
  const { a, handle, peerId } = await pair();
  await handle.api.sdk.peers.enable(peerId, { scope });
  const active = a.server.ctx.peerActiveUse!;
  const rpc = vi.spyOn(a.server.ctx.hostHub, 'callHostOnlineRpc');
  for (const reply of [{ status: 500, body: '{}' }, { status: 200, body: '{"ok":false}' }, { status: 200, body: 'nope' }]) {
    rpc.mockResolvedValueOnce(reply as never);
    await expect(handle.api.sdk.peers.call(peerId, 'echo', {}, { scope })).rejects.toThrow();
  }
  expect(active.isActive('test-plugin', peerId)).toBe(false);
  rpc.mockResolvedValueOnce({ status: 200, body: '{"ok":true,"result":7}' } as never);
  await expect(handle.api.sdk.peers.call(peerId, 'echo', {}, { scope })).resolves.toBe(7);
  expect(active.isActive('test-plugin', peerId)).toBe(true);
  expect(active.isActive('other-plugin', peerId)).toBe(false);
}, 40_000);
