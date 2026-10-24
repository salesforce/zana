import { describe, expect, it } from 'vitest';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { DESIGN_DOC_MIGRATIONS } from './schema.js';
import { canonicalPeerHash, validatePeerPacket } from '../shared/peer-contract.js';
import { createScopeHash, negotiateProtocol, peerBlobHash, transferQuery, type PeerSessionOffer, type PeerTransfer } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_STORED_BYTES, MAX_PEER_STORED_VERSIONS, PEER_PROTOCOL_VERSION } from '../shared/peer-limits.js';
import { createRoster, requestRetirement } from './peer-slots.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b'].map((name, index) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`,
  sponsorReplicaId: index ? 'replica-a' : null, joinedAt: index + 1 }));
const fence = () => ({ grantEpoch: 1, scope: 'repo-a', signal: new AbortController().signal,
  commitSync: async <T>(fn: () => T): Promise<T> => fn() });

function peer(name: 'a' | 'b', paired = true) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo-a', `replica-${name}`);
  if (paired) sync.setGroup('repo-a', 'group-a', members);
  return { db, store, sync, service: new DesignDocPeerService(sync) };
}
type Peer = ReturnType<typeof peer>;

/** Draft edits journal versions without creating frozen intents. */
function chain(p: Peer, edits: number, title = 'Chain') {
  const doc = p.store.create({ title, template: 'blank' }, actor);
  const heads = [p.sync.head('repo-a', doc.id)!];
  for (let n = 0; n < edits; n++) {
    p.store.writeFile(doc.id, { path: 'README.md', content: `${title} edit ${n}` }, actor);
    heads.push(p.sync.head('repo-a', doc.id)!);
  }
  return { doc, heads };
}
const ids = (offer: { versions: Array<{ operation: { id: string } }> }) => offer.versions.map((version) => version.operation.id);
const fakes = (p: Peer, count: number, compacted = 0) => p.db.runScript(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ${count})
  INSERT INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes, compacted) SELECT 'repo-a', 'fake-' || x, 'fake', 'hash', '{}', 0, ${compacted} FROM n;`);
const compactedHeads = (p: Peer) => (p.db.prepare('SELECT head_id FROM sync_versions WHERE compacted = 1 ORDER BY head_id').all() as Array<{ head_id: string }>)
  .map((row) => row.head_id);

async function stage(to: Peer, from: Peer, transfer: PeerTransfer): Promise<void> {
  await to.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
  for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
    await to.service.receiveTransfer('chunk', 'machine-a', from.sync.outgoingChunk(transfer, blob.hash, index), fence());
  }
}

/** a authors H1 (approved, synced to b) then H2 (draft) and H3 (implemented, intent to b). */
function milestones(a: Peer, b: Peer) {
  const doc = a.store.create({ title: 'Delta', status: 'approved', files: [{ path: 'README.md', content: 'first' }] }, actor);
  const first = a.sync.readyIntents('repo-a')[0]!;
  const offer = a.service.createOffer(first);
  expect(offer.protocolVersion).toBe(PEER_PROTOCOL_VERSION);
  a.sync.acceptReceipt(first, offer, b.sync.apply(offer));
  a.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, actor);
  a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
  const second = a.sync.readyIntents('repo-a')[0]!;
  const [h1, h2, h3] = [first.frozenHead, a.sync.version('repo-a', second.frozenHead)!.operation.parents[0]!, second.frozenHead];
  return { doc, first, second, offer, h1, h2, h3 };
}

