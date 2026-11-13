import { describe, expect, it, vi } from 'vitest';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { createTestDatabase } from './test-db.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
function pair(enabled = true) {
  let at = Date.now();
  const make = (replicaId: string) => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: mutation => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db, { autoConverge: () => enabled, now: () => at });
    sync.initialize('repo-a', replicaId);
    sync.setGroup('repo-a', 'group-a', ['replica-a', 'replica-b'].map(id =>
      ({ replicaId: id, machineId: `machine-${id}`, sponsorReplicaId: null, joinedAt: 1 })));
    return { db, store, sync, service: new DesignDocPeerService(sync) };
  };
  const a = make('replica-a'), b = make('replica-b');
  const doc = a.store.create({ title: 'Converge', template: 'blank', status: 'approved' }, actor);
  const send = (from: typeof a, to: typeof b, head = from.sync.head('repo-a', doc.id)!) => {
    const version = from.sync.version('repo-a', head)!;
    from.sync.createFrozenIntents('repo-a', doc.id, head, version.operation.payloadHash);
    const intent = from.sync.createFrozenIntents('repo-a', doc.id, head, version.operation.payloadHash)[0] ??
      from.sync.readyIntents('repo-a', 100, true).find(row => row.frozenHead === head)!;
    const offer = from.service.createOffer(intent);
    const receipt = to.sync.apply(offer);
    from.sync.acceptReceipt(intent, offer, receipt);
    return receipt;
  };
  send(a, b);
  return { a, b, doc, send, enable: (value: boolean) => { enabled = value; }, advance: (ms: number) => { at += ms; } };
}

