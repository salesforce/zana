import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairStore, peerMacPayload, type PairStoreOptions, type PeerPairInput, type PeerTransferBinding } from './pair-store.js';
import { canonicalPeerMac, MAX_PEER_BODY_BYTES, MAX_PEER_STORE_BYTES, parsePeerMac, peerBodyHash, peerRoute, PrivatePeerStorage, sealPeerBytes, serializePeerStorage, unsealPeerBytes } from './peer-auth.js';
import { PEER_REQUEST_TTL_MS } from './peer-replay-window.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const directories: string[] = [];
const key = Buffer.alloc(32, 31), channelKey = Buffer.alloc(32, 42);
const context = Object.freeze({ authenticatedChannel: 'test-only' });
const grant: PeerPairInput = { pairId: 'pair-a', localInstanceId: 'instance-a', remoteInstanceId: 'instance-b',
  pluginId: 'design-docs', scope: 'opaque-repo-1', targetHostId: 'host-b', epoch: 1, proposalId: 'proposal-1' };
const reverse: PeerPairInput = { ...grant, localInstanceId: 'instance-b', remoteInstanceId: 'instance-a', targetHostId: 'host-a' };
const body = Buffer.from('{"protocol":1}');
async function fixture(extra: Partial<PairStoreOptions> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-pairs-')));
  directories.push(root);
  let now = 1_000_000;
  const authorizeTransfer = vi.fn(async (authority: unknown, binding: Readonly<PeerTransferBinding>) => {
    return authority === context && binding.pluginId === 'design-docs' ? channelKey : null;
  });
  const options: PairStoreOptions = { localInstanceId: 'instance-a', keyProvider: { getKey: async () => key },
    authorizeTransfer, now: () => now, ...extra };
  const directory = join(root, 'a');
  const a = new PairStore(directory, options), b = new PairStore(join(root, 'b'), { ...options, localInstanceId: 'instance-b' });
  async function pair() {
    await a.propose(grant);
    const bundle = await a.exportCredential('pair-a', context);
    await b.importCredential(reverse, bundle, context);
    await a.activate('pair-a', 'proposal-1', 1);
    await b.activate('pair-a', 'proposal-1', 1);
  }
  async function envelope() { return (await a.signRequest('pair-a', { pluginId: 'design-docs', scope: 'opaque-repo-1', method: 'handshake', body }))!; }
  async function authenticate(packet: Awaited<ReturnType<typeof envelope>>, target = b, overrides = {}) {
    return target.authenticateRequest({ envelope: packet, body, pluginId: 'design-docs', scope: 'opaque-repo-1',
      route: '/api/v1/peer/design-docs/handshake', httpMethod: 'POST', ...overrides });
  }
  return { root, directory, a, b, options, pair, envelope, authenticate, authorizeTransfer,
    restart: () => new PairStore(directory, options), restartB: () => new PairStore(join(root, 'b'), { ...options, localInstanceId: 'instance-b' }),
    time: (value: number) => { now = value; } };
}
afterEach(async () => { vi.mocked(fs.rename).mockReset(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('PairStore persistence and lifecycle', () => {
  it('absent revocation stores bounded ID-only tombstone, never a fake grant; restart cannot recreate epoch one', async () => {
    const f = await fixture({ maxPairs: 1 });
    await f.a.revoke('pair-a');
    const state = JSON.parse(unsealPeerBytes(await readFile(join(f.directory, 'pairs-v2.bin')), key, 'pairs-v2:instance-a').toString());
    expect(state.pairs).toEqual([]); expect(state.revokedIds).toEqual(['pair-a']);
    await expect(f.restart().create(grant)).rejects.toThrow('revoked');
    await expect(f.restart().propose(grant)).rejects.toThrow('revoked');
    await expect(f.restart().revoke('another')).rejects.toThrow('capacity');
    expect(await f.restart().grant('pair-a')).toBeNull();
  });
  it('generation guard checks after storage awaits and before synchronous apply; validator never runs under pair mutex', async () => {
    let current = true;
    const validate = vi.fn(async () => () => current);
    const f = await fixture({ validateGrant: validate }); await f.pair();
    const lease = (await f.b.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    validate.mockImplementationOnce(async () => {
      // A validator may read or revoke pair storage without a lock cycle.
      const plain = new PairStore(join(f.root, 'b'), { ...f.options, localInstanceId: 'instance-b', validateGrant: undefined });
      expect(await plain.grant('pair-a')).not.toBeNull();
      return () => current;
    });
    const original = f.options.keyProvider.getKey;
    let reads = 0;
    f.options.keyProvider.getKey = async () => { if (++reads === 3) current = false; return original(); };
    const commit = vi.fn(); await expect(lease.commitSync(commit)).rejects.toThrow('no longer active');
    expect(commit).not.toHaveBeenCalled(); expect(lease.signal.aborted).toBe(true);
  });
  it('rotation during replay save cannot return an authenticated lease', async () => {
    let current = true;
    const f = await fixture({ validateGrant: async () => () => current }); await f.pair();
    const packet = await f.envelope();
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => { current = false; return (await vi.importActual<typeof fs>('node:fs/promises')).rename(...args); });
    await expect(f.authenticate(packet)).rejects.toThrow('enrollment changed');
    expect(await f.b.grant('pair-a')).toBeNull();
  });
  it('scopes lease aborts for ordinary rejections to the affected pair', async () => {
    const f = await fixture();
    await f.a.create(grant);
    const lease = (await f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    await expect(f.a.create({ ...grant, pairId: 'pair-b', scope: 'other-scope' })).resolves.toMatchObject({ pairId: 'pair-b' });
    await expect(f.a.create({ ...grant, pairId: 'pair-b', proposalId: 'conflict' })).rejects.toThrow('conflicts');
    await expect(lease.commitSync(() => { throw new Error('plugin apply failed'); })).rejects.toThrow('plugin apply failed');
    const other = (await f.a.acquireGrant('pair-b', 1, 'design-docs', 'other-scope'))!;
    await expect(other.commitSync(() => { throw new Error('other apply failed'); })).rejects.toThrow('other apply failed');
    expect(other.signal.aborted).toBe(true); // Failing pair fails closed...
    const unrelated = (await f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    await expect(f.a.create({ ...grant, pairId: 'pair-b', proposalId: 'conflict' })).rejects.toThrow('conflicts');
    expect(unrelated.signal.aborted).toBe(false); // ...without tearing down other pairs' streams.
    expect(await unrelated.commitSync(() => 7)).toBe(7);
    unrelated.release(); other.release(); lease.release();
  });
  it('stores encrypted, private credentials; all public APIs omit secrets; survives disk restart', async () => {
    const f = await fixture();
    await f.pair();
    const publicGrant = await f.a.grant('pair-a');
    expect(publicGrant).toMatchObject({ ...grant, peerId: 'instance-b', capability: 'peer.forward', status: 'active' });
    expect(publicGrant).not.toHaveProperty('secret');
    expect(await f.restart().grant('pair-a')).toEqual(publicGrant);
    expect(await f.a.findForHost('host-b', 'design-docs', 'opaque-repo-1')).toEqual(publicGrant);
    expect(await f.a.findForHost('host-b', 'other-plugin')).toBeNull();
    expect(await f.a.findForHost('../escape')).toBeNull();
    expect(await f.a.grant('../escape')).toBeNull();
    const path = join(f.directory, 'pairs-v2.bin'), bytes = await readFile(path);
    expect(bytes.subarray(0, 4).toString()).toBe('ZCP2');
    expect(bytes.includes(Buffer.from('opaque-repo-1'))).toBe(false);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(f.directory)).toEqual(['pairs-v2.bin', 'pairs-v2.initialized']);
    const packet = await f.envelope();
    expect(packet).not.toHaveProperty('secret');
    expect(packet).not.toHaveProperty('body');
    const lease = await f.authenticate(packet, f.restartB());
    expect(lease?.grant).not.toHaveProperty('secret');
    lease?.release();
  });

  it('fails closed without key provider/local identity; never writes plaintext', async () => {
    const f = await fixture();
    await expect(new PairStore(f.directory).grant('pair-a')).rejects.toThrow('unavailable');
    await expect(new PairStore(f.directory, { ...f.options, keyProvider: { getKey: async () => null } }).create(grant)).rejects.toThrow('unavailable');
    await expect(new PairStore(f.directory, { ...f.options, keyProvider: { getKey: async () => Buffer.alloc(31) } }).create(grant)).rejects.toThrow('unavailable');
    await expect(f.a.create({ pairId: 'legacy', peerId: 'instance-b', capability: 'peer.forward' })).rejects.toThrow('invalid');
    expect(await readdir(f.root)).toEqual([]);
    expect(() => new PairStore('relative')).toThrow('absolute');
    expect(() => new PairStore(f.directory, { ...f.options, maxPairs: 0 })).toThrow('capacity');
  });

  it('recovers credentials, replay and revocation in fresh Node processes from disk only', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope();
    (await f.authenticate(packet))!.release();
    const source = fileURLToPath(new URL('./pair-store.ts', import.meta.url));
    const execute = async (directory: string, localInstanceId: string, request: unknown) => {
      const script = `import { PairStore } from ${JSON.stringify(source)};
const pairs = new PairStore(${JSON.stringify(directory)}, { localInstanceId: ${JSON.stringify(localInstanceId)},
  keyProvider: { getKey: async () => Buffer.alloc(32, 31) }, now: () => 1000000 });
const envelope = ${JSON.stringify(request)};
const lease = await pairs.authenticateRequest({ envelope, body: Buffer.from(${JSON.stringify(body.toString())}),
  pluginId: 'design-docs', scope: 'opaque-repo-1', route: '/api/v1/peer/design-docs/handshake', httpMethod: 'POST' });
console.log(JSON.stringify({ accepted: lease !== null, grant: await pairs.grant('pair-a') }));
lease?.release(); pairs.dispose();`;
      const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script],
        { timeout: 10_000, maxBuffer: 16_384 });
      return JSON.parse(stdout.trim());
    };
    expect(await execute(join(f.root, 'b'), 'instance-b', packet)).toMatchObject({ accepted: false, grant: { epoch: 1 } });
    expect(await execute(join(f.root, 'b'), 'instance-b', await f.envelope())).toMatchObject({ accepted: true, grant: { epoch: 1 } });
    await f.b.revoke('pair-a');
    expect(await execute(join(f.root, 'b'), 'instance-b', await f.envelope())).toEqual({ accepted: false, grant: null });
  });

  it('is idempotent without overwriting secrets and refuses conflicting proposals', async () => {
    const f = await fixture();
    const results = await Promise.all(Array.from({ length: 10 }, () => f.restart().propose(grant)));
    expect(results.every((item) => item.status === 'proposed')).toBe(true);
    const before = await readFile(join(f.directory, 'pairs-v2.bin'));
    await f.a.propose(grant);
    expect(await readFile(join(f.directory, 'pairs-v2.bin'))).toEqual(before);
    expect(await f.a.grant('pair-a')).toBeNull();
    expect(await f.a.signRequest('pair-a', { pluginId: 'design-docs', scope: 'opaque-repo-1', method: 'handshake', body })).toBeNull();
    await expect(f.a.propose({ ...grant, scope: 'other' })).rejects.toThrow('conflicts');
    await expect(f.a.activate('pair-a', 'wrong', 1)).rejects.toThrow('no longer valid');
    await expect(f.a.activate('pair-a', 'proposal-1', 2)).rejects.toThrow('no longer valid');
    const active = await f.a.activate('pair-a', 'proposal-1', 1);
    expect(await f.a.activate('pair-a', 'proposal-1', 1)).toEqual(active);
    expect(await f.a.create(grant)).toEqual(active);
  });

  it('serializes distinct pair creates and revokes across instances without lost updates', async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 16 }, (_, i) => f.restart().create({ ...grant, pairId: `pair-${i}` })));
    await Promise.all(Array.from({ length: 16 }, (_, i) => f.restart().revoke(`pair-${i}`)));
    for (let i = 0; i < 16; i++) expect(await f.restart().grant(`pair-${i}`)).toBeNull();
    await expect(f.a.create({ ...grant, pairId: 'pair-0' })).rejects.toThrow('revoked');
  });

  it('retains revoked tombstones at bounded capacity; never ambiguously chooses a plugin grant', async () => {
    const f = await fixture({ maxPairs: 2 });
    await f.a.create(grant);
    await f.a.create({ ...grant, pairId: 'pair-other', pluginId: 'other-plugin' });
    expect(await f.a.findForHost('host-b')).toBeNull();
    expect(await f.a.findForHost('host-b', 'design-docs')).toMatchObject({ pairId: 'pair-a' });
    await f.a.revoke('pair-a');
    await expect(f.a.create({ ...grant, pairId: 'pair-third' })).rejects.toThrow('capacity');
    await expect(f.a.revoke('unknown-pair')).rejects.toThrow('capacity');
    await expect(f.a.revoke('../escape')).rejects.toThrow('invalid');
  });

  it('rejects invalid binding data including missing fields, unknown status, invalid epochs and Unicode/control scope', async () => {
    const f = await fixture();
    for (const patch of [{ pairId: '../pair' }, { localInstanceId: 'other' }, { remoteInstanceId: 'instance-a' },
      { remoteInstanceId: undefined }, { pluginId: 'Design-Docs' }, { targetHostId: '../host' }, { proposalId: undefined },
      { scope: '' }, { scope: 'x'.repeat(1025) }, { scope: 'x\n' }, { scope: '\ud800' }, { epoch: 0 },
      { epoch: 1.5 }, { epoch: Number.MAX_SAFE_INTEGER + 1 }, { capability: 'host.write_file' }, { peerId: 'other' }]) {
      await expect(f.a.create({ ...grant, ...patch } as PeerPairInput)).rejects.toThrow();
    }
  });

  it('rejects corrupt ciphertext, wrong key/identity and missing initialized state', async () => {
    const f = await fixture();
    await f.a.create(grant);
    const path = join(f.directory, 'pairs-v2.bin'), bytes = await readFile(path);
    await expect(new PairStore(f.directory, { ...f.options, keyProvider: { getKey: async () => Buffer.alloc(32, 9) } }).grant('pair-a')).rejects.toThrow('corrupt');
    await expect(new PairStore(f.directory, { ...f.options, localInstanceId: 'other' }).grant('pair-a')).rejects.toThrow('corrupt');
    bytes[32] = bytes[32]! ^ 1;
    await writeFile(path, bytes);
    await expect(f.restart().grant('pair-a')).rejects.toThrow('corrupt');
    await expect(f.restart().create(grant)).rejects.toThrow('corrupt');
    await rm(path);
    await expect(f.restart().create(grant)).rejects.toThrow('missing after initialization');
  });

  it('rejects insecure directories/files, symlinks, hardlinks and over-budget files', async () => {
    const f = await fixture();
    await f.a.create(grant);
    const path = join(f.directory, 'pairs-v2.bin');
    await chmod(f.directory, 0o755);
    await expect(f.a.grant('pair-a')).rejects.toThrow('unsafe');
    await chmod(f.directory, 0o700);
    await chmod(path, 0o644);
    await expect(f.a.grant('pair-a')).rejects.toThrow('unsafe');
    await chmod(path, 0o600);
    const hard = join(f.root, 'hard');
    await link(path, hard);
    await expect(f.a.grant('pair-a')).rejects.toThrow('unsafe');
    await rm(hard);
    await rm(path);
    await symlink(hard, path);
    await expect(f.a.grant('pair-a')).rejects.toThrow('unsafe');
    await rm(path);
    await writeFile(path, Buffer.alloc(MAX_PEER_STORE_BYTES + 1), { mode: 0o600 });
    await expect(f.a.grant('pair-a')).rejects.toThrow('unsafe');
    const alias = join(f.root, 'alias');
    await symlink(f.directory, alias);
    await expect(new PairStore(alias, f.options).grant('pair-a')).rejects.toThrow('unsafe');
  });

  it('does not silently migrate plaintext or scan an unbounded directory; interrupted first writes recover', async () => {
    const f = await fixture();
    await mkdir(f.directory, { mode: 0o700 });
    await writeFile(join(f.directory, 'pair-a.json'), '{"secret":"legacy"}', { mode: 0o600 });
    await expect(f.a.create(grant)).rejects.toThrow('migration');
    await rm(join(f.directory, 'pair-a.json'));
    await writeFile(join(f.directory, 'pairs-v2.bin.crash.tmp'), 'partial', { mode: 0o600 });
    await f.a.create(grant);
    expect(await f.restart().grant('pair-a')).not.toBeNull();
    const many = await fixture();
    await mkdir(many.directory, { mode: 0o700 });
    for (let i = 0; i < 33; i++) await writeFile(join(many.directory, `pairs-v2.bin.${i}.tmp`), 'partial', { mode: 0o600 });
    await expect(many.a.create(grant)).rejects.toThrow('directory capacity');
    expect(await readdir(f.directory)).toEqual(['pairs-v2.bin', 'pairs-v2.initialized']);
    await writeFile(join(f.directory, 'pairs-v2.bin.interrupted.tmp'), 'partial', { mode: 0o600 });
    expect(await f.restart().grant('pair-a')).not.toBeNull();
    expect(await readdir(f.directory)).toEqual(['pairs-v2.bin', 'pairs-v2.initialized']);
  });
});

