import { describe, expect, it } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore, isOfflineSyncError } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { createRpcHandlers } from './rpc.js';
import { createCheckpointHash, createScopeHash } from './peer-protocol.js';
import { canonicalPeerHash } from '../shared/peer-contract.js';

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
  it('does not report synced from two equal maximal known heads while a third differs', () => {
    const a = fixture('a'), doc = shared(a, 'Three known heads');
    const current = a.sync.head('repo', doc.id)!;
    const version = a.sync.version('repo', current)!;
    const capture = a.sync as unknown as { saveVersion(repoId: string, version: typeof version): void };
    for (const [id, title] of [['same-1', doc.title], ['same-2', doc.title], ['different', 'Other title']] as const) {
      const closure = { ...version.closure, doc: { ...version.closure.doc, title } };
      capture.saveVersion('repo', { closure, operation: { ...version.operation, id, replicaId: 'replica-b',
        sequence: id === 'same-1' ? 1 : id === 'same-2' ? 2 : 3, parents: [], payloadHash: canonicalPeerHash(closure) } });
      a.db.prepare("INSERT INTO sync_peer_known VALUES ('repo', 'replica-b', ?)").run(id);
    }
    expect(state(a, doc.id)?.state).not.toBe('up-to-date');
  });
  it.each(['pending', 'blocked'] as const)('closes %s failed intent when inbound proves peer holds equal head', async (prior) => {
    const a = fixture('a'), b = fixture('b'), doc = shared(a, 'Equal proof');
    const intent = a.sync.readyIntents('repo')[0]!;
    await a.service.deliverPending(transport(a, b));
    a.db.prepare('DELETE FROM sync_peer_known').run();
    a.db.prepare('UPDATE sync_intents SET state = ? WHERE id = ?').run(prior, intent.id);
    a.db.prepare("INSERT INTO sync_retry VALUES (?, 10, 0, 0, 'peer request failed: 409')").run(intent.id);
    const offer = a.service.createOffer(intent);
    const body = { ...offer, senderReplicaId: 'replica-b', recipientReplicaId: 'replica-a', sessionId: 'equal-proof' };
    a.sync.apply({ ...body, scopeHash: createScopeHash(body) });
    expect(a.db.prepare('SELECT state FROM sync_intents WHERE id = ?').get(intent.id)).toEqual({ state: 'synced' });
    expect(a.db.prepare('SELECT * FROM sync_retry').all()).toEqual([]);
    expect(state(a, doc.id)?.state).toBe('up-to-date');
  });

  it('Sync Now requeues exhausted 409 intent but scheduled delivery does not', async () => {
    const a = fixture('a'), b = fixture('b'), doc = shared(a, 'Retry 409');
    const intent = a.sync.readyIntents('repo')[0]!;
    for (let attempt = 0; attempt < 10; attempt++) a.sync.deferIntent(intent, 'peer request failed: 409: durable projection does not match frozen payload');
    expect(await a.service.deliverPending(transport(a, b))).toMatchObject({ attempted: 0 });
    expect(await a.service.syncNow(transport(a, b))).toMatchObject({ synced: 1 });
    expect(b.store.summary(doc.id).status).toBe('approved');
    expect(a.db.prepare('SELECT state FROM sync_intents WHERE id = ?').get(intent.id)).toEqual({ state: 'synced' });
  });

  it('explicit retry reconciles already-known blocked intents even without retry row', () => {
    const a = fixture('a'); shared(a, 'Already known');
    const intent = a.sync.readyIntents('repo')[0]!;
    a.db.prepare("UPDATE sync_intents SET state = 'blocked'").run();
    a.db.prepare('INSERT INTO sync_peer_known VALUES (?, ?, ?)').run('repo', 'replica-b', intent.frozenHead);
    a.sync.retryBlockedIntents();
    expect(a.db.prepare('SELECT state FROM sync_intents').get()).toEqual({ state: 'synced' });
    expect(a.sync.readyIntents('repo')).toEqual([]);
  });

  it.each(['peer request failed: 409', 'peer request failed: 409: durable projection does not match frozen payload'])(
    'records and retries mixed-version rejection: %s', async (message) => {
      const a = fixture('a'), b = fixture('b'); shared(a, '409 diagnostics');
      const peers = transport(a, b), call = peers.call;
      peers.call = async (peer, method, body, options) => {
        if (method === 'apply') throw new Error(message);
        return call(peer, method, body, options);
      };
      expect(await a.service.deliverPending(peers)).toMatchObject({ failed: 1, synced: 0 });
      expect(a.db.prepare('SELECT error FROM sync_retry').get()).toEqual({ error: message });
      peers.call = call;
      expect(await a.service.syncNow(peers)).toMatchObject({ synced: 1 });
    });

  it('accepts legacy locale-ordered closures without changing immutable hashes or hiding content drift', () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Legacy order', status: 'approved', files: [
      { path: 'README.md', content: 'base' }, { path: 'nested/plan.md', content: 'nested' }] }, actor);
    const intent = a.sync.readyIntents('repo')[0]!, offer = structuredClone(a.service.createOffer(intent));
    const version = offer.versions.at(-1)!;
    version.closure.files.sort((a, b) => a.path.localeCompare(b.path));
    version.closure.threads = ['a-thread', 'Z-thread'].map(thread_id => ({ thread_id, title: 'Provenance', role: 'reviewer', last_activity_at: 1 }));
    version.operation.payloadHash = canonicalPeerHash(version.closure);
    const packet = { ...offer, scopeHash: createScopeHash(offer) };
    expect(b.sync.apply(packet).stage).toBe('synced');
    expect(b.sync.version('repo', intent.frozenHead)!.operation.payloadHash).toBe(version.operation.payloadHash);
    b.sync.freezeManual();
    expect(b.sync.head('repo', doc.id)).toBe(intent.frozenHead);
    b.db.prepare("UPDATE doc_files SET content = 'evil', size = 4 WHERE doc_id = ? AND path = 'README.md'").run(doc.id);
    const replay = { ...offer, sessionId: 'drift-replay' };
    expect(b.sync.apply({ ...replay, scopeHash: createScopeHash(replay) }).stage).toBe('merged');
    expect(b.sync.head('repo', doc.id)).not.toBe(intent.frozenHead);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('evil');
  });

  it.each([false, true])('converges status and content while receiver project mapping=%s remains local', async (mapped) => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Mixed mapping', projectId: 'foreign-project', status: 'approved', files: [
      { path: 'README.md', content: 'base' }, { path: 'research.md', content: 'notes' }] }, actor);
    await a.service.deliverPending(transport(a, b));
    if (mapped) {
      b.store.projectRefs.observe([{ id: 'local-project', name: 'Local' }]);
      await b.store.projectRefs.mapForeignProject(async () => [{ id: 'local-project', name: 'Local' }], 'foreign-project', 'local-project');
    }
    a.store.update(doc.id, { status: 'archived', expectedHead: a.sync.head('repo', doc.id) }, actor);
    expect(await a.service.deliverPending(transport(a, b))).toMatchObject({ synced: 1 });
    expect(b.store.summary(doc.id).status).toBe('archived');
    expect(b.store.list({ status: 'all' }).find(row => row.id === doc.id)?.projectId).toBe(mapped ? 'local-project' : null);
    expect(b.sync.head('repo', doc.id)).toBe(a.sync.head('repo', doc.id));
    expect(state(a, doc.id)?.state).toBe('up-to-date');
    expect(state(b, doc.id)?.state).toBe('up-to-date');
  });

  it('explicit retry keeps real conflicts, removed members, nonretryable failures and superseded deletions blocked', () => {
    const a = fixture('a'), doc = shared(a, 'Retry fences'), intent = a.sync.readyIntents('repo')[0]!;
    a.db.prepare("UPDATE sync_intents SET state = 'blocked'").run();
    a.db.prepare("INSERT INTO sync_retry VALUES (?, 10, 0, 0, 'immutable version payload hash mismatch')").run(intent.id);
    a.sync.retryBlockedIntents(); expect(a.sync.readyIntents('repo')).toEqual([]);
    a.db.prepare("UPDATE sync_retry SET error = 'peer request failed: 409'").run();
    a.db.prepare("INSERT INTO sync_receipts VALUES ('repo', 'replica-b', ?, ?, 'conflict', 1)").run(intent.frozenHead, intent.scopeHash);
    a.sync.retryBlockedIntents(); expect(a.sync.readyIntents('repo')).toEqual([]);
    a.db.prepare('DELETE FROM sync_receipts').run();
    a.db.prepare("UPDATE sync_group_members SET removed_at = 1 WHERE replica_id = 'replica-b'").run();
    a.sync.retryBlockedIntents(); expect(a.sync.readyIntents('repo')).toEqual([]);
    a.db.prepare("UPDATE sync_group_members SET removed_at = NULL WHERE replica_id = 'replica-b'").run();
    a.store.remove(doc.id, actor);
    a.sync.retryBlockedIntents();
    expect(a.sync.readyIntents('repo').some(row => row.id === intent.id)).toBe(false);
  });

  it('explicit retry revives an intent parked on an enrollment fault, but not for a removed member', () => {
    const a = fixture('a'); shared(a, 'Enrollment retry');
    const intent = a.sync.readyIntents('repo')[0]!;
    a.db.prepare("UPDATE sync_intents SET state = 'blocked'").run();
    a.db.prepare("INSERT INTO sync_retry VALUES (?, 10, 0, 0, 'peer enrollment changed or revoked')").run(intent.id);
    a.db.prepare("UPDATE sync_group_members SET removed_at = 1 WHERE replica_id = 'replica-b'").run();
    a.sync.retryBlockedIntents(); expect(a.sync.readyIntents('repo')).toEqual([]);
    a.db.prepare("UPDATE sync_group_members SET removed_at = NULL WHERE replica_id = 'replica-b'").run();
    a.sync.retryBlockedIntents();
    expect(a.sync.readyIntents('repo').map(row => row.id)).toEqual([intent.id]);
    expect(a.db.prepare('SELECT COUNT(*) AS n FROM sync_retry').get()).toEqual({ n: 0 });
  });

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
    expect(state(a, doc.id)).toEqual({ docId: doc.id, state: 'waiting', computers: 1, lastError: null, lastErrorAt: null });
    expect(a.sync.docSyncStatuses(draft.id)[0]).toMatchObject({ state: 'unsent', computers: 1 });
    // Offline: the pass counts it as waiting, never as a generic failure.
    const offline = await a.service.deliverPending(transport(a, b, false));
    expect(offline).toMatchObject({ synced: 0, blocked: 1, waiting: 1, needsChoice: 0, failed: 0 });
    expect(state(a, doc.id)?.state).toBe('waiting');
    a.advance(10 * 60_000);
    const online = await a.service.deliverPending(transport(a, b));
    expect(online).toMatchObject({ synced: 1, blocked: 0, waiting: 0, failed: 0 });
    expect(state(a, doc.id)).toEqual({ docId: doc.id, state: 'up-to-date', computers: 0, lastError: null, lastErrorAt: null });
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
    expect(state(a, doc.id)?.state).toBe('unknown');
    a.db.prepare("DELETE FROM sync_receipts").run();
    a.db.prepare("INSERT INTO sync_conflicts VALUES ('repo', ?, ?, 'other')").run(doc.id, head);
    expect(state(a, doc.id)?.state).toBe('unknown');
  });

  it('counts unverifiable conflict and other undelivered stages as waiting, not a content decision', async () => {
    for (const [stage, key] of [['conflict', 'waiting'], ['received', 'waiting']] as const) {
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

  it('a retrying delivery with a real error is failed in status, counts and error text, never a silent waiting', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Surface');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error('peer request failed: 409: conflict at https://x.example/apply?token=SECRET123 Authorization: Bearer abcdef123456'); };
    const result = await a.service.deliverPending(peers);
    expect(result).toMatchObject({ blocked: 1, failed: 1, waiting: 0 });
    // Still pending (retrying), not blocked: the old rule showed this as "waiting".
    expect(a.db.prepare('SELECT state FROM sync_intents WHERE doc_id = ?').get(doc.id)).toEqual({ state: 'pending' });
    const row = state(a, doc.id)!;
    expect(row.state).toBe('failed');
    expect(row.lastError).toContain('peer request failed: 409');
    expect(row.lastError).not.toMatch(/SECRET123|abcdef123456/);
    expect(row.lastErrorAt).toBeGreaterThan(0);
  });

  it('an offline retry shows its reason but stays waiting; the error is bounded', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Offline reason');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error(`peer grant unavailable ${'x'.repeat(1000)}`); };
    await a.service.deliverPending(peers);
    const row = state(a, doc.id)!;
    expect(row).toMatchObject({ state: 'waiting' });
    expect(row.lastError).toMatch(/^peer grant unavailable/);
    expect(row.lastError!.length).toBeLessThanOrEqual(300);
  });

  it('a stage token is not shown as an error, and an up-to-date doc carries none', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Stage token');
    const intent = a.db.prepare('SELECT id FROM sync_intents WHERE doc_id = ?').get(doc.id) as { id: string };
    a.db.prepare("INSERT INTO sync_retry VALUES (?, 1, 0, 5, 'conflict')").run(intent.id);
    expect(state(a, doc.id)).toMatchObject({ state: 'waiting', lastError: null, lastErrorAt: null });
    a.db.prepare("UPDATE sync_retry SET error = 'receiver rejected it' WHERE intent_id = ?").run(intent.id);
    expect(state(a, doc.id)).toMatchObject({ state: 'failed', lastError: 'receiver rejected it', lastErrorAt: 5 });
    await a.service.deliverPending(transport(a, b));
    expect(state(a, doc.id)).toMatchObject({ state: 'up-to-date', lastError: null, lastErrorAt: null });
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
    expect(await rpc.docSyncStatuses!({ doc: doc.id })).toEqual([{ docId: doc.id, state: 'waiting', computers: 1, lastError: null, lastErrorAt: null }]);
    expect(() => rpc.docSyncStatuses!({ doc: doc.id, extra: 1 })).toThrow(/accepts only/);
    const bare = createRpcHandlers({ store: a.store, changed: () => undefined } as never);
    expect(await bare.docSyncStatuses!(undefined)).toEqual([]);
  });
});