describe('automatic content convergence', () => {
  it('stays disabled by default and files ordinary forks', () => {
    const { a, b, doc, send } = pair(false);
    a.store.update(doc.id, { status: 'archived', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { status: 'archived', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    expect(send(a, b).stage).toBe('conflict');
  });

  it('settles identical concurrent archives on smaller head without journal writes', () => {
    const { a, b, doc, send } = pair();
    a.store.update(doc.id, { status: 'archived', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { status: 'archived', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    const left = a.sync.head('repo-a', doc.id)!, right = b.sync.head('repo-a', doc.id)!;
    const before = b.service.createOffer(b.sync.readyIntents('repo-a').find(row => row.frozenHead === right)!);
    send(a, b); a.sync.apply(before);
    expect(a.sync.head('repo-a', doc.id)).toBe([left, right].sort()[0]);
    expect(b.sync.head('repo-a', doc.id)).toBe(a.sync.head('repo-a', doc.id));
    expect(a.sync.operations('repo-a')).toHaveLength(3);
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    expect(a.sync.docSyncStatuses(doc.id)[0]!.state).toBe('up-to-date');
  });

  it('does not claim discarded head as known after merged receipt', () => {
    const { a, b, doc, send } = pair();
    a.store.update(doc.id, { title: 'Changed', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    const changed = a.sync.head('repo-a', doc.id)!;
    b.store.update(doc.id, { summary: 'Temporary', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { summary: '', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    const unchanged = b.sync.head('repo-a', doc.id)!;
    expect(send(b, a).stage).toBe('merged');
    expect(a.sync.head('repo-a', doc.id)).toBe(changed);
    expect(b.db.prepare("SELECT 1 FROM sync_peer_known WHERE member_replica_id = 'replica-a' AND head_id = ?").get(unchanged)).toBeUndefined();
    expect(b.sync.readyIntents('repo-a').some(row => row.frozenHead === unchanged)).toBe(false);
  });

  it('merges disjoint text edits on one author and adopts merge without choice', () => {
    const { a, b, doc, send } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nfour' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
    a.sync.freezeManual();
    send(b, a);
    const merged = a.sync.version('repo-a', a.sync.head('repo-a', doc.id)!)!;
    expect(merged.operation.parents).toHaveLength(2);
    expect(merged.operation.origin).toBe('maintenance');
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nthree\nFOUR');
    send(a, b);
    expect(b.sync.head('repo-a', doc.id)).toBe(merged.operation.id);
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it('protects deliberate revert when opposite computer delivers newer edit', () => {
    const { a, b, doc, send } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'first' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'third' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'first' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'fourth' }, actor);
    expect(send(b, a).stage).toBe('conflict');
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('first');
  });

  it('settles unchanged sibling and later edit in either arrival direction', () => {
    const { a, b, doc, send } = pair();
    a.store.update(doc.id, { summary: 'temp', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    a.store.update(doc.id, { summary: '', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { title: 'New title', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    const left = a.sync.head('repo-a', doc.id)!, right = b.sync.head('repo-a', doc.id)!;
    send(a, b, left); send(b, a, right);
    expect(a.sync.head('repo-a', doc.id)).toBe(right);
    expect(b.sync.head('repo-a', doc.id)).toBe(right);
    expect(a.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it('does not automatically share unsent milestone edits during merge', () => {
    const { a, b, doc, send } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nfour' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE\ntwo\nthree\nfour' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
    expect(send(b, a).stage).toBe('conflict');
    expect(a.sync.readyIntents('repo-a')).toEqual([]);
  });

  it('waits for offline smaller author, pins ancestry, then falls back after both limits', () => {
    const { a, b, doc, send, advance } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nfour' }, actor);
    send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
    b.sync.freezeManual();
    const left = a.sync.head('repo-a', doc.id)!;
    expect(send(a, b).stage).toBe('received');
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    expect(b.sync.retentionPins('repo-a').has(left)).toBe(true);
    b.sync.sweepAutoSettlements(); b.sync.sweepAutoSettlements(); b.sync.sweepAutoSettlements();
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    advance(30 * 60_000);
    b.sync.sweepAutoSettlements();
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([left]);
  });

  it('turning setting off converts waiting pair into actionable conflict', () => {
    const { a, b, doc, send, enable } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nfour' }, actor); send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
    b.sync.freezeManual();
    expect(send(a, b).stage).toBe('received');
    enable(false); b.sync.sweepAutoSettlements();
    expect(b.sync.conflicts(doc.id).remoteHeads).toHaveLength(1);
  });

  it('sweeps identical existing conflict without another incoming packet', () => {
    const { a, b, doc, send, enable } = pair(false);
    a.store.update(doc.id, { status: 'archived', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { status: 'archived', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    send(a, b);
    enable(true);
    expect(b.sync.sweepAutoSettlements()).toEqual({ identical: 1 });
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it.each(['resolution-first', 'edit-first'])('settles real Keep theirs resolution overtaken by author edit: %s', order => {
    const { a, b, doc, send, enable } = pair(false);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'local fork' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'remote fork' }, actor);
    const remote = b.sync.head('repo-a', doc.id)!;
    send(b, a);
    const resolution = a.sync.resolveConflict({ docId: doc.id, expectedHead: a.sync.head('repo-a', doc.id)!, remoteHead: remote, choice: 'remote' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'remote newer' }, actor);
    const edit = b.sync.head('repo-a', doc.id)!;
    enable(true);
    if (order === 'resolution-first') { send(a, b, resolution); send(b, a, edit); }
    else { send(b, a, edit); send(a, b, resolution); }
    expect(a.sync.head('repo-a', doc.id)).toBe(edit);
    expect(b.sync.head('repo-a', doc.id)).toBe(edit);
    expect(a.sync.conflicts(doc.id).remoteHeads).toEqual([]);
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });

  it('logs one bounded summary for many settlements, never file names or heads', async () => {
    const { a, b, doc, send, enable } = pair(false);
    a.store.update(doc.id, { status: 'archived', expectedHead: a.sync.head('repo-a', doc.id)! }, actor);
    b.store.update(doc.id, { status: 'archived', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    send(a, b); enable(true);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await b.service.deliverPending({ list: async () => [] } as never);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]![0]).toBe('[design-docs] automatic settlement: identical 1');
      await b.service.deliverPending({ list: async () => [] } as never);
      expect(log).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });

  it('reconciles disjoint edit before merger head arrives when both heads were frozen', () => {
    const { a, b, doc, send } = pair();
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nfour' }, actor); send(a, b);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree\nfour' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nthree\nFOUR' }, actor);
    a.sync.freezeManual(); b.sync.freezeManual(); send(b, a);
    const merged = a.sync.head('repo-a', doc.id)!;
    b.store.update(doc.id, { summary: 'later', expectedHead: b.sync.head('repo-a', doc.id)! }, actor);
    b.sync.freezeManual();
    expect(send(a, b, merged).stage).toBe('received');
    send(b, a);
    send(a, b);
    expect(a.store.summary(doc.id).summary).toBe('later');
    expect(b.store.summary(doc.id).summary).toBe('later');
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nthree\nFOUR');
    expect(b.sync.conflicts(doc.id).remoteHeads).toEqual([]);
  });
});
