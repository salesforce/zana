import { describe, expect, it } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { canonicalJson, canonicalPeerHash } from '../shared/peer-contract.js';
import { createTransferHash, transferQuery, validateMissing } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_SESSION_BYTES, MAX_PEER_PACKET_BYTES } from '../shared/peer-limits.js';
import { createRoster, transferSeat, appendSeat } from './peer-slots.js';
import { DesignDocPeerGroup } from './peer-group.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const roster = ['a', 'b', 'c'].map((name) => ({ replicaId: `replica-${name}`, machineId: `app-${name}`, joinedAt: 1, sponsorReplicaId: null }));
function fixture(name: string, size = 2) {
  const db = createTestDatabase();
  let now = 1000;
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db, { now: () => now });
  sync.initialize('repo', `replica-${name}`); sync.setGroup('repo', 'group', roster.slice(0, size));
  const service = new DesignDocPeerService(sync);
  return { db, store, sync, service, name, advance: (ms: number) => { now += ms; } };
}
const fence = (epoch = 1) => ({ scope: 'repo', grantEpoch: epoch, signal: new AbortController().signal,
  commitSync: async <T>(fn: () => T): Promise<T> => fn() });
function transport(from: ReturnType<typeof fixture>, to: ReturnType<typeof fixture>, epoch = 1): PluginSdkPeers {
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
  const peers: PluginSdkPeers = {
    list: async () => [{ id: `app-${to.name}`, name: to.name, scope: 'repo', grantEpoch: epoch, connected: true }],
    handle: () => {},
    call: async (peer, method, body, args) => {
      expect(peer).toBe(`app-${to.name}`); expect(args?.scope).toBe('repo');
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(MAX_PEER_PACKET_BYTES);
      const handler = handlers.get(method);
      if (!handler) throw new Error(`missing ${method}`);
      return handler({ peerId: `app-${from.name}`, body, ...fence(epoch) });
    }
  };
  to.service.register({ sdk: { peers: { ...peers, handle: (method, handler) => handlers.set(method, handler) } }, onDispose: () => {} } as unknown as ZccPluginApi);
  return peers;
}
async function sendHead(a: ReturnType<typeof fixture>, b: ReturnType<typeof fixture>, docId: string) {
  a.sync.freezeManual();
  const intent = a.sync.readyIntents('repo', 100, true).find((intent) => intent.docId === docId && intent.frozenHead === a.sync.head('repo', docId) && intent.memberReplicaId === `replica-${b.name}`)!;
  return b.service.offer(`app-${a.name}`, a.service.createOffer(intent), fence());
}

