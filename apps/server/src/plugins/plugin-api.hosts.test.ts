import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { PeerForwardCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPluginApi } from './plugin-api.js';
import type { ProductHttpContext } from '../http/product-context.js';
import { PairStore, type PeerRequestEnvelope } from '../services/peers/pair-store.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-plugin-hosts-')));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(join(dir, 'test.sqlite'));
  cleanup.push(() => db.close());
  const authority = Object.freeze({ channel: 'authenticated-test-channel' });
  const channelKey = Buffer.alloc(32, 42);
  const authorizeTransfer = vi.fn(async (context: unknown) => context === authority ? channelKey : null);
  const a = new PairStore(join(dir, 'a'), { localInstanceId: 'app-a', keyProvider: { getKey: async () => Buffer.alloc(32, 31) }, authorizeTransfer });
  const b = new PairStore(join(dir, 'b'), { localInstanceId: 'app-b', keyProvider: { getKey: async () => Buffer.alloc(32, 32) }, authorizeTransfer });
  cleanup.push(() => { a.dispose(); b.dispose(); });
  const call = vi.fn(async (_input: Parameters<ProductHttpContext['hostHub']['callHostOnlineRpc']>[0]) =>
    ({ status: 200, body: '{"ok":true,"result":{"accepted":true}}' }));
  const connected = vi.fn(() => [] as string[]);
  const productContext = { db, peerPairs: a, hostHub: { connectedHostIds: connected, callHostOnlineRpc: call } } as unknown as ProductHttpContext;
  const handle = createPluginApi('test-hosts', dir, { productContext });
  const other = createPluginApi('other-plugin', dir, { productContext });
  const bare = createPluginApi('bare-hosts', dir);
  cleanup.push(async () => { await handle.dispose(); await other.dispose(); await bare.dispose(); });
  const grant = { pairId: 'pair-a', localInstanceId: 'app-a', remoteInstanceId: 'app-b', pluginId: 'test-hosts',
    scope: 'opaque-repo-1', targetHostId: 'host-b', epoch: 1, proposalId: 'proposal-1' };
  async function pair(targetHostId: string) {
    const forward = { ...grant, targetHostId };
    const reverse = { ...grant, localInstanceId: 'app-b', remoteInstanceId: 'app-a', targetHostId: 'host-a' };
    await a.propose(forward);
    const bundle = await a.exportCredential(grant.pairId, authority);
    expect(bundle.subarray(0, 4).toString()).toBe('ZCP2');
    expect(bundle.includes(Buffer.from(grant.scope))).toBe(false);
    await b.importCredential(reverse, bundle, authority);
    await a.importCredential(forward, await b.exportCredential(grant.pairId, authority), authority);
    await a.activate(grant.pairId, grant.proposalId, grant.epoch);
    await b.activate(grant.pairId, grant.proposalId, grant.epoch);
    expect(authorizeTransfer.mock.calls.every(([context]) => context === authority)).toBe(true);
    expect(readFileSync(join(dir, 'a', 'pairs-v2.bin')).includes(Buffer.from(grant.scope))).toBe(false);
  }
  const authenticate = (envelope: PeerRequestEnvelope, body: string) => b.authenticateRequest({ envelope,
    body: Buffer.from(body), pluginId: envelope.pluginId, scope: envelope.scope, route: envelope.route, httpMethod: 'POST' });
  return { dir, db, a, b, handle, other, bare, call, connected, grant, pair, authenticate, productContext };
}

it.each(['enrolled', 'enable'] as const)('%s resolves a connected peer.forward plugin-link host', async method => {
  const { db, handle, productContext, grant } = await fixture();
  const host = upsertHost(db, { name: 'Peer link', hostKeyHash: 'link-hash', enrollmentCapability: 'peer.forward' });
  const proposal = { ...grant, targetHostId: host.id };
  const resolveHost = vi.fn(async (_peerId: string, hostIds: string[]) => hostIds.includes(host.id) ? host.id : null);
  productContext.peerChannels = { remote: async () => ({ capability: 'peer.forward' }),
    list: async () => [{ remoteInstanceId: grant.remoteInstanceId, capability: 'peer.forward' }] } as never;
  productContext.hostHub.getSession = vi.fn(() => ({})) as never;
  productContext.peerAuthority = { resolveHost, ensureProposal: vi.fn(async () => proposal), activate: async () => proposal } as never;
  if (method === 'enrolled') {
    await expect(handle.api.sdk.peers.enrolled()).resolves.toEqual([
      { id: grant.remoteInstanceId, hostId: host.id, name: host.name, connected: true }
    ]);
  } else {
    await expect(handle.api.sdk.peers.enable(grant.remoteInstanceId, { scope: grant.scope })).resolves.toMatchObject({ id: grant.remoteInstanceId });
    expect(productContext.peerAuthority.ensureProposal).toHaveBeenCalledWith(
      { pluginId: grant.pluginId, remoteInstanceId: grant.remoteInstanceId, targetHostId: host.id, scope: grant.scope }, expect.any(AbortSignal));
  }
  expect(resolveHost).toHaveBeenCalledWith(grant.remoteInstanceId, [host.id], expect.any(AbortSignal));
  await expect(handle.api.sdk.hosts.list()).resolves.toEqual([]);
});

