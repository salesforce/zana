import { describe, expect, it } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore, delivered } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { isDeletionClosure, validateDocumentClosure } from '../shared/peer-contract.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const roster = ['a', 'b', 'c'].map((name) => ({ replicaId: `replica-${name}`, machineId: `app-${name}`, joinedAt: 1, sponsorReplicaId: null }));
type Peer = ReturnType<typeof fixture>;

function fixture(name: string, size = 2, maxTombstones?: number) {
  const db = createTestDatabase();
  let now = 1000;
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db, { now: () => now, ...(maxTombstones !== undefined ? { maxTombstones } : {}) });
  sync.initialize('repo', `replica-${name}`); sync.setGroup('repo', 'group', roster.slice(0, size));
  const service = new DesignDocPeerService(sync);
  return { db, store, sync, service, name, advance: (ms: number) => { now += ms; } };
}
const fence = () => ({ scope: 'repo', grantEpoch: 1, signal: new AbortController().signal,
  commitSync: async <T>(fn: () => T): Promise<T> => fn() });
function transport(from: Peer, to: Peer, online = () => true): PluginSdkPeers {
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
  const peers: PluginSdkPeers = {
    list: async () => [{ id: `app-${to.name}`, name: to.name, scope: 'repo', grantEpoch: 1, connected: online() }],
    handle: () => {},
    call: async (_peer, method, body) => {
      const handler = handlers.get(method);
      if (!handler) throw new Error(`missing ${method}`);
      return handler({ peerId: `app-${from.name}`, body, ...fence() });
    }
  };
  to.service.register({ sdk: { peers: { ...peers, handle: (method, handler) => handlers.set(method, handler) } }, onDispose: () => {} } as unknown as ZccPluginApi);
  return peers;
}
const rows = (peer: Peer, docId: string) => ['docs', 'doc_files', 'doc_revisions', 'doc_comments', 'doc_threads']
  .map((table) => (peer.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'docs' ? 'id' : 'doc_id'} = ?`).get(docId) as { n: number }).n);
const shared = (peer: Peer, title: string) => peer.store.create({ title, status: 'approved', files: [{ path: 'README.md', content: `${title} body` }] }, actor);
const tombstone = (peer: Peer, docId: string) => {
  const head = peer.sync.head('repo', docId);
  return head ? isDeletionClosure(peer.sync.version('repo', head)!.closure) : null;
};
/** An offer of `from`'s current head of `docId` to `to`, as a replica that never heard of a later change would send. */
function staleOffer(from: Peer, to: Peer, docId: string) {
  const head = from.sync.head('repo', docId)!, member = `replica-${to.name}`;
  const prior = from.db.prepare('SELECT id, state FROM sync_intents WHERE doc_id = ? AND frozen_head = ? AND member_replica_id = ?')
    .get(docId, head, member) as { id: string; state: string } | undefined;
  const id = prior?.id ?? `stale-${docId}`;
  if (prior) from.db.prepare("UPDATE sync_intents SET state = 'pending' WHERE id = ?").run(id);
  else from.db.prepare("INSERT INTO sync_intents VALUES (?, 'repo', ?, ?, ?, ?, 'pending', 1, 1)")
    .run(id, docId, head, member, from.sync.version('repo', head)!.operation.payloadHash);
  const offer = from.service.createOffer(from.sync.readyIntents('repo', 100, true).find((intent) => intent.id === id)!);
  if (prior) from.db.prepare('UPDATE sync_intents SET state = ? WHERE id = ?').run(prior.state, id);
  else from.db.prepare('DELETE FROM sync_intents WHERE id = ?').run(id);
  return offer;
}
const pendingFor =(peer: Peer, docId: string) => peer.db.prepare("SELECT COUNT(*) AS n FROM sync_intents WHERE doc_id = ? AND state = 'pending'").get(docId) as { n: number };

describe('paired whole-document deletion', () => {
  it('propagates A to B: files, history, comments and threads are gone on both, idempotently', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Shared');
    a.store.addComment(doc.id, { body: 'review me', path: 'README.md' }, actor);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo', doc.id) }, actor);
    const ab = transport(a, b);
    await a.service.deliverPending(ab);
    expect(b.store.find(doc.id)).not.toBeNull();
    expect(rows(b, doc.id)[3]).toBe(1);
    a.store.remove(doc.id, actor);
    expect(rows(a, doc.id)).toEqual([0, 0, 0, 0, 0]);
    expect(await a.service.deliverPending(ab)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.find(doc.id)).toBeNull();
    expect(rows(b, doc.id)).toEqual([0, 0, 0, 0, 0]);
    expect(b.sync.head('repo', doc.id)).toBe(a.sync.head('repo', doc.id));
    expect(tombstone(b, doc.id)).toBe(true);
    // No echo back to the deleter, and nothing left to deliver anywhere.
    expect(b.sync.readyIntents('repo', 100, true)).toEqual([]);
    expect(a.sync.readyIntents('repo', 100, true)).toEqual([]);
    // Replaying the same tombstone version is a no-op.
    const replay = b.sync.version('repo', b.sync.head('repo', doc.id)!)!;
    expect(replay.operation.kind).toBe('delete');
    expect(await a.service.deliverPending(ab)).toEqual({ attempted: 0, synced: 0, blocked: 0 });
  });

  it('an offline peer applies the delete when it reconnects', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Offline');
    let online = true;
    const ab = transport(a, b, () => online);
    await a.service.deliverPending(ab);
    online = false;
    a.store.remove(doc.id, actor);
    expect(await a.service.deliverPending(ab)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(b.store.find(doc.id)).not.toBeNull();
    expect(pendingFor(a, doc.id).n).toBe(1);
    online = true;
    a.advance(24 * 60 * 60 * 1000);
    expect(await a.service.deliverPending(ab)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.find(doc.id)).toBeNull();
    expect(tombstone(b, doc.id)).toBe(true);
  });

  it('edit-vs-delete is deterministic: a concurrent edit survives on every peer, in either delivery order', async () => {
    for (const order of ['delete-first', 'edit-first'] as const) {
      const a = fixture('a'), b = fixture('b');
      const doc = shared(a, `Race ${order}`);
      const ab = transport(a, b), ba = transport(b, a);
      await a.service.deliverPending(ab);
      b.store.writeFile(doc.id, { path: 'README.md', content: 'concurrent edit' }, actor);
      b.store.update(doc.id, { status: 'implemented', expectedHead: b.sync.head('repo', doc.id) }, actor);
      const edit = b.sync.head('repo', doc.id)!;
      a.store.remove(doc.id, actor);
      if (order === 'delete-first') {
        const result = await a.service.deliverPending(ab);
        expect(result.synced).toBe(1); // 'merged' is terminal: the receiver kept its edit and owes it back.
        expect(b.store.readFile(doc.id, 'README.md').content).toBe('concurrent edit');
        await b.service.deliverPending(ba);
      } else {
        await b.service.deliverPending(ba);
        expect(a.store.readFile(doc.id, 'README.md').content).toBe('concurrent edit');
        await a.service.deliverPending(ab);
      }
      for (const peer of [a, b]) {
        expect(peer.store.readFile(doc.id, 'README.md').content).toBe('concurrent edit');
        expect(peer.sync.head('repo', doc.id)).toBe(edit);
        expect(tombstone(peer, doc.id)).toBe(false);
      }
    }
  });

  it('a delete made after seeing an edit wins over it', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Seen edit');
    const ab = transport(a, b), ba = transport(b, a);
    await a.service.deliverPending(ab);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'edit seen by deleter' }, actor);
    b.store.update(doc.id, { status: 'implemented', expectedHead: b.sync.head('repo', doc.id) }, actor);
    await b.service.deliverPending(ba);
    a.store.remove(doc.id, actor);
    await a.service.deliverPending(ab);
    expect(b.store.find(doc.id)).toBeNull();
    expect(tombstone(b, doc.id)).toBe(true);
  });

  it('concurrent deletes converge on one tombstone', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Both delete');
    const ab = transport(a, b), ba = transport(b, a);
    await a.service.deliverPending(ab);
    a.store.remove(doc.id, actor); b.store.remove(doc.id, actor);
    const heads = [a.sync.head('repo', doc.id)!, b.sync.head('repo', doc.id)!].sort();
    expect(heads[0]).not.toBe(heads[1]);
    await a.service.deliverPending(ab); await b.service.deliverPending(ba);
    for (const peer of [a, b]) {
      expect(peer.store.find(doc.id)).toBeNull();
      expect(peer.sync.head('repo', doc.id)).toBe(heads[0]);
    }
  });

  it('an older replica re-sending a pre-delete version never resurrects the doc', async () => {
    const a = fixture('a', 3), b = fixture('b', 3), c = fixture('c', 3);
    const doc = shared(a, 'Stale');
    await a.service.deliverPending(transport(a, b));
    a.advance(24 * 60 * 60 * 1000);
    await a.service.deliverPending(transport(a, c));
    expect(c.store.find(doc.id)).not.toBeNull();
    a.store.remove(doc.id, actor);
    await a.service.deliverPending(transport(a, b));
    expect(b.store.find(doc.id)).toBeNull();
    // C has not heard of the delete and offers its (older) version to B.
    const receipt = await b.service.offer('app-c', staleOffer(c, b, doc.id), fence());
    expect(receipt.stage).toBe('merged');
    expect(delivered(receipt.stage)).toBe(true);
    expect(b.store.find(doc.id)).toBeNull();
    expect(tombstone(b, doc.id)).toBe(true);
  });

  it('a pruned tombstone still fences stale replays; the cap never prunes a tombstone still owed to a member', async () => {
    const a = fixture('a', 2, 1), b = fixture('b', 2, 1);
    let online = true;
    const ab = transport(a, b, () => online);
    const first = shared(a, 'First'), second = shared(a, 'Second');
    await a.service.deliverPending(ab);
    const stale = staleOffer(a, b, first.id);
    online = false;
    a.store.remove(first.id, actor); a.advance(1); a.store.remove(second.id, actor);
    // Both deletions are still owed to B, so both heads stay despite the cap of one.
    expect(tombstone(a, first.id)).toBe(true);
    expect(tombstone(a, second.id)).toBe(true);
    await a.service.deliverPending(ab);
    online = true; a.advance(24 * 60 * 60 * 1000);
    await a.service.deliverPending(ab);
    expect([first, second].map((doc) => b.store.find(doc.id))).toEqual([null, null]);
    // Delivered: the oldest tombstone head is pruned on both sides; its operation row remains.
    for (const peer of [a, b]) {
      expect(peer.sync.head('repo', first.id)).toBeNull();
      expect(tombstone(peer, second.id)).toBe(true);
      expect(peer.sync.operations('repo').some((op) => op.docId === first.id && op.kind === 'delete')).toBe(true);
    }
    const receipt = await b.service.offer('app-a', stale, fence());
    expect(receipt.stage).toBe('merged');
    expect(b.store.find(first.id)).toBeNull();
  });

  it('deleting a never-shared draft stays local and freezes nothing', () => {
    const a = fixture('a');
    const draft = a.store.create({ title: 'Private draft', template: 'blank' }, actor);
    a.store.remove(draft.id, actor);
    expect(a.store.find(draft.id)).toBeNull();
    expect(tombstone(a, draft.id)).toBe(true);
    expect(a.sync.readyIntents('repo', 100, true)).toEqual([]);
  });

  it('a delete supersedes older undelivered versions of the same doc', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Superseded');
    a.store.remove(doc.id, actor);
    expect(a.db.prepare("SELECT state FROM sync_intents WHERE doc_id = ? ORDER BY created_at, id").all(doc.id).map((row) => (row as { state: string }).state).sort())
      .toEqual(['blocked', 'pending']);
    await a.service.deliverPending(transport(a, b));
    // B never held it; it records the tombstone so a later stale copy cannot resurrect it.
    expect(b.store.find(doc.id)).toBeNull();
    expect(tombstone(b, doc.id)).toBe(true);
  });

  it('rejects tombstones that carry content and operations whose kind does not match the payload', async () => {
    const at = 1, by = JSON.stringify(actor);
    const doc = { id: 'doc-1', slug: 'deleted', title: 'Deleted design doc', summary: '', status: 'archived', project_id: null, tags: [],
      entry_path: 'README.md', created_at: at, updated_at: at, created_by: by, updated_by: by };
    const file = { sync_id: 'f1', path: 'README.md', content: 'x', encoding: 'utf8', size: 1, updated_at: at, updated_by: by };
    expect(() => validateDocumentClosure({ doc, files: [file], history: [], comments: [], threads: [], deleted: { at, by } }))
      .toThrow('must not carry document content');
    expect(() => validateDocumentClosure({ doc, files: [], history: [], comments: [], threads: [] })).toThrow('missing entry path');
    expect(validateDocumentClosure({ doc, files: [], history: [], comments: [], threads: [], deleted: { at, by } }).deleted).toEqual({ at, by });

    const a = fixture('a'), b = fixture('b');
    shared(a, 'Forged');
    const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    const forged = { ...offer, versions: offer.versions.map((version) => ({ ...version, operation: { ...version.operation, kind: 'delete' } })) };
    expect(() => b.sync.apply(forged)).toThrow();
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM docs').get()).toEqual({ n: 0 });
  });

  it('a delete covers held forks, ignores unknown ones, and refuses through too many', () => {
    const a = fixture('a');
    const fork = (docId: string, remote: string) => a.db.prepare('INSERT INTO sync_conflicts (repo_id, doc_id, local_head, remote_head) VALUES (?, ?, ?, ?)')
      .run('repo', docId, a.sync.head('repo', docId), remote);
    const covered = shared(a, 'Covered'), other = shared(a, 'Other');
    const head = a.sync.head('repo', covered.id)!, otherHead = a.sync.head('repo', other.id)!;
    fork(covered.id, otherHead); fork(covered.id, 'missing-op');
    a.store.remove(covered.id, actor);
    expect(a.sync.version('repo', a.sync.head('repo', covered.id)!)!.operation.parents).toEqual([head, otherHead].sort());
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_conflicts WHERE doc_id = ?').get(covered.id)).toEqual({ n: 0 });
    const doc = shared(a, 'Forked');
    for (let index = 0; index < 8; index++) fork(doc.id, a.sync.head('repo', shared(a, `Fork ${index}`).id)!);
    expect(() => a.store.remove(doc.id, actor)).toThrow('resolve');
    expect(a.store.find(doc.id)).not.toBeNull();
    expect(tombstone(a, doc.id)).toBe(false);
  });
});
