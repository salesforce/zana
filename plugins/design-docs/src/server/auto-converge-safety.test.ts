import { describe, expect, it } from 'vitest';
import { DesignDocPeerService } from './peer-service.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
type Peer = ReturnType<typeof fixture>;

function fixture(name: string, members = ['a', 'b'], enabled = true) {
  const db = createTestDatabase();
  let now = 1_000;
  let sequence = 0;
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: mutation => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db, {
    autoConverge: () => enabled,
    now: () => now,
    randomId: () => `${name}-${String(++sequence).padStart(4, '0')}`
  });
  sync.initialize('repo', `replica-${name}`);
  sync.setGroup('repo', 'group', members.map(member => ({
    replicaId: `replica-${member}`, machineId: `machine-${member}`, sponsorReplicaId: null, joinedAt: 1
  })));
  return { db, store, sync, service: new DesignDocPeerService(sync), advance: (ms: number) => { now += ms; } };
}

function setup(members = ['a', 'b'], enabled = true) {
  const peers = Object.fromEntries(members.map(name => [name, fixture(name, members, enabled)])) as Record<string, Peer>;
  const a = peers.a!;
  const doc = a.store.create({
    title: 'Safety', template: 'blank', status: 'approved', files: [{ path: 'README.md', content: 'base' }]
  }, actor);
  const send = (from: Peer, to: Peer, head = from.sync.head('repo', doc.id)!) => {
    const version = from.sync.version('repo', head)!;
    from.sync.createFrozenIntents('repo', doc.id, head, version.operation.payloadHash);
    const recipient = to.sync.localRepository()!.replicaId;
    let intent = from.sync.readyIntents('repo', 100, true).find(row => row.frozenHead === head && row.memberReplicaId === recipient);
    if (!intent) {
      // Exercise receipt/replay paths after settlement has marked original delivery synced.
      from.db.prepare(`INSERT INTO sync_intents VALUES (?, 'repo', ?, ?, ?, ?, 'pending', 1, 1)
        ON CONFLICT (repo_id, doc_id, frozen_head, member_replica_id) DO UPDATE SET state = 'pending'`)
        .run(`test-${head}-${recipient}`, doc.id, head, recipient, version.operation.payloadHash);
      intent = from.sync.readyIntents('repo', 100, true).find(row => row.frozenHead === head && row.memberReplicaId === recipient)!;
    }
    const offer = from.service.createOffer(intent);
    const receipt = to.sync.apply(offer);
    from.sync.acceptReceipt(intent, offer, receipt);
    return receipt;
  };
  for (const peer of Object.values(peers).filter(peer => peer !== a)) send(a, peer);
  return { peers, doc, send };
}

function archive(peer: Peer, docId: string) {
  peer.store.update(docId, { status: 'archived', expectedHead: peer.sync.head('repo', docId)! }, actor);
}