it('names an authorized peer grant from its plugin-link host', async () => {
  const { db, handle, connected, pair, grant, productContext } = await fixture();
  const host = upsertHost(db, { name: 'Peer link', hostKeyHash: 'link-hash', enrollmentCapability: 'peer.forward' });
  productContext.peerLinkDirectory = { describe: () => ({ peerName: 'Ada' }) } as never;
  await pair(host.id);
  connected.mockReturnValue([host.id]);
  await expect(handle.api.sdk.peers.list()).resolves.toEqual([
    { id: grant.remoteInstanceId, name: 'Ada', scope: grant.scope, grantEpoch: grant.epoch, connected: true }
  ]);
  productContext.peerLinkDirectory = undefined;
  await expect(handle.api.sdk.peers.list()).resolves.toEqual([
    { id: grant.remoteInstanceId, name: host.name, scope: grant.scope, grantEpoch: grant.epoch, connected: true }
  ]);
  await expect(handle.api.sdk.hosts.list()).resolves.toEqual([]);
});

it('lists enrolled hosts separately from plugin-authorized app identities and respects cancellation and disposal', async () => {
    const { db, handle, other, bare, connected, pair, a, grant } = await fixture();
    await expect(handle.api.sdk.hosts.list()).resolves.toEqual([]);
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([]);
    const host = upsertHost(db, { name: 'Lab desktop', hostKeyHash: 'private-hash', homeDir: '/private/home' });
    const removed = upsertHost(db, { name: 'Removed', hostKeyHash: 'other-hash' });
    db.sqlite.prepare('UPDATE hosts SET destroyed_at = 1 WHERE id = ?').run(removed.id);
    await expect(handle.api.sdk.hosts.list()).resolves.toEqual([{ id: host.id, name: 'Lab desktop' }]);
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([]);
    await pair(host.id);
    const peer = { id: 'app-b', name: 'Lab desktop', scope: grant.scope, grantEpoch: 1, connected: false };
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([peer]);
    connected.mockReturnValue([host.id]);
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([{ ...peer, connected: true }]);
    await expect(other.api.sdk.peers.list()).resolves.toEqual([]);
    await a.propose({ ...grant, pairId: 'proposed-pair', remoteInstanceId: 'app-c', targetHostId: host.id });
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([{ ...peer, connected: true }]);
    const abort = new AbortController();
    abort.abort(new Error('cancelled'));
    await expect(handle.api.sdk.hosts.list({ signal: abort.signal })).rejects.toThrow('cancelled');
    await expect(handle.api.sdk.peers.list({ signal: abort.signal })).rejects.toThrow('cancelled');
    await expect(bare.api.sdk.hosts.list()).rejects.toThrow('not available');
    await expect(bare.api.sdk.peers.list()).rejects.toThrow('not available');
    await a.revoke(grant.pairId);
    await expect(handle.api.sdk.peers.list()).resolves.toEqual([]);
    await handle.dispose();
    await expect(handle.api.sdk.hosts.list()).rejects.toThrow(/stale/);
    await expect(handle.api.sdk.peers.list()).rejects.toThrow(/stale/);
});