describe('protocol negotiation', () => {
  it('negotiates the highest shared version and accepts only supported packet versions', () => {
    expect(PEER_PROTOCOL_VERSION).toBe(3);
    expect(negotiateProtocol({ protocolVersion: 2 })).toBe(2);
    expect(negotiateProtocol({ protocolVersion: 2, maxProtocolVersion: 3 })).toBe(3);
    expect(negotiateProtocol({ protocolVersion: 2, maxProtocolVersion: 9 })).toBe(3);
    expect(negotiateProtocol({ protocolVersion: 2, maxProtocolVersion: '3' })).toBe(2);
    expect(negotiateProtocol({ protocolVersion: 2, maxProtocolVersion: 2.5 })).toBe(2);
    expect(negotiateProtocol({ protocolVersion: 3, maxProtocolVersion: 2 })).toBe(3);
    for (const version of [2, 3]) expect(() => validatePeerPacket({ protocolVersion: version })).not.toThrow();
    for (const version of [1, 4, 2.5, '3', null]) expect(() => validatePeerPacket({ protocolVersion: version })).toThrow('unsupported peer protocol version');
  });

  it('appends one migration for the compaction marker and negotiated protocol rows', () => {
    const { db } = peer('a');
    expect(DESIGN_DOC_MIGRATIONS.some((sql) => sql.includes('ADD COLUMN compacted'))).toBe(true);
    expect((db.prepare('PRAGMA table_info(sync_versions)').all() as Array<{ name: string; dflt_value: string }>)
      .find((column) => column.name === 'compacted')).toMatchObject({ dflt_value: '0' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_peer_protocols').get()).toEqual({ n: 0 });
  });
});

describe('protocol-3 delta offers', () => {
  it('omits only ancestry the recipient is known to hold and rebuilds full closures for protocol-2 peers', () => {
    const a = peer('a'), b = peer('b');
    const { second, h1, h2, h3, doc, offer } = milestones(a, b);
    expect(a.db.prepare("SELECT head_id FROM sync_peer_known WHERE member_replica_id = 'replica-b'").all()).toEqual([{ head_id: h1 }]);
    const delta = a.service.createOffer(second);
    expect(ids(delta)).toEqual([h2, h3]);
    expect(b.sync.apply(delta)).toMatchObject({ stage: 'synced', appliedHeads: { [doc.id]: h3 } });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('second');
    a.sync.acceptReceipt(second, delta, b.sync.apply(delta));
    // Known sets stay ancestry-closed: marking H3 adds H2 and H3 and stops at the known H1.
    expect(a.db.prepare("SELECT COUNT(*) AS n FROM sync_peer_known WHERE member_replica_id = 'replica-b'").get()).toEqual({ n: 3 });

    // A receiver that does not hold the omitted parent, or holds it for another document, rejects the delta.
    const fresh = peer('b');
    expect(() => fresh.sync.apply(delta)).toThrow('missing, out-of-order or cross-document parent');
    const crossed = peer('b');
    crossed.sync.apply(offer);
    crossed.db.prepare("UPDATE sync_operations SET doc_id = 'other' WHERE op_id = ?").run(h1);
    expect(() => crossed.sync.apply(delta)).toThrow('missing, out-of-order or cross-document parent');
    // Protocol 2 never consults local parents, even for a receiver that holds them.
    const { scopeHash: _scope, ...body } = { ...delta, protocolVersion: 2, sessionId: 'v2-delta' };
    expect(() => b.sync.apply({ ...body, scopeHash: createScopeHash(body) })).toThrow('missing, out-of-order or cross-document parent');
  });

  it('downgrades persisted delta offers to full closures and keeps protocol-2 offers on upgrade', () => {
    const a = peer('a'), b = peer('b');
    const { second, h1, h2, h3 } = milestones(a, b);
    const delta = a.service.createOffer(second, 3);
    expect(a.service.createOffer(second, 3)).toEqual(delta);
    const full = a.service.createOffer(second, 2);
    expect(full).toMatchObject({ protocolVersion: 2 });
    expect(full.sessionId).not.toBe(delta.sessionId);
    expect(ids(full)).toEqual([h1, h2, h3]);
    expect(a.service.createOffer(second, 3)).toEqual(full);
    expect(peer('b').sync.apply(full).stage).toBe('synced');
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_outgoing_sessions').get()).toEqual({ n: 2 });
  });

  it('fails closed when a downgraded peer needs compacted ancestry', () => {
    const a = peer('a'), b = peer('b');
    const { second, h1 } = milestones(a, b);
    a.service.createOffer(second, 3);
    a.db.prepare("UPDATE sync_versions SET closure_json = '{}', bytes = 0, compacted = 1 WHERE head_id = ?").run(h1);
    expect(() => a.service.createOffer(second, 2)).toThrow('manual bootstrap required');
    expect(() => a.service.createTransfer(second, 1, 2)).toThrow('manual bootstrap required');
  });

  it('stages delta transfers against local parents, fences vanished parents at apply and downgrades transfers', async () => {
    const a = peer('a'), b = peer('b');
    const doc = a.store.create({ title: 'Transfer', status: 'approved', files: [{ path: 'README.md', content: 'first' }] }, actor);
    const first = a.sync.readyIntents('repo-a')[0]!;
    const initial = a.service.createTransfer(first, 1);
    const vanished = peer('b');
    await stage(vanished, a, initial);
    await vanished.service.receiveTransfer('apply', 'machine-a', transferQuery(initial), fence());
    await stage(b, a, initial);
    const receipt = await b.service.receiveTransfer('apply', 'machine-a', transferQuery(initial), fence());
    a.sync.acceptTransferReceipt(first, initial, receipt as never);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, actor);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
    const second = a.sync.readyIntents('repo-a')[0]!;
    const delta = a.service.createTransfer(second, 1);
    expect(delta.versions).toHaveLength(2);
    expect(delta.versions.map((version) => version.operation.id)).not.toContain(first.frozenHead);

    const fresh = peer('b');
    await expect(fresh.service.receiveTransfer('transfer', 'machine-a', delta, fence())).rejects.toThrow('missing or cross-document transfer ancestry');

    // The authoritative fence inside the commit rejects a parent that disappeared after staging.
    await stage(vanished, a, delta);
    vanished.db.prepare('DELETE FROM sync_operations WHERE op_id = ?').run(first.frozenHead);
    await expect(vanished.service.receiveTransfer('apply', 'machine-a', transferQuery(delta), fence())).rejects.toThrow('neither offered nor held locally');

    await stage(b, a, delta);
    expect(await b.service.receiveTransfer('apply', 'machine-a', transferQuery(delta), fence())).toMatchObject({ stage: 'synced' });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('second');

    const full = a.service.createTransfer(second, 1, 2);
    expect(full.protocolVersion).toBe(2); expect(full.sessionId).not.toBe(delta.sessionId);
    expect(full.versions.map((version) => version.operation.id)).toContain(first.frozenHead);
    expect(a.db.prepare("SELECT session_id FROM sync_transfers WHERE direction = 'out' AND intent_id = ?").all(second.id)).toEqual([{ session_id: full.sessionId }]);
    expect(a.db.prepare("SELECT COUNT(*) AS n FROM sync_transfer_chunks WHERE direction = 'out' AND session_id = ?").get(delta.sessionId)).toEqual({ n: 0 });
    expect(a.service.createTransfer(second, 1, 3)).toEqual(full);
  });
});

describe('closure-only compaction', () => {
  it('is gated on a configured, non-retiring group whose current members all negotiated delta offers', () => {
    const lonely = peer('a', false);
    expect(lonely.sync.compactionBlocker()).toBe('sync group is not configured');
    expect(lonely.sync.compact()).toEqual({ compacted: 0, blocked: 'sync group is not configured' });
    const bareDb = createTestDatabase(); new DesignDocStore(bareDb);
    const bare = new DesignDocSyncStore(bareDb);
    expect(() => bare.recordPeerProtocol('replica-b', 3)).toThrow('negotiated peer protocol is invalid');
    expect(bare.peerProtocol('replica-b')).toBeNull();

    const { sync, db } = peer('a');
    expect(sync.compactionBlocker()).toBe('member replica-b has not negotiated delta protocol');
    sync.recordPeerProtocol('replica-b', 2);
    expect(sync.compactionBlocker()).toBe('member replica-b has not negotiated delta protocol');
    for (const invalid of [1, 4, 2.5]) expect(() => sync.recordPeerProtocol('replica-b', invalid)).toThrow('invalid');
    sync.recordPeerProtocol('replica-b', 3);
    expect(sync.peerProtocol('replica-b')).toBe(3); expect(sync.peerProtocol('replica-z')).toBeNull();
    expect(sync.compactionBlocker()).toBeNull();
    // A retiring remote member is no longer a data recipient and does not hold the gate closed.
    sync.recordPeerProtocol('replica-b', 2);
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(requestRetirement(root, 'replica-a', 'replica-b')));
    expect(sync.compactionBlocker()).toBeNull();
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(requestRetirement(root, 'replica-b', 'replica-a')));
    expect(sync.compactionBlocker()).toBe('retiring replica cannot compact retained history');
  });

  it('compacts unpinned closures oldest first, keeps every operation row and collects orphaned blobs', () => {
    const a = peer('a');
    const { doc, heads } = chain(a, 4);
    a.sync.recordPeerProtocol('replica-b', 3);
    const orphan = Buffer.from('orphan blob');
    a.db.prepare('INSERT INTO sync_blobs VALUES (?, ?, ?)').run(peerBlobHash(orphan), orphan, orphan.length);
    const blob = () => a.db.prepare('SELECT 1 AS present FROM sync_blobs WHERE hash = ?').get(peerBlobHash(orphan));
    expect(a.sync.compact(0)).toEqual({ compacted: 0, blocked: null });
    expect(blob()).toEqual({ present: 1 });
    expect(a.sync.compact(2)).toEqual({ compacted: 2, blocked: null });
    expect(blob()).toBeUndefined();
    expect(heads.map((head) => a.sync.version('repo-a', head) !== null)).toEqual([false, false, true, true, true]);
    expect(a.db.prepare('SELECT closure_json, bytes FROM sync_versions WHERE head_id = ?').get(heads[0])).toEqual({ closure_json: '{}', bytes: 0 });
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_version_blobs WHERE head_id IN (?, ?)').get(heads[0], heads[1])).toEqual({ n: 0 });
    expect(a.sync.compact()).toEqual({ compacted: 2, blocked: null });
    expect(a.sync.compact()).toEqual({ compacted: 0, blocked: null });
    expect(a.sync.operations('repo-a')).toHaveLength(5);
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_versions').get()).toEqual({ n: 5 });
    expect(a.sync.version('repo-a', heads[4]!)!.closure.files[0]!.content).toBe('Chain edit 3');
    // Ancestry stays answerable from operation rows; the next edit still journals causally.
    a.store.writeFile(doc.id, { path: 'README.md', content: 'after compaction' }, actor);
    expect(a.sync.version('repo-a', a.sync.head('repo-a', doc.id)!)!.operation.parents).toEqual([heads[4]]);
  });

  it('pins heads, unsent intent ancestry down to the known frontier, and live session heads', () => {
    const a = peer('a');
    const { heads: h } = chain(a, 5, 'Pinned');
    const { doc: synced, heads: g } = chain(a, 2, 'Synced');
    const { heads: s } = chain(a, 3, 'Sessions');
    a.sync.recordPeerProtocol('replica-b', 3);
    for (const head of [h[0], h[1]]) a.db.prepare("INSERT INTO sync_peer_known VALUES ('repo-a', 'replica-b', ?)").run(head);
    const intent = a.db.prepare("INSERT INTO sync_intents VALUES (?, 'repo-a', ?, ?, 'replica-b', 'scope', ?, 1, 1)");
    const pinnedDoc = a.sync.version('repo-a', h[0]!)!.operation.docId;
    intent.run('pending-3', pinnedDoc, h[3], 'pending');
    intent.run('blocked-4', pinnedDoc, h[4], 'blocked');
    intent.run('synced-1', synced.id, g[1], 'synced');
    a.db.prepare("INSERT INTO sync_outgoing_sessions VALUES ('offer', ?)").run(JSON.stringify({ heads: { d: s[0] } }));
    const transfer = a.db.prepare("INSERT INTO sync_transfers (direction, repo_id, sender_replica_id, session_id, intent_id, header_json) VALUES ('out', 'repo-a', 'replica-a', ?, NULL, ?)");
    transfer.run('with-heads', JSON.stringify({ heads: { d: s[1] } }));
    transfer.run('headless', JSON.stringify({}));
    a.db.prepare("INSERT INTO sync_manual_sessions VALUES ('manual', 'repo-a', 'replica-b', 'out', 'waiting', ?, 1)").run(JSON.stringify({ d: s[2] }));
    const pins = a.sync.retentionPins('repo-a');
    expect([...h, ...g, ...s].filter((head) => pins.has(head)).sort()).toEqual([h[1], h[2], h[3], h[4], h[5], g[2], ...s].sort());
    expect(a.sync.compact().compacted).toBe(3);
    expect(compactedHeads(a)).toEqual([h[0], g[0], g[1]].sort());
  });

  it('pins unresolved forks with both sides and the merge bases a later review needs', () => {
    const a = peer('a');
    const doc = a.store.create({ title: 'Merge', files: [{ path: 'README.md', content: 'zero' }] }, actor);
    const genesis = a.sync.head('repo-a', doc.id)!;
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree' }, actor);
    const base = a.sync.head('repo-a', doc.id)!;
    const remote = structuredClone(a.sync.version('repo-a', base)!);
    remote.operation = { ...remote.operation, id: 'remote-head', replicaId: 'replica-b', sequence: 1, parents: [base] };
    remote.closure.files[0]!.content = 'one\ntwo\nTHREE';
    remote.operation.payloadHash = canonicalPeerHash(remote.closure);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, actor);
    const localHead = a.sync.head('repo-a', doc.id)!;
    const body = { protocolVersion: 3, repoId: 'repo-a', senderReplicaId: 'replica-b', recipientReplicaId: 'replica-a',
      grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1, sessionId: 'fork', versions: [remote], heads: { [doc.id]: 'remote-head' } };
    expect(a.sync.apply({ ...body, scopeHash: createScopeHash(body) } as PeerSessionOffer).stage).toBe('conflict');
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    a.db.prepare("INSERT INTO sync_conflicts VALUES ('repo-a', 'ghost', '', 'remote-head')").run();
    a.sync.recordPeerProtocol('replica-b', 3);
    const pins = a.sync.retentionPins('repo-a');
    for (const head of [base, localHead, 'remote-head', a.sync.head('repo-a', doc.id)!]) expect(pins.has(head)).toBe(true);
    expect(pins.has('')).toBe(false);
    expect(a.sync.compact()).toEqual({ compacted: 1, blocked: null });
    expect(compactedHeads(a)).toEqual([genesis]);
    expect(a.sync.conflictCandidate(doc.id, 'remote-head').conflicts).not.toContain('common ancestor unavailable');
  });

  it('relieves version capacity by compacting before a write and rejects atomically when pins leave nothing', () => {
    const a = peer('a');
    const { doc, heads } = chain(a, 3);
    a.sync.recordPeerProtocol('replica-b', 3);
    fakes(a, MAX_PEER_STORED_VERSIONS - heads.length);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'relieved' }, actor);
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('relieved');
    expect(compactedHeads(a)).toEqual(heads.slice(0, 3).sort());

    const pinned = peer('a');
    const only = pinned.store.create({ title: 'Pinned', template: 'blank' }, actor);
    pinned.sync.recordPeerProtocol('replica-b', 3);
    fakes(pinned, MAX_PEER_STORED_VERSIONS - 1);
    const before = pinned.store.get(only.id), operations = pinned.sync.operations('repo-a');
    expect(() => pinned.store.writeFile(only.id, { path: 'README.md', content: 'refused' }, actor)).toThrow('durable version capacity reached');
    expect(pinned.store.get(only.id)).toEqual(before); expect(pinned.sync.operations('repo-a')).toEqual(operations);
  });

  it('rolls relief back with the rejected write when bytes stay over capacity, and ignores compacted rows in the count', () => {
    const a = peer('a');
    const { doc, heads } = chain(a, 2);
    a.sync.recordPeerProtocol('replica-b', 3);
    a.db.prepare("INSERT INTO sync_versions VALUES ('repo-a', 'huge', 'fake', 'hash', '{}', ?, 0)").run(MAX_PEER_STORED_BYTES);
    expect(() => a.store.writeFile(doc.id, { path: 'README.md', content: 'too big' }, actor)).toThrow('storage capacity reached');
    expect(compactedHeads(a)).toEqual([]);
    expect(heads.every((head) => a.sync.version('repo-a', head) !== null)).toBe(true);

    const counted = peer('a');
    const draft = counted.store.create({ title: 'Count', template: 'blank' }, actor);
    fakes(counted, MAX_PEER_STORED_VERSIONS, 1);
    counted.store.writeFile(draft.id, { path: 'README.md', content: 'fits' }, actor);
    expect(counted.store.readFile(draft.id, 'README.md').content).toBe('fits');
  });

  it('rehydrates a compacted closure when the payload is offered again, including as a delta', () => {
    const a = peer('a');
    const { doc, heads } = chain(a, 2);
    const [v0, v1] = [structuredClone(a.sync.version('repo-a', heads[0]!)!), structuredClone(a.sync.version('repo-a', heads[1]!)!)];
    a.sync.recordPeerProtocol('replica-b', 3);
    expect(a.sync.compact().compacted).toBe(2);
    const offer = (sessionId: string, protocolVersion: number, versions: typeof v0[], head: string) => {
      const body = { protocolVersion, repoId: 'repo-a', senderReplicaId: 'replica-b', recipientReplicaId: 'replica-a',
        grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1, sessionId, versions, heads: { [doc.id]: head } };
      return { ...body, scopeHash: createScopeHash(body) } as PeerSessionOffer;
    };
    expect(a.sync.apply(offer('full', 2, [v0], heads[0]!))).toMatchObject({ stage: 'merged', appliedHeads: { [doc.id]: heads[2] } });
    expect(a.sync.version('repo-a', heads[0]!)).toEqual(v0);
    expect(compactedHeads(a)).toEqual([heads[1]]);
    // The replayed head is now the sender's known frontier, so it stays pinned.
    expect(a.sync.compact().compacted).toBe(0);
    expect(a.sync.apply(offer('delta', 3, [v1], heads[1]!)).stage).toBe('merged');
    expect(a.sync.version('repo-a', heads[1]!)).toEqual(v1);
    expect(compactedHeads(a)).toEqual([]);
  });
});