describe('peer review regressions', () => {
  it('fences pending retirement data while control frontier preserves pre-barrier admission through final removal', async () => {
    const a = fixture('a', 3), b = fixture('b', 3), d = fixture('c', 3);
    d.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-d'").run();
    const founders = roster.slice(0, 2).map((member, index) => ({ ...member, sponsorReplicaId: index ? 'replica-a' : null }));
    const root = createRoster('repo', 'group', founders, 'genesis', 'replica-a');
    const current = appendSeat(root, { kind: 'admit', seat: 3, requestId: 'admit-c', ownerReplicaId: 'replica-a',
      member: { ...roster[2]!, sponsorReplicaId: 'replica-a' } });
    const withD = appendSeat(current, { kind: 'admit', seat: 6, requestId: 'admit-d', ownerReplicaId: 'replica-b',
      member: { replicaId: 'replica-d', machineId: 'app-d', joinedAt: 2, sponsorReplicaId: 'replica-b' } });
    const govern = (peer: typeof a, value: typeof root, machineId: string) => {
      peer.sync.setGroup('repo', 'group', value.members);
      peer.db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(value.rosterEpoch);
      peer.db.prepare('UPDATE sync_group_control SET local_peer_id = ?, roster_json = ?').run(machineId, JSON.stringify(value));
      return new DesignDocPeerGroup(peer.db);
    };
    const ag = govern(a, current, 'app-a'), bg = govern(b, withD, 'app-b'), dg = govern(d, withD, 'app-d');
    const own = b.store.create({ title: 'Retiring author', status: 'approved', files: [{ path: 'README.md', content: 'shared' }] }, actor);
    const frozen = b.sync.head('repo', own.id)!, intents = b.db.prepare('SELECT * FROM sync_intents').all();
    const retiring = ag.remove('replica-b');
    expect(retiring.stage).toBe('retiring');
    expect(ag.roster()!.members.some((member) => member.replicaId === 'replica-b')).toBe(true);
    expect(a.sync.members('repo').map((member) => member.replicaId)).toEqual(['replica-a', 'replica-c']);
    bg.apply(retiring.roster, 'app-a');
    expect(bg.roster()!.members.map((member) => member.replicaId)).toContain('replica-d');
    expect(b.sync.members('repo').map((member) => member.replicaId)).toEqual(['replica-a', 'replica-c', 'replica-d']);
    b.store.writeFile(own.id, { path: 'README.md', content: 'PRIVATE AFTER RETIREMENT' }, actor);
    b.store.update(own.id, { status: 'implemented', expectedHead: b.sync.head('repo', own.id) }, actor);
    expect(b.sync.version('repo', frozen)!.closure.files[0]!.content).toBe('shared');
    expect(b.db.prepare('SELECT * FROM sync_intents').all()).toEqual(intents);
    expect(b.sync.readyIntents('repo')).toEqual([]);
    const sealed = bg.retire(retiring.roster, 'app-a');
    ag.apply(sealed, 'app-b');
    const final = ag.roster()!;
    expect(final.removals.some((event) => event.replicaId === 'replica-b')).toBe(true);
    expect(final.members.map((member) => member.replicaId)).toEqual(['replica-a', 'replica-c', 'replica-d']);
    expect(a.sync.members('repo').map((member) => member.replicaId)).toEqual(['replica-a', 'replica-c', 'replica-d']);
    dg.apply(final, 'app-a');
    const doc = a.store.create({ title: 'Surviving D', status: 'approved', template: 'blank' }, actor);
    const intent = a.sync.readyIntents('repo').find((intent) => intent.memberReplicaId === 'replica-d')!;
    expect(intent).toBeDefined();
    await expect(d.service.offer('app-a', a.service.createOffer(intent), fence())).resolves.toMatchObject({ stage: 'synced' });
    expect(d.store.find(doc.id)).not.toBeNull();
    bg.apply(final, 'app-a');
    expect(b.sync.localRepository()!.groupId).toBeNull();
    expect(b.store.readFile(own.id, 'README.md').content).toBe('PRIVATE AFTER RETIREMENT');
    expect(b.sync.version('repo', frozen)).not.toBeNull();
  });
  it('quarantines equal-epoch stale or digest-less managed reservations, retains chunks, and rejects current-digest substitution', async () => {
    const a = fixture('a'), b = fixture('b');
    const root = createRoster('repo', 'group', roster.slice(0, 2).map((member, index) => ({ ...member,
      sponsorReplicaId: index ? 'replica-a' : null })), 'genesis', 'replica-a');
    const left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    const govern = (peer: typeof a, value: typeof root) => {
      peer.db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(value));
      peer.db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(value.rosterEpoch);
    };
    const doc = a.store.create({ title: 'Digest recovery', status: 'approved', files: [{ path: 'README.md', content: 'frozen' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, legacy = a.service.createTransfer(intent, 1);
    // Old unmanaged persisted sessions have no digest, even at the same event count.
    const legacyBody = { ...legacy, rosterEpoch: left.rosterEpoch };
    const legacyStage = { ...legacyBody, scopeHash: createTransferHash(legacyBody) };
    b.db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(left.rosterEpoch);
    await b.service.receiveTransfer('transfer', 'app-a', legacyStage, fence());
    govern(a, left); govern(b, left);
    const old = a.service.createTransfer(intent, 1);
    await b.service.receiveTransfer('transfer', 'app-a', old, fence());
    expect(b.db.prepare('SELECT state FROM sync_transfers ORDER BY rowid').all()).toEqual([{ state: 'quarantined' }, { state: 'active' }]);
    const blob = old.blobs.find((blob) => blob.bytes === 6)!;
    const chunk = a.sync.outgoingChunk(old, blob.hash, 0);
    await b.service.receiveTransfer('chunk', 'app-a', chunk, fence());
    a.store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE' }, actor);
    govern(a, right); govern(b, right);
    const resumed = new DesignDocPeerService(new DesignDocSyncStore(b.db));
    const query = transferQuery(old), substituted = { ...query, rosterDigest: right.digest };
    for (const method of ['apply', 'missing', 'cancel'] as const) {
      await expect(resumed.receiveTransfer(method, 'app-a', query, fence())).rejects.toThrow('authorization');
      await expect(resumed.receiveTransfer(method, 'app-a', substituted, fence())).rejects.toThrow();
    }
    await expect(resumed.receiveTransfer('chunk', 'app-a', { ...chunk, rosterDigest: right.digest }, fence())).rejects.toThrow('authorization');
    const next = a.service.createTransfer(intent, 1);
    await resumed.receiveTransfer('transfer', 'app-a', next, fence());
    expect(b.db.prepare('SELECT state FROM sync_transfers ORDER BY rowid').all()).toEqual([{ state: 'quarantined' }, { state: 'quarantined' }, { state: 'active' }]);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_transfer_chunks').get()).toEqual({ n: 1 });
    for (const descriptor of next.blobs) for (let index = 0; index < Math.ceil(descriptor.bytes / MAX_PEER_CHUNK_BYTES); index++) {
      await resumed.receiveTransfer('chunk', 'app-a', a.sync.outgoingChunk(next, descriptor.hash, index), fence());
    }
    await expect(resumed.receiveTransfer('apply', 'app-a', transferQuery(next), fence())).resolves.toMatchObject({ stage: 'synced' });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('frozen');
    expect(b.db.prepare('SELECT state FROM sync_transfers ORDER BY rowid').all()).toEqual([{ state: 'quarantined' }, { state: 'quarantined' }]);
  });
  it('keeps path and file identity generations monotonic across delete/recreate and restart', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'ABA', files: [{ path: 'README.md', content: 'entry' }, { path: 'note.md', content: 'first' }] }, actor);
    await sendHead(a, b, doc.id);
    const stale = b.store.readFile(doc.id, 'note.md').revision;
    a.store.deleteFile(doc.id, 'note.md', actor); await sendHead(a, b, doc.id);
    expect(b.store.get(doc.id).files.some((file) => file.path === 'note.md')).toBe(false);
    a.store.writeFile(doc.id, { path: 'note.md', content: 'second' }, actor); await sendHead(a, b, doc.id);
    const fresh = b.store.readFile(doc.id, 'note.md');
    expect(fresh.revision).toBeGreaterThan(stale);
    const restarted = new DesignDocStore({ ...b.db, migrate: () => {} });
    expect(() => restarted.writeFile(doc.id, { path: 'note.md', content: 'stale overwrite', baseRevision: stale }, actor)).toThrow('changed since');
    expect(b.db.prepare('SELECT generation FROM sync_file_generations WHERE doc_id = ? AND path = ?').get(doc.id, 'note.md')).toEqual({ generation: fresh.revision });
    expect(b.db.prepare('SELECT * FROM sync_file_identity_generations WHERE doc_id = ?').all(doc.id).length).toBeGreaterThan(1);
  });

  it('rotates epoch-bound sessions, rejects old receipts and preserves frozen bytes not later drafts', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Epoch', status: 'approved', files: [{ path: 'README.md', content: 'approved' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, original = a.service.createTransfer(intent, 1);
    await b.service.receiveTransfer('transfer', 'app-a', original, fence());
    a.store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE' }, actor);
    const next = a.service.createTransfer(intent, 2);
    expect(next.sessionId).not.toBe(original.sessionId); expect(next.scopeHash).not.toBe(original.scopeHash);
    expect(next.versions).toEqual(original.versions); expect(next.blobs).toEqual(original.blobs);
    const body = { sessionId: original.sessionId, scopeHash: original.scopeHash, stage: 'synced' as const, heads: original.heads, appliedHeads: original.heads };
    expect(() => a.sync.acceptTransferReceipt(intent, original, { ...body, checkpointHash: canonicalPeerHash(body) })).toThrow('matching');
    expect(await a.service.deliverPending(transport(a, b, 2))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('approved');
    expect(b.db.prepare("SELECT state FROM sync_transfers WHERE direction = 'in'").all()).toEqual([{ state: 'quarantined' }]);
  });

  it('quarantines obsolete reservations, retains bytes and allows explicit cancellation', async () => {
    const a = fixture('a'), b = fixture('b');
    a.store.create({ title: 'Quarantine', status: 'approved', files: [{ path: 'README.md', content: 'bytes' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, old = a.service.createTransfer(intent, 1);
    await b.service.receiveTransfer('transfer', 'app-a', old, fence());
    const blob = old.blobs.find((blob) => blob.bytes > 0)!;
    await b.service.receiveTransfer('chunk', 'app-a', a.sync.outgoingChunk(old, blob.hash, 0), fence());
    const next = a.service.createTransfer(intent, 2);
    await b.service.receiveTransfer('transfer', 'app-a', next, fence(2));
    expect(b.db.prepare('SELECT state FROM sync_transfers ORDER BY rowid').all()).toEqual([{ state: 'quarantined' }, { state: 'active' }]);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_transfer_chunks').get()).toEqual({ n: 1 });
    await b.service.receiveTransfer('cancel', 'app-a', { ...transferQuery(old), grantEpoch: 2 }, fence(2));
    expect(b.db.prepare('SELECT state FROM sync_transfers').all()).toEqual([{ state: 'active' }]);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_transfer_chunks').get()).toEqual({ n: 0 });
  });

  it('retains departed author ancestry while denying departed sender', async () => {
    const a = fixture('a', 3), b = fixture('b', 3), c = fixture('c', 3);
    const doc = a.store.create({ title: 'History authority', status: 'approved', files: [{ path: 'README.md', content: 'base' }] }, actor);
    await sendHead(a, b, doc.id);
    for (const peer of [b, c]) peer.sync.setGroup('repo', 'group', roster.slice(1));
    b.store.writeFile(doc.id, { path: 'README.md', content: 'descendant' }, actor);
    b.store.update(doc.id, { status: 'implemented', expectedHead: b.sync.head('repo', doc.id) }, actor);
    const descendant = b.sync.head('repo', doc.id)!;
    b.db.prepare("UPDATE sync_intents SET state = 'blocked' WHERE frozen_head <> ?").run(descendant);
    expect(await b.service.deliverPending(transport(b, c))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(c.store.readFile(doc.id, 'README.md').content).toBe('descendant');
    const fake = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    await expect(c.service.offer('app-a', fake, fence())).rejects.toThrow('not a roster member');
    expect(c.sync.operations('repo').some((op) => op.replicaId === 'replica-a')).toBe(true);
  });

  it('paginates fairly per member and durable backoff prevents first hundred failures starving later work', () => {
    const a = fixture('a', 3);
    const doc = a.store.create({ title: 'Fair', status: 'approved', template: 'blank' }, actor);
    const original = a.sync.readyIntents('repo').find((intent) => intent.memberReplicaId === 'replica-b')!;
    for (let index = 0; index < 150; index++) a.db.prepare(`INSERT INTO sync_intents VALUES (?, 'repo', ?, ?, 'replica-b', ?, 'pending', 1, 1)`)
      .run(`offline-${index}`, doc.id, `head-${index}`, original.scopeHash);
    const page = a.sync.readyIntents('repo');
    expect(page.some((intent) => intent.memberReplicaId === 'replica-c')).toBe(true);
    page.forEach((intent) => a.sync.deferIntent(intent, 'offline'));
    expect(a.sync.readyIntents('repo').length).toBeGreaterThan(0);
    expect(a.sync.readyIntents('repo').every((intent) => !page.some((prior) => prior.id === intent.id))).toBe(true);
    const restarted = new DesignDocSyncStore(a.db, { now: () => 1000 });
    expect(restarted.readyIntents('repo').map((intent) => intent.id)).toEqual(a.sync.readyIntents('repo').map((intent) => intent.id));
    a.advance(1000); expect(a.sync.readyIntents('repo', 100, true).length).toBe(100);
  });

  it('manual exchange requires both local consents; automatic traffic never shares remote private drafts', async () => {
    const a = fixture('a'), b = fixture('b');
    const aDraft = a.store.create({ title: 'A draft', template: 'blank' }, actor);
    const bDraft = b.store.create({ title: 'B draft', template: 'blank' }, actor);
    const ab = transport(a, b), ba = transport(b, a);
    // Register each service with its own outgoing transport, not the incoming test adapter.
    a.service.start(ab); b.service.start(ba);
    const first = await a.service.syncNow(ab);
    expect(first.blocked).toBeGreaterThan(0); expect(a.store.find(bDraft.id)).toBeNull();
    const second = await b.service.syncNow(ba);
    expect(second.blocked).toBe(0);
    expect(a.store.find(bDraft.id)).not.toBeNull(); expect(b.store.find(aDraft.id)).not.toBeNull();
    b.store.writeFile(bDraft.id, { path: 'README.md', content: 'NEW PRIVATE DRAFT' }, actor);
    const milestone = a.store.create({ title: 'Approved', status: 'approved', template: 'blank' }, actor);
    await a.service.deliverPending(ab);
    expect(b.store.find(milestone.id)).not.toBeNull();
    expect(a.store.readFile(bDraft.id, 'README.md').content).not.toBe('NEW PRIVATE DRAFT');
  });

  it('forwards authorized frozen heads through B to C without origin rewrite, echo, or later draft leakage', async () => {
    const a = fixture('a', 3), b = fixture('b', 3), c = fixture('c', 3);
    const doc = a.store.create({ title: 'Transit', status: 'approved', files: [{ path: 'README.md', content: 'shared' }] }, actor);
    await a.service.deliverPending(transport(a, b));
    a.store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE LATER' }, actor);
    const pending = b.sync.readyIntents('repo');
    expect(pending.map((intent) => intent.memberReplicaId)).toEqual(['replica-c']);
    expect(await b.service.deliverPending(transport(b, c))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(c.store.readFile(doc.id, 'README.md').content).toBe('shared');
    expect(c.sync.operations('repo').every((op) => op.replicaId === 'replica-a')).toBe(true);
    expect(c.sync.readyIntents('repo')).toEqual([]);
    expect(b.sync.readyIntents('repo')).toEqual([]);
  });

  it('transfers 24MiB rewrite with retained 48MiB history in bounded missing windows and deduplicated storage', async () => {
    const a = fixture('a'), b = fixture('b');
    const files = (offset: number) => Array.from({ length: 12 }, (_, index) => ({ path: index ? `file-${index}.md` : 'README.md',
      content: String.fromCharCode(65 + index + offset).repeat(2 * 1024 * 1024) }));
    const doc = a.store.create({ title: 'Rewrite', status: 'approved', files: files(0) }, actor);
    await a.service.deliverPending(transport(a, b));
    a.store.writeFiles(doc.id, files(12), actor);
    a.store.writeFiles(doc.id, files(24), actor);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo', doc.id) }, actor);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1);
    expect(transfer.blobs.reduce((sum, blob) => sum + blob.bytes, 0)).toBeGreaterThan(MAX_PEER_SESSION_BYTES);
    const peers = transport(a, b), call = peers.call;
    let windows = 0;
    peers.call = async (peer, method, body, args) => {
      const result = await call(peer, method, body, args);
      if (method === 'missing') {
        windows++; const missing = validateMissing(result, transfer);
        expect(missing.chunks.length * MAX_PEER_CHUNK_BYTES).toBeLessThanOrEqual(MAX_PEER_SESSION_BYTES);
      }
      return result;
    };
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(windows).toBeGreaterThan(1);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe(files(24)[0]!.content);
    expect(b.store.history(doc.id).some((row) => b.store.revisionContent(doc.id, row.id).content === files(12)[0]!.content)).toBe(true);
    const blobs = a.db.prepare('SELECT COUNT(*) AS n FROM sync_blobs').get() as { n: number };
    expect(blobs.n).toBeLessThan(50);
    expect(a.db.prepare("SELECT * FROM sync_transfers WHERE direction = 'out'").all()).toEqual([]);
  }, 120_000);

  it('GC removes only redundant transport blobs and pins unsent frozen versions and forks', () => {
    const a = fixture('a');
    const doc = a.store.create({ title: 'GC', status: 'approved', files: [{ path: 'README.md', content: 'pinned' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, before = a.sync.version('repo', intent.frozenHead);
    a.service.createTransfer(intent, 1);
    a.db.prepare('INSERT INTO sync_blobs VALUES (?, ?, ?)').run('unreferenced', Buffer.from('junk'), 4);
    a.sync.collectTransportBlobs();
    expect(a.db.prepare('SELECT * FROM sync_blobs WHERE hash = ?').get('unreferenced')).toBeUndefined();
    expect(a.sync.version('repo', intent.frozenHead)).toEqual(before);
    expect(a.sync.readyIntents('repo')).toHaveLength(1);
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('pinned');
  });

  it('converts legacy inline versions without payload hash changes; capacity errors roll back conversion', () => {
    const a = fixture('a');
    const doc = a.store.create({ title: 'Legacy', status: 'approved', files: [{ path: 'README.md', content: 'legacy frozen' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, version = a.sync.version('repo', intent.frozenHead)!;
    const json = canonicalJson(version.closure);
    a.db.prepare('DELETE FROM sync_version_formats').run(); a.db.prepare('DELETE FROM sync_version_blobs').run(); a.db.prepare('DELETE FROM sync_blobs').run();
    a.db.prepare('UPDATE sync_versions SET closure_json = ?, bytes = ?').run(json, Buffer.byteLength(json));
    const transfer = a.service.createTransfer(intent, 1);
    expect(a.sync.version('repo', intent.frozenHead)).toEqual(version);
    expect(a.db.prepare('SELECT format FROM sync_version_formats').get()).toEqual({ format: 1 });
    expect(a.sync.outgoingChunk(transfer, transfer.blobs[0]!.hash, 0).content.length).toBeGreaterThan(0);
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('legacy frozen');
  });

  it('reactivation cannot bypass active staging cap; idle quarantine retains partial bytes', async () => {
    const a = fixture('a'), b = fixture('b');
    a.store.create({ title: 'Slots', status: 'approved', template: 'blank' }, actor);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1);
    const headers = Array.from({ length: 9 }, (_, index) => {
      const body = { ...transfer, sessionId: `slot-${index}` }; return { ...body, scopeHash: createTransferHash(body) };
    });
    for (const header of headers.slice(0, 8)) await b.service.receiveTransfer('transfer', 'app-a', header, fence());
    b.advance(16 * 60 * 1000);
    await b.service.receiveTransfer('transfer', 'app-a', headers[8], fence());
    for (const header of headers.slice(0, 7)) await b.service.receiveTransfer('transfer', 'app-a', header, fence());
    await expect(b.service.receiveTransfer('transfer', 'app-a', headers[7], fence())).rejects.toThrow('session capacity');
    await expect(b.service.receiveTransfer('missing', 'app-a', transferQuery(headers[7]!), fence())).rejects.toThrow('quarantined');
    expect(b.db.prepare("SELECT COUNT(*) AS n FROM sync_transfers WHERE state = 'active'").get()).toEqual({ n: 8 });
  });

  it('manual consent replay does not broaden scope or accept new remote consent after local authorization consumed', () => {
    const a = fixture('a');
    a.store.create({ title: 'Manual', template: 'blank' }, actor);
    expect(a.sync.acceptManual('replica-b', 'remote-1', {})).toBe(false);
    a.sync.prepareManual();
    expect(a.sync.acceptManual('replica-b', 'remote-1', {})).toBe(true);
    expect(a.sync.acceptManual('replica-b', 'remote-1', {})).toBe(true);
    expect(() => a.sync.acceptManual('replica-b', 'remote-1', { fake: 'head' })).toThrow('identity mismatch');
    expect(a.sync.acceptManual('replica-b', 'remote-2', {})).toBe(false);
    const frozen = a.db.prepare("SELECT heads_json FROM sync_manual_sessions WHERE direction = 'out'").get();
    expect(frozen).toBeTruthy();
  });

  it('durable manual consent retries after restart without freezing later draft edits', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Manual recovery', files: [{ path: 'README.md', content: 'consented snapshot' }] }, actor);
    a.sync.prepareManual(); b.sync.prepareManual();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'later private draft' }, actor);
    const restarted = new DesignDocPeerService(new DesignDocSyncStore(a.db, { now: () => 1000 }));
    expect(await restarted.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('consented snapshot');
    expect(a.db.prepare("SELECT state FROM sync_manual_sessions WHERE direction = 'out'").all()).toEqual([{ state: 'accepted' }]);
  });

  it('forwarding ACK covers ancestor knowledge without false synced receipts or echo to new member', async () => {
    const a = fixture('a', 3), b = fixture('b', 3), c = fixture('c', 3);
    const doc = a.store.create({ title: 'Known ancestors', status: 'approved', files: [{ path: 'README.md', content: 'first' }] }, actor);
    await a.service.deliverPending(transport(a, b));
    a.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, actor);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo', doc.id) }, actor);
    await a.service.deliverPending(transport(a, b));
    const intents = b.sync.readyIntents('repo'), latest = b.sync.head('repo', doc.id)!;
    const newest = intents.find((intent) => intent.frozenHead === latest)!;
    const transfer = b.service.createTransfer(newest, 1), peers = transport(b, c);
    await c.service.receiveTransfer('transfer', 'app-b', transfer, fence());
    for (;;) {
      const missing = c.sync.missingChunks(transferQuery(transfer));
      if (!missing.chunks.length) break;
      for (const chunk of missing.chunks) await c.service.receiveTransfer('chunk', 'app-b', b.sync.outgoingChunk(transfer, chunk.blobHash, chunk.index), fence());
    }
    const receipt = await c.service.receiveTransfer('apply', 'app-b', transferQuery(transfer), fence());
    b.sync.acceptTransferReceipt(newest, transfer, receipt as never);
    expect(b.sync.readyIntents('repo')).toEqual([]);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_receipts').get()).toEqual({ n: 1 });
    expect(c.sync.readyIntents('repo')).toEqual([]);
    expect(await b.service.deliverPending(peers)).toEqual({ attempted: 0, synced: 0, blocked: 0 });
  });

  it('receipt cleanup is transactional and never marks synced when cleanup fails', async () => {
    const a = fixture('a'), b = fixture('b');
    a.store.create({ title: 'Receipt transaction', status: 'approved', template: 'blank' }, actor);
    a.db.runScript("CREATE TRIGGER fail_transfer_cleanup BEFORE DELETE ON sync_transfers BEGIN SELECT RAISE(ABORT, 'cleanup fault'); END;");
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(a.db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
    expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
    expect(a.db.prepare("SELECT COUNT(*) AS n FROM sync_transfers WHERE direction = 'out'").get()).toEqual({ n: 1 });
  });

  it('preserves causal revision order instead of lexical UUID order across capture and replay', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Order', files: [{ path: 'README.md', content: 'first' }] }, actor);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, actor);
    const rows = a.db.prepare('SELECT id FROM doc_revisions WHERE doc_id = ? ORDER BY id').all(doc.id) as Array<{ id: number }>;
    a.db.prepare('UPDATE doc_revisions SET sync_id = ? WHERE id = ?').run('z-first', rows[0]!.id);
    a.db.prepare('UPDATE doc_revisions SET sync_id = ? WHERE id = ?').run('a-second', rows[1]!.id);
    // Fresh capture keeps explicit prior order while assigning new stable history identities.
    a.db.prepare('DELETE FROM sync_history_order WHERE doc_id = ?').run(doc.id);
    a.sync.freezeManual();
    const head = a.sync.head('repo', doc.id)!;
    expect(a.sync.version('repo', head)!.closure.history.map((row) => row.content)).toEqual(['first', 'second']);
    await sendHead(a, b, doc.id);
    expect(b.store.history(doc.id).map((row) => b.store.revisionContent(doc.id, row.id).content)).toEqual(['second', 'first']);
    b.sync.freezeManual();
    expect(b.sync.head('repo', doc.id)).toBe(head);
  });
});