it('signs exact target app, plugin, scope, route and body through the encrypted pair-store fixture', async () => {
  const { handle, other, call, pair, grant, authenticate, a, b } = await fixture();
  await pair('host-b');
  await expect(handle.api.sdk.peers.list()).resolves.toEqual([{ id: 'app-b', name: 'app-b',
    scope: grant.scope, grantEpoch: 1, connected: false }]);
  const body = { message: 'hello', count: 2 };
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', body, { scope: grant.scope, timeoutMs: 1000 }))
    .resolves.toEqual({ accepted: true });
  const input = call.mock.calls[0]![0];
  const packet = PeerForwardCommandSchema.parse(input.command);
  expect(input).toEqual({ hostId: 'host-b', timeoutMs: 6000, command: {
    protocolVersion: 2, pairId: grant.pairId, senderId: 'app-a', recipientId: 'app-b', pluginId: 'test-hosts',
    scope: grant.scope, route: '/api/v1/peer/test-hosts/handshake', httpMethod: 'POST',
    payloadHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'), signature: expect.any(String),
    nonce: expect.any(String), issuedAt: expect.any(Number), epoch: 1,
    type: 'peer.forward', method: 'handshake', body: JSON.stringify(body), timeoutMs: 1000
  } });
  const { type: _type, method: _method, body: encoded, timeoutMs: _timeout, ...envelope } = packet;
  for (const patch of [{ route: '/api/v1/peer/test-hosts/apply' },
    { pluginId: 'other-plugin', route: '/api/v1/peer/other-plugin/handshake' },
    { recipientId: 'app-c' }, { scope: 'other-scope' }, { signature: 'a'.repeat(43) }]) {
    expect(await authenticate({ ...envelope, ...patch }, encoded)).toBeNull();
  }
  expect(await authenticate(envelope, JSON.stringify({ message: 'tampered' }))).toBeNull();
  const lease = await authenticate(envelope, encoded);
  expect(lease?.grant).toMatchObject({ localInstanceId: 'app-b', remoteInstanceId: 'app-a', pluginId: 'test-hosts', scope: grant.scope });
  lease?.release();
  expect(await authenticate(envelope, encoded)).toBeNull();
  const reverse = await b.signRequest(grant.pairId, { pluginId: 'test-hosts', scope: grant.scope, method: 'apply', body: Buffer.from('{}') });
  expect(reverse).toMatchObject({ senderId: 'app-b', recipientId: 'app-a', route: '/api/v1/peer/test-hosts/apply' });
  const reverseLease = await a.authenticateRequest({ envelope: reverse!, body: Buffer.from('{}'), pluginId: 'test-hosts',
    scope: grant.scope, route: '/api/v1/peer/test-hosts/apply', httpMethod: 'POST' });
  expect(reverseLease).not.toBeNull();
  reverseLease?.release();
  await expect(other.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('not authorized');
  await expect(handle.api.sdk.peers.call('host-b', 'handshake', {})).rejects.toThrow('not authorized');
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {}, { scope: 'other' })).rejects.toThrow('not authorized');
  expect(call).toHaveBeenCalledOnce();
});
it('cancels in-flight peer calls on caller abort and grant revocation, fences disposal and denies later calls', async () => {
  const { handle, call, pair, a, grant } = await fixture();
  await pair('host-b');
  let finish!: (value: { status: number; body: string }) => void;
  call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const abort = new AbortController();
  const pending = expect(handle.api.sdk.peers.call('app-b', 'handshake', {}, { signal: abort.signal }))
    .rejects.toThrow('caller cancelled');
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
  abort.abort(new Error('caller cancelled'));
  await pending;
  finish({ status: 200, body: '{"ok":true,"result":"late"}' });
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {}, { signal: abort.signal })).rejects.toThrow('caller cancelled');
  expect(call).toHaveBeenCalledOnce();
  const revoked = expect(handle.api.sdk.peers.call('app-b', 'apply', {})).rejects.toThrow();
  await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  await a.revoke(grant.pairId);
  await revoked;
  finish({ status: 200, body: '{"ok":true,"result":"late"}' });
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('not authorized');
  await expect(handle.api.sdk.peers.list()).resolves.toEqual([]);
  expect(call).toHaveBeenCalledTimes(2);
  await handle.dispose();
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('stale');
  expect(() => handle.api.sdk.peers.handle('apply', () => null)).toThrow('stale');
});

it('rejects a completed in-flight response after plugin disposal', async () => {
  const { handle, call, pair } = await fixture();
  await pair('host-b');
  let finish!: (value: { status: number; body: string }) => void;
  call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('stale');
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
  await handle.dispose();
  finish({ status: 200, body: '{"ok":true,"result":"late"}' });
  await pending;
  await expect(handle.api.sdk.peers.list()).rejects.toThrow('stale');
});