describe('Canonical peer auth', () => {
  it('freezes length-prefixed bytes and SHA-256 vector; preserves opaque scope byte identity', () => {
    const fields = { protocolVersion: 2 as const, pairId: 'pair-a', senderId: 'instance-a', recipientId: 'instance-b',
      pluginId: 'design-docs', scope: 'opaque-repo-1', route: '/api/v1/peer/design-docs/handshake', httpMethod: 'POST' as const,
      payloadHash: peerBodyHash(Buffer.from('abc')), nonce: 'n'.repeat(24), issuedAt: 1_000_000, epoch: 1 };
    expect(fields.payloadHash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const bytes = canonicalPeerMac(fields);
    const values = ['zcc-peer-auth', '2', 'pair-a', 'instance-a', 'instance-b', 'design-docs', 'opaque-repo-1',
      '/api/v1/peer/design-docs/handshake', 'POST', fields.payloadHash, 'n'.repeat(24), '1000000', '1'];
    const hex = values.map((value) => Buffer.byteLength(value).toString(16).padStart(8, '0') + Buffer.from(value).toString('hex')).join('');
    expect(bytes.toString('hex')).toBe(hex);
    expect(parsePeerMac(bytes)).toEqual(fields);
    expect(peerMacPayload({ ...fields, body: Buffer.from('abc'), method: 'handshake' })).toEqual(bytes);
    expect(canonicalPeerMac({ ...fields, scope: '\u00e9' })).not.toEqual(canonicalPeerMac({ ...fields, scope: 'e\u0301' }));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('d8ea07872bd8075a19630173fac742a9583d0db288a1c5f69ef0c6474c087ccb');
  });

  it('rejects malformed/noncanonical MAC encodings and every unsafe route token', () => {
    for (const method of ['../apply', 'a/b', 'a\\b', '.', '%2f', '%252f', 'apply?x', 'apply#x', 'apply\n', '\u00e9', 'Apply', 'a'.repeat(65)]) {
      expect(() => peerRoute('design-docs', method)).toThrow('route');
    }
    for (const payload of [Buffer.alloc(0), Buffer.alloc(4097), Buffer.from([0, 0, 0]), Buffer.from([0, 0, 0, 8, 1])]) {
      expect(() => parsePeerMac(payload)).toThrow('canonical');
    }
    expect(() => peerBodyHash(Buffer.alloc(MAX_PEER_BODY_BYTES + 1))).toThrow('body');
    expect(() => peerMacPayload({ pairId: 'pair-a', senderId: 'instance-a', pluginId: 'design-docs', method: 'handshake',
      nonce: 'n'.repeat(24), epoch: 1, body })).toThrow('fields');
    const packet = { protocolVersion: 2 as const, pairId: 'pair-a', senderId: 'instance-a', recipientId: 'instance-b',
      pluginId: 'design-docs', scope: 'scope', route: '/api/v1/peer/design-docs/handshake', httpMethod: 'POST' as const,
      payloadHash: peerBodyHash(body), nonce: 'n'.repeat(24), issuedAt: 1_000_000, epoch: 1 };
    const canonical = canonicalPeerMac(packet);
    expect(() => parsePeerMac(Buffer.concat([canonical, Buffer.from([0])]))).toThrow('canonical');
    const leadingZero = Buffer.concat([canonical.subarray(0, canonical.length - 5), Buffer.from([0, 0, 0, 2]), Buffer.from('01')]);
    expect(() => parsePeerMac(leadingZero)).toThrow('noncanonical');
    expect(() => canonicalPeerMac({ ...packet, route: '/api/v1/peer/design-docs/%252f' })).toThrow('route');
    expect(() => unsealPeerBytes(Buffer.alloc(31), key, 'test')).toThrow('encrypted');
    expect(() => sealPeerBytes(body, Buffer.alloc(31), 'test')).toThrow('key');
  });

  it('binds every MAC field, exact receiving route/method/scope and payload before dispatch', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope();
    for (const patch of [{ protocolVersion: 1 }, { pairId: 'other' }, { senderId: 'other' }, { recipientId: 'other' },
      { pluginId: 'other-plugin' }, { scope: 'other-scope' }, { route: '/api/v1/peer/design-docs/apply' }, { httpMethod: 'GET' },
      { payloadHash: '0'.repeat(64) }, { nonce: 'x'.repeat(24) }, { issuedAt: packet.issuedAt + 1 }, { epoch: 2 },
      { signature: 'x'.repeat(43) }, { extra: 'no' }]) {
      expect(await f.authenticate({ ...packet, ...patch } as typeof packet)).toBeNull();
    }
    for (const override of [{ pluginId: 'other-plugin' }, { scope: 'other-scope' }, { route: '/api/v1/peer/design-docs/apply' },
      { httpMethod: 'GET' }, { body: Buffer.from('tampered') }]) expect(await f.authenticate(packet, f.b, override)).toBeNull();
    const lease = await f.authenticate(packet);
    expect(lease).not.toBeNull();
    await lease!.assertActive();
    lease!.release();
    expect(await f.authenticate(packet)).toBeNull();
    expect(await f.authenticate(packet, f.restartB())).toBeNull();
  });

  it('accepts one concurrent authenticated request, persists clock fence and rejects expired signatures', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope();
    const results = await Promise.all(Array.from({ length: 10 }, () => f.authenticate(packet, f.restartB())));
    expect(results.filter(Boolean)).toHaveLength(1);
    results.forEach((lease) => lease?.release());
    const next = await f.envelope();
    f.time(packet.issuedAt - 1);
    expect(await f.authenticate(next, f.restartB())).toBeNull();
    f.time(packet.issuedAt + PEER_REQUEST_TTL_MS);
    expect(await f.authenticate(next, f.restartB())).toBeNull();
    expect(await f.authenticate(await f.envelope(), f.restartB())).not.toBeNull();
    await f.b.revoke('pair-a');
  });

  it('fences active streams across instances, persists revoke epoch and requires fresh rejoin proposal', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope(), lease = (await f.authenticate(packet))!;
    const pending = await f.envelope();
    await f.restartB().revoke('pair-a');
    expect(lease.signal.aborted).toBe(true);
    await expect(lease.assertActive()).rejects.toThrow('no longer active');
    expect(await f.authenticate(pending, f.restartB())).toBeNull();
    expect(await f.restartB().grant('pair-a')).toBeNull();
    await f.a.revoke('pair-a');
    await f.a.revoke('pair-a');
    await expect(f.a.propose({ ...grant, proposalId: 'proposal-2', epoch: 1 })).rejects.toThrow('revoked');
    await expect(f.a.propose({ ...grant, epoch: 2 })).rejects.toThrow('revoked');
    await f.a.propose({ ...grant, proposalId: 'proposal-2', epoch: 2 });
    await f.b.importCredential({ ...reverse, proposalId: 'proposal-2', epoch: 2 }, await f.a.exportCredential('pair-a', context), context);
    await f.a.activate('pair-a', 'proposal-2', 2);
    await f.b.activate('pair-a', 'proposal-2', 2);
    expect(await f.authenticate(pending)).toBeNull();
    const fresh = await f.authenticate(await f.envelope());
    expect(fresh).not.toBeNull();
    fresh!.release();
    await expect(fresh!.assertActive()).rejects.toThrow('no longer active');
  });

  it('fails closed for raw legacy payloads; compatibility canonical sign/verify still fences replay', async () => {
    const f = await fixture();
    await f.pair();
    expect(await f.a.sign('pair-a', Buffer.from('raw'))).toBeNull();
    expect(await f.b.verify({ pairId: 'pair-a', peerId: 'instance-a', capability: 'peer.forward', epoch: 1,
      payload: Buffer.from('raw'), signature: 'x'.repeat(43) })).toBe(false);
    const packet = await f.envelope(), payload = canonicalPeerMac(packet);
    const signature = (await f.a.sign('pair-a', payload))!;
    expect(signature).toBe(packet.signature);
    expect(await f.b.sign('pair-a', payload)).toBeNull();
    expect(await f.a.sign('other', payload)).toBeNull();
    const input = { pairId: 'pair-a', peerId: 'instance-a', capability: 'peer.forward', epoch: 1, payload, signature };
    expect(await f.b.verify({ ...input, capability: 'host.write_file' })).toBe(false);
    expect(await f.b.verify(input)).toBe(true);
    expect(await f.b.verify(input)).toBe(false);
    expect(await f.a.signRequest('pair-a', { pluginId: 'other-plugin', scope: 'opaque-repo-1', method: 'handshake', body })).toBeNull();
    f.time(packet.issuedAt + PEER_REQUEST_TTL_MS);
    expect(await f.a.sign('pair-a', payload)).toBeNull();
  });

  it('fences synchronous commits and outbound streams; cleans shutdown resources', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope();
    const inbound = (await f.authenticate(packet))!, outbound = (await f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    expect(await f.a.acquireGrant('pair-a', 2, 'design-docs', 'opaque-repo-1')).toBeNull();
    expect(await inbound.commitSync(() => 42)).toBe(42);
    const committed = vi.fn(() => 'applied');
    await f.b.revoke('pair-a');
    await expect(inbound.commitSync(committed)).rejects.toThrow('no longer active');
    expect(committed).not.toHaveBeenCalled();
    f.a.dispose();
    expect(outbound.signal.aborted).toBe(true);
    await expect(f.a.grant('pair-a')).rejects.toThrow('disposed');
    inbound.release(); outbound.release();
  });

  it.each(['revoke', 'release', 'dispose', 'signal'] as const)('cancels queued worker admission on %s before mutation', async mode => {
    const f = await fixture(); await f.pair();
    const lease = (await f.authenticate(await f.envelope()))!, controller = new AbortController();
    let entered!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const mutate = vi.fn();
    const operation = lease.commitWorkerSync(async gate => {
      entered(); await held;
      if (Atomics.compareExchange(new Int32Array(gate), 0, 0, 1) !== 0) throw Error('cancelled');
      mutate(); return { asynchronous: false, value: 42 };
    }, controller.signal);
    const rejected = expect(operation).rejects.toThrow(/cancelled|revoked|disposed|active/);
    await ready;
    const revoking = mode === 'revoke' ? f.restartB().revoke('pair-a') : undefined;
    if (mode === 'release') lease.release();
    if (mode === 'dispose') f.b.dispose();
    if (mode === 'signal') controller.abort();
    resume(); await rejected; await revoking;
    expect(mutate).not.toHaveBeenCalled(); lease.release();
  });

  it('holds exclusive worker lease until observation; revoke cannot persist while admitted commit executes', async () => {
    const f = await fixture(); await f.pair();
    const lease = (await f.authenticate(await f.envelope()))!;
    let entered!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const operation = lease.commitWorkerSync(async gate => {
      expect(Atomics.compareExchange(new Int32Array(gate), 0, 0, 1)).toBe(0);
      entered(); await held; return { asynchronous: false, value: 42 };
    }, new AbortController().signal);
    await ready;
    let persisted = false;
    const revoking = f.restartB().revoke('pair-a').then(() => { persisted = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(lease.signal.aborted).toBe(true); expect(persisted).toBe(false);
    resume(); await expect(operation).resolves.toBe(42); await revoking;
    expect(await f.b.grant('pair-a')).toBeNull(); lease.release();
  });

  it('rejects asynchronous worker observations and stale admission', async () => {
    const f = await fixture(); await f.pair();
    const lease = (await f.authenticate(await f.envelope()))!, signal = new AbortController().signal;
    await expect(lease.commitWorkerSync(async gate => {
      Atomics.compareExchange(new Int32Array(gate), 0, 0, 1);
      return { asynchronous: true, value: 1 };
    }, signal)).rejects.toThrow('synchronous');
    // Errors fail closed and abort leases.
    const next = (await f.b.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    await expect(next.commitWorkerSync(async () => ({ asynchronous: false, value: 1 }), signal)).rejects.toThrow('active');
    next.release(); lease.release();
  });

  it('preflight rechecks enrollment after IPC queue delay before worker mutation', async () => {
    let current = true;
    const f = await fixture({ validateGrant: async () => () => current }); await f.pair();
    const lease = (await f.authenticate(await f.envelope()))!;
    let entered!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const mutate = vi.fn();
    const operation = lease.commitWorkerSync(async (_gate, preflight) => {
      entered(); await held; preflight(); mutate(); return { asynchronous: false, value: 42 };
    }, new AbortController().signal);
    const rejected = expect(operation).rejects.toThrow('enrollment changed');
    await ready; current = false; resume(); await rejected;
    expect(mutate).not.toHaveBeenCalled(); lease.release();
  });

  it.each(['signal', 'deadline', 'repeated'] as const)('preflight fails closed for %s admission', async mode => {
    const f = await fixture(); await f.pair();
    const lease = (await f.authenticate(await f.envelope()))!, controller = new AbortController();
    await expect(lease.commitWorkerSync(async (gate, preflight) => {
      if (mode === 'signal') controller.abort();
      if (mode === 'deadline') Atomics.store(new BigInt64Array(gate, 8), 0, 0n);
      preflight(); preflight();
      return { asynchronous: false, value: 42 };
    }, controller.signal)).rejects.toThrow('no longer active');
    lease.release();
  });

  it('fails closed on disk commit failure without consuming replay or enabling failed revoke', async () => {
    const f = await fixture();
    await f.pair();
    const packet = await f.envelope(), path = join(f.root, 'b', 'pairs-v2.bin'), before = await readFile(path);
    const failure = vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'));
    await expect(f.authenticate(packet)).rejects.toThrow('disk failure');
    expect(await readFile(path)).toEqual(before);
    expect((await readdir(join(f.root, 'b'))).filter((item) => item.endsWith('.tmp'))).toEqual([]);
    failure.mockReset();
    const lease = (await f.authenticate(packet, f.restartB()))!;
    vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'));
    await expect(f.b.revoke('pair-a')).rejects.toThrow('disk failure');
    expect(lease.signal.aborted).toBe(true);
    expect(await f.restartB().grant('pair-a')).toBeNull();
    expect(await f.authenticate(await f.envelope(), f.restartB())).toBeNull();
    vi.mocked(fs.rename).mockReset();
    await f.b.revoke('pair-a');
    expect(await f.restartB().grant('pair-a')).toBeNull();
    lease.release();
  });

  it('prevents lease issuance when revoke starts during authenticated replay write', async () => {
    const f = await fixture();
    await f.pair();
    const { rename } = await vi.importActual<typeof fs>('node:fs/promises');
    let started!: () => void, release!: () => void;
    const paused = new Promise<void>((resolve) => { started = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fs.rename).mockImplementationOnce(async (...args) => { started(); await resume; return rename(...args); });
    const accepting = f.authenticate(await f.envelope());
    await paused;
    const revoking = f.restartB().revoke('pair-a');
    release();
    expect(await accepting).toBeNull();
    await revoking;
    expect(await f.restartB().grant('pair-a')).toBeNull();
  });

  it('bounds active leases and rejects async commit callbacks before invoking them', async () => {
    const f = await fixture();
    await f.a.create(grant);
    const active = [];
    for (let i = 0; i < 128; i++) active.push((await f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!);
    await expect(f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1')).rejects.toThrow('capacity');
    expect(active.every((lease) => lease.signal.aborted)).toBe(true);
    active.forEach((lease) => lease.release());
    const lease = (await f.a.acquireGrant('pair-a', 1, 'design-docs', 'opaque-repo-1'))!;
    let called = false;
    const callback = async () => { called = true; return 1; };
    await expect(lease.commitSync(callback as never)).rejects.toThrow('synchronous');
    expect(called).toBe(false);
    lease.release();
  });

  it('handles exhausted epochs and provider errors without leaking secrets', async () => {
    const f = await fixture();
    await f.a.create({ ...grant, epoch: Number.MAX_SAFE_INTEGER });
    await expect(f.a.revoke('pair-a')).rejects.toThrow('exhausted');
    expect(await f.a.grant('pair-a')).toBeNull();
    const unavailable = new PairStore(join(f.root, 'unavailable'), { ...f.options,
      keyProvider: { getKey: async () => { throw new Error('provider secret'); } } });
    await expect(unavailable.grant('pair-a')).rejects.toThrow('peer encryption key unavailable');
  });
});

describe('Host-only authenticated credential transfer', () => {
  it('seals exchange, requires authenticated host authority, binds import and is idempotent', async () => {
    const f = await fixture();
    await f.a.propose(grant);
    await expect(f.a.exportCredential('pair-a', {})).rejects.toThrow('authenticated host');
    const bundle = await f.a.exportCredential('pair-a', context);
    expect(bundle.includes(Buffer.from('secret'))).toBe(false);
    await expect(f.b.importCredential(reverse, bundle, {})).rejects.toThrow('authenticated host');
    const imported = await f.b.importCredential(reverse, bundle, context);
    expect(imported).not.toHaveProperty('secret');
    expect(await f.b.importCredential(reverse, bundle, context)).toEqual(imported);
    expect(f.authorizeTransfer).toHaveBeenCalledWith(context, expect.objectContaining({ operation: 'import', localInstanceId: 'instance-b',
      remoteInstanceId: 'instance-a', targetHostId: 'host-a', pluginId: 'design-docs', scope: 'opaque-repo-1', epoch: 1 }));
    for (const patch of [{ scope: 'other' }, { remoteInstanceId: 'instance-c' }, { proposalId: 'other' }, { epoch: 2 }]) {
      await expect(f.b.importCredential({ ...reverse, ...patch }, bundle, context)).rejects.toThrow('binding');
    }
    bundle[32] = bundle[32]! ^ 1;
    await expect(f.b.importCredential(reverse, bundle, context)).rejects.toThrow('invalid peer credential');
    await expect(f.b.importCredential(reverse, Buffer.alloc(8193), context)).rejects.toThrow('too large');
    await expect(f.b.exportCredential('unknown', context)).rejects.toThrow('unavailable');
    const absent = await fixture({ authorizeTransfer: undefined });
    await absent.a.propose(grant);
    await expect(absent.a.exportCredential('pair-a', context)).rejects.toThrow('authenticated host');
  });

  it('rejects malformed authenticated plaintext and corrupted schema rather than adopting it', async () => {
    const f = await fixture();
    await f.a.propose(grant);
    const path = join(f.directory, 'pairs-v2.bin'), bytes = await readFile(path);
    const state = JSON.parse(unsealPeerBytes(bytes, key, 'pairs-v2:instance-a').toString());
    for (const change of [(s: typeof state) => { s.version = 1; }, (s: typeof state) => { s.pairs[0].secret = 'short'; },
      (s: typeof state) => { s.pairs[0].pairId = 'other'; s.pairs.push(s.pairs[0]); },
      (s: typeof state) => { s.pairs[0].status = 'unknown'; }, (s: typeof state) => { s.replay.extra = true; },
      (s: typeof state) => { s.pairs[0].extra = true; }]) {
      const copy = structuredClone(state);
      change(copy);
      await writeFile(path, sealPeerBytes(Buffer.from(JSON.stringify(copy)), key, 'pairs-v2:instance-a'));
      await expect(f.restart().grant('pair-a')).rejects.toThrow('corrupt');
    }
    for (const data of ['null', '{}', '{"secret":"short"}', 'not json']) {
      const bundle = sealPeerBytes(Buffer.from(data), channelKey, 'zcc-peer-transfer-v2');
      await expect(f.b.importCredential(reverse, bundle, context)).rejects.toThrow();
    }
  });

  it('refuses authenticated credential replacement, invalid secrets and revoked exports', async () => {
    const f = await fixture();
    await f.pair();
    const bundle = await f.a.exportCredential('pair-a', context);
    const transfer = JSON.parse(unsealPeerBytes(bundle, channelKey, 'zcc-peer-transfer-v2').toString());
    await expect(f.b.importCredential(reverse, sealPeerBytes(Buffer.from(JSON.stringify({ ...transfer, secret: 'short' })), channelKey,
      'zcc-peer-transfer-v2'), context)).rejects.toThrow('binding');
    await expect(f.b.importCredential(reverse, sealPeerBytes(Buffer.from(JSON.stringify({ ...transfer, secret: Buffer.alloc(32).toString('base64url') })),
      channelKey, 'zcc-peer-transfer-v2'), context)).rejects.toThrow('conflicts');
    await f.b.revoke('pair-a');
    await expect(f.b.importCredential(reverse, bundle, context)).rejects.toThrow('revoked');
    await expect(f.b.exportCredential('pair-a', context)).rejects.toThrow('unavailable');
    const blocked = await fixture({ authorizeTransfer: async () => { throw new Error('channel secret'); } });
    await blocked.a.propose(grant);
    await expect(blocked.a.exportCredential('pair-a', context)).rejects.toThrow('authenticated host credential channel unavailable');
  });
});

describe('Bounded private host storage', () => {
  it('bounds shared queues and serialized snapshot size', async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tasks = Array.from({ length: 128 }, () => serializePeerStorage(f.directory, () => gate));
    await expect(serializePeerStorage(f.directory, async () => undefined)).rejects.toThrow('queue full');
    release();
    await Promise.all(tasks);
    const storage = new PrivatePeerStorage(join(f.root, 'budget'), 'budget', f.options.keyProvider, 'instance-a',
      () => ({ data: 'x'.repeat(MAX_PEER_STORE_BYTES) }), (value) => value as { data: string });
    await expect(storage.transaction(async (_state, save) => save())).rejects.toThrow('capacity');
    expect(await readdir(join(f.root, 'budget'))).toEqual([]);
  });
});
