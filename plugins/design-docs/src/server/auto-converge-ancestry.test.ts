import { describe, expect, it, vi } from 'vitest';
import { PeerProtocolError } from '../shared/peer-contract.js';
import { DesignDocPeerService } from './peer-service.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
type Peer = ReturnType<typeof fixture>;

function fixture(name: string, members = ['a', 'b']) {
  const db = createTestDatabase();
  let now = 1_000;
  let sequence = 0;
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: mutation => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db, {
    autoConverge: () => true,
    now: () => now,
    randomId: () => `${name}-${String(++sequence).padStart(4, '0')}`
  });
  sync.initialize('repo', `replica-${name}`);
  sync.setGroup('repo', 'group', members.map(member => ({
    replicaId: `replica-${member}`, machineId: `machine-${member}`, sponsorReplicaId: null, joinedAt: 1
  })));
  return { db, store, sync, service: new DesignDocPeerService(sync), advance: (ms: number) => { now += ms; } };
}

function setup() {
  const a = fixture('a'), b = fixture('b');
  const doc = a.store.create({
    title: 'Ancestry', template: 'blank', status: 'approved', files: [{ path: 'README.md', content: 'one\ntwo\nthree\nfour' }]
  }, actor);
  const send = (from: Peer, to: Peer, head = from.sync.head('repo', doc.id)!) => {
    const version = from.sync.version('repo', head)!;
    from.sync.createFrozenIntents('repo', doc.id, head, version.operation.payloadHash);
    const recipient = to.sync.localRepository()!.replicaId;
    let intent = from.sync.readyIntents('repo', 100, true).find(row => row.frozenHead === head && row.memberReplicaId === recipient);
    if (!intent) {
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
  send(a, b);
  return { a, b, doc, send };
}

function forkWithDisjointEdits() {
  const state = setup();
  state.a.store.writeFile(state.doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
  state.b.store.writeFile(state.doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
  return state;
}

describe('automatic convergence ancestry boundaries', () => {
  it.each(['resolved-head-arrives-first', 'edit-arrives-first'] as const)('settles duplicate ancestor when remote resolution and later edit arrive: %s', orientation => {
    const { a, b, doc, send } = setup();
    a.store.update(doc.id, { summary: 'temporary', expectedHead: a.sync.head('repo', doc.id)! }, actor);
    const duplicate = a.sync.head('repo', doc.id)!;
    a.store.update(doc.id, { summary: '', expectedHead: duplicate }, actor);
    const maintenance = a.sync.head('repo', doc.id)!;
    b.store.update(doc.id, { title: 'Edited before receipt', expectedHead: b.sync.head('repo', doc.id)! }, actor);
    const edit = b.sync.head('repo', doc.id)!;

    if (orientation === 'resolved-head-arrives-first') {
      expect(send(a, b, maintenance).stage).toBe('merged');
      expect(send(b, a, edit).stage).not.toBe('conflict');
    } else {
      expect(send(b, a, edit).stage).toBe('merged');
      expect(send(a, b, maintenance).stage).not.toBe('conflict');
    }

    expect(a.sync.head('repo', doc.id)).toBe(edit);
    expect(b.sync.head('repo', doc.id)).toBe(edit);
    expect(a.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it('falls back to conflict for criss-cross heads with two lowest common ancestors', () => {
    const { a, b, doc, send } = setup();
    a.store.update(doc.id, { title: 'left base', expectedHead: a.sync.head('repo', doc.id)! }, actor);
    const leftBase = a.sync.head('repo', doc.id)!;
    send(a, b, leftBase);
    b.store.update(doc.id, { summary: 'right base', expectedHead: b.sync.head('repo', doc.id)! }, actor);
    const rightBase = b.sync.head('repo', doc.id)!;
    send(b, a, rightBase);
    a.store.update(doc.id, { title: 'left head', expectedHead: a.sync.head('repo', doc.id)! }, actor);
    const left = a.sync.head('repo', doc.id)!;
    b.store.update(doc.id, { summary: 'right head', expectedHead: b.sync.head('repo', doc.id)! }, actor);
    const right = b.sync.head('repo', doc.id)!;

    // Existing immutable closures and hashes remain valid; only ancestry models criss-cross merges.
    for (const peer of [a, b]) {
      peer.db.prepare("UPDATE sync_operations SET parents_json = ? WHERE repo_id = 'repo' AND op_id IN (?, ?)")
        .run(JSON.stringify([leftBase, rightBase]), left, right);
    }
    a.sync.freezeManual();
    expect(send(a, b, left).stage).toBe('conflict');
    expect(b.sync.conflicts(doc.id).remoteHeads).toContain(left);
  });

  it('files conflict when bounded merge-base traversal raises a limit error', () => {
    const { a, b, doc, send } = forkWithDisjointEdits();
    a.sync.freezeManual();
    const spy = vi.spyOn(b.sync as never, 'mergeBases').mockImplementation(() => {
      throw new PeerProtocolError('limit', 'merge ancestry traversal limit reached');
    });
    try {
      expect(send(a, b).stage).toBe('conflict');
      expect(b.sync.conflicts(doc.id).remoteHeads).toContain(a.sync.head('repo', doc.id)!);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps waiting pair after sync-store restart and settles once merger head arrives', () => {
    const { a, b, doc, send } = forkWithDisjointEdits();
    b.sync.freezeManual();
    expect(send(a, b).stage).toBe('received');
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    const retryBefore = b.db.prepare("SELECT COUNT(*) AS n FROM sync_retry WHERE intent_id LIKE 'auto-wait:%'").get() as { n: number };
    expect(retryBefore.n).toBe(1);

    const restarted = new DesignDocSyncStore(b.db, { autoConverge: () => true, now: () => 1_000, randomId: () => 'restart-0001' });
    restarted.initialize('repo', 'replica-b');
    expect(restarted.sweepAutoSettlements()).toEqual({});
    const retryAfter = b.db.prepare("SELECT COUNT(*) AS n FROM sync_retry WHERE intent_id LIKE 'auto-wait:%'").get() as { n: number };
    expect(retryAfter.n).toBe(1);

    expect(send(b, a).stage).toBe('merged');
    const winner = a.sync.head('repo', doc.id)!;
    expect(send(a, b, winner).stage).not.toBe('conflict');
    expect(restarted.head('repo', doc.id)).toBe(winner);
  });

  it('does not auto-merge while local merger has retired', () => {
    const { a, b, doc, send } = forkWithDisjointEdits();
    a.db.prepare("UPDATE sync_group_members SET removed_at = 2 WHERE repo_id = 'repo' AND replica_id = 'replica-a'").run();
    expect(send(b, a).stage).toBe('conflict');
    expect(a.sync.operations('repo').filter(operation => operation.origin === 'maintenance')).toHaveLength(0);
    expect(a.sync.conflicts(doc.id).remoteHeads).toContain(b.sync.head('repo', doc.id)!);
  });

  it('conservatively conflicts for disjoint edit made before merge-head arrival without mutual eligibility', () => {
    const { a, b, doc, send } = setup();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nFOUR' }, actor);
    const mergeHead = a.sync.head('repo', doc.id)!;
    b.store.update(doc.id, { summary: 'local before arrival', expectedHead: b.sync.head('repo', doc.id)! }, actor);
    const localEdit = b.sync.head('repo', doc.id)!;

    expect(send(a, b, mergeHead).stage).toBe('conflict');
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nthree\nfour');
    expect(b.sync.head('repo', doc.id)).toBe(localEdit);
    expect(b.sync.conflicts(doc.id).remoteHeads).toContain(mergeHead);
  });
});