it.each([
  { status: 403, body: '{}', error: 'peer request failed: 403' },
  { status: 200, body: '{"ok":false}', error: 'peer request was rejected' },
  { status: 200, body: '{"result":true}', error: 'peer request was rejected' },
  // The parser message is never surfaced: it can quote fragments of the peer body.
  { status: 200, body: '{"ok":true, SECRET', error: /^invalid peer response$/ },
  { status: 200, body: 'null', error: 'peer request was rejected' },
  { status: 200, body: 'x'.repeat(8 * 1024 * 1024 + 1), error: 'peer response exceeds 8 MiB' }
])('rejects invalid peer response without leaking the grant lease (status=$status)', async ({ status, body, error }) => {
  const { handle, call, pair } = await fixture();
  await pair('host-b');
  call.mockResolvedValueOnce({ status, body });
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow(error);
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).resolves.toEqual({ accepted: true });
});

it('rejects invalid requests before HostHub and validates private handler registrations', async () => {
  const { handle, bare, call, pair, a, grant } = await fixture();
  await pair('host-b');
  for (const method of ['../apply', 'a/b', 'Apply', 'a'.repeat(65)]) {
    await expect(handle.api.sdk.peers.call('app-b', method, {})).rejects.toThrow('invalid peer request');
    expect(() => handle.api.sdk.peers.handle(method, () => null)).toThrow('invalid peer handler');
  }
  for (const timeoutMs of [0, 30_001, 1.5]) {
    await expect(handle.api.sdk.peers.call('app-b', 'handshake', {}, { timeoutMs })).rejects.toThrow('invalid peer timeout');
  }
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', '\u00e9'.repeat(4 * 1024 * 1024))).rejects.toThrow('peer request exceeds 8 MiB');
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', () => null)).rejects.toThrow('invalid peer body');
  await expect(bare.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('invalid peer request');
  handle.api.sdk.peers.handle('apply', () => ({ accepted: true }));
  expect(handle.peerHandlers.has('apply')).toBe(true);
  expect(() => handle.api.sdk.peers.handle('apply', () => null)).toThrow('already registered');
  expect(() => handle.api.sdk.peers.handle('handshake', null as never)).toThrow('invalid peer handler');
  expect(call).not.toHaveBeenCalled();
  await a.create({ ...grant, pairId: 'pair-other-scope', scope: 'other-scope' });
  await expect(handle.api.sdk.peers.call('app-b', 'handshake', {})).rejects.toThrow('not authorized');
  await expect(handle.api.sdk.peers.call('app-b', 'apply', undefined, { scope: grant.scope })).resolves.toEqual({ accepted: true });
  expect(call.mock.calls[0]![0]).toMatchObject({ hostId: 'host-b', timeoutMs: 35_000,
    command: { method: 'apply', route: '/api/v1/peer/test-hosts/apply', body: '{}', timeoutMs: 30_000 } });
});

it('exposes distinct host and authorized peer lookups in the plugin test harness', async () => {
  const fake = createFakePluginHost();
  try {
    fake.harness.sdk.stub('hosts.list', async () => [{ id: 'host-1', name: 'Lab' }]);
    const peer = { id: 'app-b', name: 'Lab', scope: 'opaque-repo-1', grantEpoch: 3, connected: true };
    fake.harness.sdk.stub('peers.list', async () => [peer]);
    fake.harness.sdk.stub('peers.call', async () => ({ accepted: true }));
    await expect(fake.bb.sdk.hosts.list()).resolves.toEqual([{ id: 'host-1', name: 'Lab' }]);
    await expect(fake.bb.sdk.peers.list()).resolves.toEqual([peer]);
    await expect(fake.bb.sdk.peers.call('app-b', 'apply', {}, { scope: peer.scope })).resolves.toEqual({ accepted: true });
    const signal = AbortSignal.abort(new Error('cancelled'));
    await expect(fake.bb.sdk.hosts.list({ signal })).rejects.toThrow('cancelled');
    await expect(fake.bb.sdk.peers.list({ signal })).rejects.toThrow('cancelled');
    await expect(fake.bb.sdk.peers.call('app-b', 'apply', {}, { signal })).rejects.toThrow('cancelled');
    expect(fake.harness.sdk.callsTo('hosts.list')).toHaveLength(1);
    expect(fake.harness.sdk.callsTo('peers.list')).toHaveLength(1);
    expect(fake.harness.sdk.callsTo('peers.call')).toHaveLength(1);
    await fake.harness.dispose();
    await expect(fake.bb.sdk.hosts.list()).rejects.toThrow(/stale/);
    await expect(fake.bb.sdk.peers.list()).rejects.toThrow(/stale/);
    await expect(fake.bb.sdk.peers.call('app-b', 'apply', {})).rejects.toThrow(/stale/);
  } finally {
    await fake.harness.dispose();
  }
});
