import { describe, expect, it } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore, isOfflineSyncError } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { createRpcHandlers } from './rpc.js';
import { createCheckpointHash } from './peer-protocol.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const roster = ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `app-${name}`, joinedAt: 1, sponsorReplicaId: null }));
type Peer = ReturnType<typeof fixture>;

function fixture(name: string) {
  const db = createTestDatabase();
  let now = 1000;
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db, { now: () => now });
  sync.initialize('repo', `replica-${name}`); sync.setGroup('repo', 'group', roster);
  const service = new DesignDocPeerService(sync);
  return { db, store, sync, service, name, advance: (ms: number) => { now += ms; } };
}
const fence = () => ({ scope: 'repo', grantEpoch: 1, signal: new AbortController().signal, commitSync: async <T>(fn: () => T): Promise<T> => fn() });
function transport(from: Peer, to: Peer, online = true): PluginSdkPeers {
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
  const peers: PluginSdkPeers = {
    list: async () => [{ id: `app-${to.name}`, name: to.name, scope: 'repo', grantEpoch: 1, connected: online }],
    handle: () => {},
    call: async (_peer, method, body) => handlers.get(method)!({ peerId: `app-${from.name}`, body, ...fence() })
  };
  to.service.register({ sdk: { peers: { ...peers, handle: (method, handler) => handlers.set(method, handler) } }, onDispose: () => {} } as unknown as ZccPluginApi);
  return peers;
}
const shared = (peer: Peer, title: string) => peer.store.create({ title, status: 'approved', files: [{ path: 'README.md', content: `${title} body` }] }, actor);
const state = (peer: Peer, docId: string) => peer.sync.docSyncStatuses(docId)[0];

describe('per-doc sync status', () => {
  it('is empty without a sync group', () => {
    const db = createTestDatabase();
    new DesignDocStore(db);
    const sync = new DesignDocSyncStore(db);
    sync.initialize('repo', 'replica-a');
    expect(sync.docSyncStatuses()).toEqual([]);
  });

  it('classifies unsent, waiting, synced, and counts computers', async () => {
    const a = fixture('a'), b = fixture('b');
    const draft = a.store.create({ title: 'Draft', template: 'blank' }, actor);
    const doc = shared(a, 'Shared');
    expect(state(a, doc.id)).toEqual({ docId: doc.id, state: 'waiting', computers: 1 });
    expect(a.sync.docSyncStatuses(draft.id)[0]).toMatchObject({ state: 'unsent', computers: 1 });
    // Offline: the pass counts it as waiting, never as a generic failure.
    const offline = await a.service.deliverPending(transport(a, b, false));
    expect(offline).toMatchObject({ synced: 0, blocked: 1, waiting: 1, needsChoice: 0, failed: 0 });
    expect(state(a, doc.id)?.state).toBe('waiting');
    a.advance(10 * 60_000);
    const online = await a.service.deliverPending(transport(a, b));
    expect(online).toMatchObject({ synced: 1, blocked: 0, waiting: 0, failed: 0 });
    expect(state(a, doc.id)).toEqual({ docId: doc.id, state: 'up-to-date', computers: 0 });
    expect(b.sync.docSyncStatuses().map((row) => row.state)).toEqual(['up-to-date']);
  });

  it('a later edit with no queued delivery is unsent', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Edits');
    await a.service.deliverPending(transport(a, b));
    a.store.writeFile(doc.id, { path: 'README.md', content: 'changed', baseRevision: 1 }, actor);
    expect(state(a, doc.id)?.state).toBe('unsent');
  });

  it('classifies a conflict receipt, a conflict row, a real failure and an offline-blocked intent', () => {
    const a = fixture('a');
    const doc = shared(a, 'States');
    const head = a.sync.head('repo', doc.id)!;
    const intent = a.db.prepare('SELECT id FROM sync_intents WHERE doc_id = ?').get(doc.id) as { id: string };
    a.db.prepare("UPDATE sync_intents SET state = 'blocked' WHERE id = ?").run(intent.id);
    a.db.prepare("INSERT INTO sync_retry VALUES (?, 9, 0, 0, 'receiver rejected it')").run(intent.id);
    expect(state(a, doc.id)?.state).toBe('failed');
    a.db.prepare("UPDATE sync_retry SET error = 'peer grant unavailable' WHERE intent_id = ?").run(intent.id);
    expect(state(a, doc.id)?.state).toBe('waiting');
    a.db.prepare("INSERT INTO sync_receipts VALUES ('repo', 'replica-b', ?, 'x', 'conflict', 1)").run(head);
    expect(state(a, doc.id)?.state).toBe('needs-choice');
    a.db.prepare("DELETE FROM sync_receipts").run();
    a.db.prepare("INSERT INTO sync_conflicts VALUES ('repo', ?, ?, 'other')").run(doc.id, head);
    expect(state(a, doc.id)?.state).toBe('needs-choice');
  });

  it('counts a conflict stage as needs-choice and other undelivered stages as waiting', async () => {
    for (const [stage, key] of [['conflict', 'needsChoice'], ['received', 'waiting']] as const) {
      const a = fixture('a'), b = fixture('b');
      shared(a, 'Stage');
      const peers = transport(a, b);
      const call = peers.call;
      peers.call = async (peer, method, body, options) => {
        const reply = await call(peer, method, body, options) as Record<string, unknown> | null;
        if (!reply || (method !== 'apply' && method !== 'receipt-query')) return reply;
        const { checkpointHash: _old, ...rest } = reply as { checkpointHash: string } & Record<string, unknown>;
        const forged = { ...rest, stage, appliedHeads: {} };
        return { ...forged, checkpointHash: createCheckpointHash(forged as never) };
      };
      const result = await a.service.deliverPending(peers);
      expect(result[key]).toBe(1);
    }
  });

  it('a non-offline delivery error counts as failed', async () => {
    const a = fixture('a'), b = fixture('b');
    shared(a, 'Boom');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error('receiver rejected the transfer'); };
    expect(await a.service.deliverPending(peers)).toMatchObject({ blocked: 1, failed: 1, waiting: 0 });
  });

  it('classifies offline-looking errors', () => {
    for (const text of ['peer grant unavailable', 'manual peer unavailable', 'request timed out', 'ECONNRESET', 'authorization changed before receipt']) expect(isOfflineSyncError(text)).toBe(true);
    expect(isOfflineSyncError('receiver rejected the transfer')).toBe(false);
  });

  it('is exposed over RPC, validating arguments', async () => {
    const a = fixture('a');
    const doc = shared(a, 'Rpc');
    const rpc = createRpcHandlers({ store: a.store, changed: () => undefined, peerSync: a.service } as never);
    expect(await rpc.docSyncStatuses!(undefined)).toHaveLength(1);
    expect(await rpc.docSyncStatuses!({ doc: doc.id })).toEqual([{ docId: doc.id, state: 'waiting', computers: 1 }]);
    expect(() => rpc.docSyncStatuses!({ doc: doc.id, extra: 1 })).toThrow(/accepts only/);
    const bare = createRpcHandlers({ store: a.store, changed: () => undefined } as never);
    expect(await bare.docSyncStatuses!(undefined)).toEqual([]);
  });
});