describe('automatic convergence safety boundaries', () => {
  it('settles identical archives whichever side receives first', () => {
    for (const direction of ['a-to-b', 'b-to-a'] as const) {
      const { peers, doc, send } = setup();
      archive(peers.a!, doc.id); archive(peers.b!, doc.id);
      const heads = [peers.a!.sync.head('repo', doc.id)!, peers.b!.sync.head('repo', doc.id)!].sort();
      if (direction === 'a-to-b') {
        expect(send(peers.a!, peers.b!).stage).toBe('merged');
        send(peers.b!, peers.a!);
      } else {
        expect(send(peers.b!, peers.a!).stage).toBe('merged');
        send(peers.a!, peers.b!);
      }
      expect(peers.a!.sync.head('repo', doc.id)).toBe(heads[0]);
      expect(peers.b!.sync.head('repo', doc.id)).toBe(heads[0]);
    }
  });

  it('ignores mapping, history, timestamps, and file identities for semantic equality', () => {
    const { peers, doc, send } = setup();
    const b = peers.b!;
    b.db.prepare("UPDATE docs SET project_id = 'foreign-project' WHERE id = ?").run(doc.id);
    b.db.prepare("UPDATE doc_files SET sync_id = 'other-file', updated_at = 999 WHERE doc_id = ?").run(doc.id);
    b.db.prepare("UPDATE doc_revisions SET sync_id = 'other-history', created_at = 999 WHERE doc_id = ?").run(doc.id);
    archive(peers.a!, doc.id); archive(b, doc.id);
    expect(send(peers.a!, b).stage).toBe('merged');
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it.each([
    ['file content', (a: Peer, b: Peer, docId: string) => {
      a.store.writeFile(docId, { path: 'README.md', content: 'left' }, actor);
      b.store.writeFile(docId, { path: 'README.md', content: 'right' }, actor);
    }],
    ['title', (a: Peer, b: Peer, docId: string) => {
      a.store.update(docId, { title: 'Left', expectedHead: a.sync.head('repo', docId)! }, actor);
      b.store.update(docId, { title: 'Right', expectedHead: b.sync.head('repo', docId)! }, actor);
    }]
  ])('keeps different %s as forks', (_name, edit) => {
    const { peers, doc, send } = setup();
    edit(peers.a!, peers.b!, doc.id);
    peers.a!.sync.freezeManual(); peers.b!.sync.freezeManual();
    expect(send(peers.a!, peers.b!).stage).toBe('conflict');
    expect(peers.b!.sync.conflicts(doc.id).remoteHeads).toEqual([peers.a!.sync.head('repo', doc.id)!]);
  });

  it('keeps overlapping text edits as a fork', () => {
    const { peers, doc, send } = setup();
    peers.a!.store.writeFile(doc.id, { path: 'README.md', content: 'left\ntwo' }, actor);
    peers.b!.store.writeFile(doc.id, { path: 'README.md', content: 'right\ntwo' }, actor);
    peers.a!.sync.freezeManual(); peers.b!.sync.freezeManual();
    expect(send(peers.a!, peers.b!).stage).toBe('conflict');
    expect(peers.b!.sync.conflicts(doc.id).remoteHeads).toHaveLength(1);
  });

  it('keeps fork when unique merge base has compacted payload', () => {
    const { peers, doc, send } = setup();
    const base = peers.a!.sync.head('repo', doc.id)!;
    peers.a!.store.writeFile(doc.id, { path: 'README.md', content: 'left\nbase' }, actor);
    peers.b!.store.writeFile(doc.id, { path: 'README.md', content: 'base\nright' }, actor);
    peers.a!.sync.freezeManual(); peers.b!.sync.freezeManual();
    peers.b!.db.prepare("UPDATE sync_versions SET compacted = 1, closure_json = '{}', bytes = 0 WHERE repo_id = 'repo' AND head_id = ?").run(base);
    expect(send(peers.a!, peers.b!).stage).toBe('conflict');
    expect(peers.b!.sync.conflicts(doc.id).remoteHeads).toHaveLength(1);
  });

  it('leaves concurrent deletion behavior outside automatic settlement', () => {
    const { peers, doc, send } = setup();
    peers.a!.store.remove(doc.id, actor);
    peers.b!.store.remove(doc.id, actor);
    const heads = [peers.a!.sync.head('repo', doc.id)!, peers.b!.sync.head('repo', doc.id)!].sort();
    send(peers.a!, peers.b!); send(peers.b!, peers.a!);
    expect(peers.a!.sync.head('repo', doc.id)).toBe(heads[0]);
    expect(peers.b!.sync.head('repo', doc.id)).toBe(heads[0]);
    expect(peers.a!.sync.operations('repo').filter(operation => operation.origin === 'maintenance')).toHaveLength(0);
    expect(peers.b!.sync.operations('repo').filter(operation => operation.origin === 'maintenance')).toHaveLength(0);
  });

  it('replaces discarded duplicate delivery for an offline third member', () => {
    const { peers, doc, send } = setup(['a', 'b', 'c']);
    archive(peers.a!, doc.id); archive(peers.b!, doc.id);
    const loser = peers.b!.sync.head('repo', doc.id)!;
    const receipt = send(peers.a!, peers.b!);
    const winner = peers.b!.sync.head('repo', doc.id)!;
    expect(receipt.stage).toBe('merged');
    expect(winner).not.toBe(loser);
    const replacement = peers.b!.sync.readyIntents('repo', 100, true).find(intent =>
      intent.memberReplicaId === 'replica-c' && intent.frozenHead === winner);
    expect(replacement).toBeDefined();
    expect(send(peers.b!, peers.c!, winner).stage).not.toBe('conflict');
    expect(peers.c!.sync.head('repo', doc.id)).toBe(winner);
  });

  it('never writes merge from third replica that is not a head author', () => {
    const { peers, doc, send } = setup(['a', 'b', 'c']);
    peers.a!.store.writeFile(doc.id, { path: 'README.md', content: 'left\nbase' }, actor);
    peers.b!.store.writeFile(doc.id, { path: 'README.md', content: 'base\nright' }, actor);
    peers.a!.sync.freezeManual(); peers.b!.sync.freezeManual();
    send(peers.a!, peers.c!);
    expect(send(peers.b!, peers.c!).stage).toBe('received');
    expect(peers.c!.sync.operations('repo').filter(operation => operation.origin === 'maintenance')).toHaveLength(0);
    expect(peers.c!.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });
});
