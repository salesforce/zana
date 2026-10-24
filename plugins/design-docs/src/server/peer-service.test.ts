import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginDatabase, PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DesignDocPeerService } from './peer-service.js';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocStore } from './store.js';
import { canonicalPeerHash, PeerProtocolError } from '../shared/peer-contract.js';
import { createScopeHash, createTransferHash, peerBlobHash, transferQuery } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_PACKET_BYTES, MAX_PEER_SESSION_BYTES } from '../shared/peer-limits.js';
import { createRoster, transferSeat, requestRetirement } from './peer-slots.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');
const user = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`,
  sponsorReplicaId: null, joinedAt: 1 }));
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); vi.useRealTimers(); });

// Independent file-backed DBs, real host-style migration index/hash bookkeeping.
function fixture(name: string) {
  const folder = mkdtempSync(join(tmpdir(), 'dd-payload-'));
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'docs.sqlite');
  let raw: InstanceType<typeof Database>;
  const changed = vi.fn();
  function open() {
    raw = new Database(path);
    raw.exec('CREATE TABLE IF NOT EXISTS migrations (idx INTEGER PRIMARY KEY, hash TEXT NOT NULL)');
    const db: PluginDatabase = {
      prepare: (sql) => raw.prepare(sql), runScript: (sql) => { raw.exec(sql); },
      transaction: (fn) => raw.transaction(fn)(),
      migrate: (statements) => {
        raw.transaction(() => statements.forEach((statement, index) => {
          const hash = canonicalPeerHash(statement);
          const prior = raw.prepare('SELECT hash FROM migrations WHERE idx = ?').get(index) as { hash: string } | undefined;
          if (prior) { expect(prior.hash).toBe(hash); return; }
          raw.exec(statement);
          raw.prepare('INSERT INTO migrations VALUES (?, ?)').run(index, hash);
        }))();
      }
    };
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db);
    sync.initialize('repo', `replica-${name}`);
    return { db, store, sync, service: new DesignDocPeerService(sync, changed) };
  }
  let state = open();
  cleanup.push(() => raw.close());
  return {
    get db() { return state.db; }, get store() { return state.store; }, get sync() { return state.sync; },
    get service() { return state.service; }, changed,
    pair() { state.sync.setGroup('repo', 'group', members); },
    restart() { raw.close(); state = open(); }
  };
}

const fence = (grantEpoch = 1) => ({ grantEpoch, scope: 'repo', signal: new AbortController().signal,
  commitSync: async <T>(fn: () => T): Promise<T> => fn() });

function transport(from: ReturnType<typeof fixture>, to: ReturnType<typeof fixture>, loseAck = false, epoch = 1): PluginSdkPeers {
  let lost = false;
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
  to.service.register({ sdk: { peers: { handle: (method: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>) => handlers.set(method, handler) } },
    onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
  return {
    list: async () => [{ id: `machine-${to.sync.localRepository()!.replicaId.slice(-1)}`, name: 'Peer app',
      scope: 'repo', grantEpoch: epoch, connected: true }], handle: () => {},
    call: vi.fn(async (_peerId, method, body, args) => {
      expect(_peerId).toBe(members.find((member) => member.replicaId === to.sync.localRepository()!.replicaId)!.machineId);
      expect(args?.scope).toBe('repo');
      const sender = `machine-${from.sync.localRepository()!.replicaId.slice(-1)}`;
      const handler = handlers.get(method);
      if (!handler) throw new Error(`unknown method ${method}`);
      const result = await handler({ peerId: sender, body, ...fence(epoch) });
      if ((method === 'apply' || method === 'offer') && loseAck && !lost) { lost = true; throw new Error('ACK lost after commit'); }
      return result;
    })
  } as PluginSdkPeers;
}

const managedRoot = () => createRoster('repo', 'group', members.map((member, index) => ({ ...member,
  sponsorReplicaId: index ? 'replica-a' : null })), 'genesis', 'replica-a');
function govern(peer: ReturnType<typeof fixture>, roster: ReturnType<typeof managedRoot>) {
  peer.db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(roster));
  peer.db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(roster.rosterEpoch);
}

describe('durable independent-store payload replication', () => {
  it.each(['self', 'sender', 'digest', 'identity', 'scope', 'grant', 'cancelled'] as const)(
    'suppresses post-commit data ACK after %s changes without rolling back committed state', async (reason) => {
      for (const method of ['offer', 'transfer', 'chunk', 'apply', 'missing', 'cancel', 'manual', 'manual-deliver'] as const) {
        const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
        const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left');
        govern(a, left); govern(b, left);
        const doc = a.store.create({ title: 'Post-commit ACK', status: 'approved', template: 'blank' }, user);
        const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
        if (['chunk', 'apply', 'missing', 'cancel'].includes(method)) await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
        if (method === 'apply') for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
          await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
        }
        if (method.startsWith('manual')) b.sync.prepareManual();
        const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
        b.service.register({ sdk: { peers: { list: async () => [], handle: (name: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>) => handlers.set(name, handler) } },
          onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
        const query = transferQuery(transfer), { sessionId: _session, scopeHash: _scope, ...routing } = query;
        const input = method === 'offer' ? a.service.createOffer(intent) : method === 'transfer' ? transfer : method === 'chunk' ?
          a.sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0) : method.startsWith('manual') ?
          { ...routing, manualId: 'post-commit-manual', heads: transfer.heads } : query;
        let committed!: () => void, release!: () => void;
        const didCommit = new Promise<void>((resolve) => { committed = resolve; });
        const gate = new Promise<void>((resolve) => { release = resolve; }), controller = new AbortController();
        const request: PluginPeerRequest = { peerId: 'machine-a', body: input, ...fence(), signal: controller.signal,
          commitSync: async (fn) => { const result = fn(); committed(); await gate; return result; } };
        const pending = handlers.get(method)!(request);
        await didCommit;
        const tables = ['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions', 'sync_checkpoints'];
        const retained = tables.map((table) => b.db.prepare(`SELECT * FROM ${table}`).all());
        if (reason === 'self' || reason === 'sender') govern(b, requestRetirement(left, 'replica-a', reason === 'self' ? 'replica-b' : 'replica-a'));
        if (reason === 'digest') govern(b, transferSeat(root, 'replica-b', 'replica-a', 'right'));
        if (reason === 'identity') b.db.prepare("UPDATE sync_group_members SET machine_id = 'replacement' WHERE replica_id = 'replica-a'").run();
        if (reason === 'scope') request.scope = 'other';
        if (reason === 'grant') request.grantEpoch++;
        if (reason === 'cancelled') controller.abort();
        const rejected = expect(pending).rejects.toThrow(reason === 'self' ? 'retiring' : reason === 'sender' || reason === 'identity' ? 'not a roster member' : reason === 'scope' ? 'fence' : reason === 'cancelled' ? 'cancelled' : 'authorization');
        release(); await rejected;
        expect(tables.map((table) => b.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(retained);
        if (method === 'offer' || method === 'apply') {
          expect(b.store.find(doc.id)).not.toBeNull();
          expect(b.sync.head('repo', doc.id)).toBe(intent.frozenHead);
          expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_checkpoints').get()).toEqual({ n: 1 });
          expect(b.changed).toHaveBeenCalledWith(doc.id);
        }
      }
    });

  it.each(['syncNow', 'retry'] as const)('refreshes exact grant and governance before completing %s manual ACK', async (mode) => {
    for (const reason of ['epoch', 'disconnected', 'missing', 'ambiguous', 'ambiguous-disconnected', 'wrong-scope', 'identity', 'digest', 'self', 'sender'] as const) {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left');
      govern(a, left); govern(b, left);
      const doc = a.store.create({ title: 'Manual grant refresh', files: [{ path: 'README.md', content: 'consented' }] }, user);
      b.sync.prepareManual(); if (mode === 'retry') a.sync.prepareManual();
      const peers = transport(a, b), call = peers.call, list = peers.list;
      let ack = false, refreshed = false;
      peers.call = vi.fn(async (peerId, method, body, args) => {
        if (method === 'manual' && ack) return { accepted: false, manualId: (body as { manualId: string }).manualId };
        const result = await call(peerId, method, body, args);
        if (method === 'manual') ack = true;
        return result;
      });
      peers.list = async (args) => {
        const grants = await list(args);
        if (!ack) return grants;
        refreshed = true;
        if (reason === 'epoch') grants[0]!.grantEpoch++;
        if (reason === 'disconnected') grants[0]!.connected = false;
        if (reason === 'missing') return [];
        if (reason === 'ambiguous') return [...grants, grants[0]!];
        if (reason === 'ambiguous-disconnected') return [...grants, { ...grants[0]!, connected: false }];
        if (reason === 'wrong-scope') grants[0]!.scope = 'other';
        if (reason === 'identity') a.db.prepare("UPDATE sync_group_members SET machine_id = 'replacement' WHERE replica_id = 'replica-b'").run();
        if (reason === 'digest') govern(a, transferSeat(root, 'replica-b', 'replica-a', 'right'));
        if (reason === 'self' || reason === 'sender') govern(a, requestRetirement(left, 'replica-b', reason === 'self' ? 'replica-a' : 'replica-b'));
        return grants;
      };
      if (mode === 'syncNow' && reason === 'self') await expect(a.service.syncNow(peers)).rejects.toThrow('retiring');
      else await (mode === 'syncNow' ? a.service.syncNow(peers) : a.service.deliverPending(peers));
      expect(refreshed).toBe(true);
      expect(a.db.prepare("SELECT state FROM sync_manual_sessions WHERE direction = 'out'").all()).toEqual([{ state: 'waiting' }]);
      expect(vi.mocked(peers.call).mock.calls.some((args) => args[1] === 'manual-deliver')).toBe(false);
      expect(a.sync.version('repo', a.sync.head('repo', doc.id)!)!.closure.files[0]!.content).toBe('consented');
    }
  });

  it('keeps retiring self writable and frozen state intact with no explicit or scheduled network traffic', async () => {
    vi.useFakeTimers();
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(); govern(a, root); govern(b, root);
    const doc = b.store.create({ title: 'Retiring local-first', status: 'approved', template: 'blank' }, user);
    const intent = b.sync.readyIntents('repo')[0]!, transfer = b.service.createTransfer(intent, 1);
    b.sync.prepareManual();
    const retained = ['sync_intents', 'sync_transfers', 'sync_manual_sessions', 'sync_retry'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all());
    const pending = requestRetirement(root, 'replica-a', 'replica-b'); govern(a, pending); govern(b, pending);
    const peers = transport(b, a); peers.list = vi.fn(peers.list);
    b.service.register({ sdk: { peers: { handle: () => {} } }, onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
    b.service.start(peers);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'local retiring edit' }, user);
    b.store.update(doc.id, { status: 'implemented', expectedHead: b.sync.head('repo', doc.id) }, user);
    b.service.mutationCommitted();
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(b.service.deliverPending(peers)).rejects.toThrow('retiring');
    await expect(b.service.syncNow(peers)).rejects.toThrow('retiring');
    expect(peers.call).not.toHaveBeenCalled(); expect(peers.list).not.toHaveBeenCalled();
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('local retiring edit');
    expect(b.sync.version('repo', intent.frozenHead)).not.toBeNull();
    expect(['sync_intents', 'sync_transfers', 'sync_manual_sessions', 'sync_retry'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(retained);
    expect(() => b.sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0)).toThrow('retiring');
    b.restart(); expect(b.service.status()).toEqual({ configured: false, members: [] });
  });

  it.each(['self', 'sender'] as const)('rejects exact-current-digest document routing for retiring %s at store and service boundaries', async (target) => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(); govern(a, root); govern(b, root);
    const doc = a.store.create({ title: 'No retiring recipient', status: 'approved', template: 'blank' }, user);
    const intent = a.sync.readyIntents('repo')[0]!, original = a.service.createTransfer(intent, 1), originalOffer = a.service.createOffer(intent);
    await b.service.receiveTransfer('transfer', 'machine-a', original, fence());
    const blob = original.blobs.find((blob) => blob.bytes > 0)!, oldChunk = a.sync.outgoingChunk(original, blob.hash, 0);
    await b.service.receiveTransfer('chunk', 'machine-a', oldChunk, fence());
    const pending = requestRetirement(root, 'replica-a', target === 'self' ? 'replica-b' : 'replica-a'); govern(a, pending); govern(b, pending);
    const routing = { rosterEpoch: pending.rosterEpoch, rosterDigest: pending.digest };
    const transferBody = { ...original, ...routing }, transfer = { ...transferBody, scopeHash: createTransferHash(transferBody) };
    const offerBody = { ...originalOffer, ...routing }, offer = { ...offerBody, scopeHash: createScopeHash(offerBody) };
    const query = transferQuery(transfer), chunk = { ...oldChunk, ...query };
    const before = ['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions', 'sync_checkpoints'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all());
    const reason = target === 'self' ? 'retiring' : 'not a roster member';
    expect(() => b.service.handshake('machine-a', query)).toThrow(reason);
    expect(() => b.service.receiptQuery('machine-a', query)).toThrow(reason);
    await expect(b.service.offer('machine-a', offer, fence())).rejects.toThrow(reason);
    for (const method of ['transfer', 'chunk', 'apply', 'missing', 'cancel'] as const) {
      await expect(b.service.receiveTransfer(method, 'machine-a', method === 'transfer' ? transfer : method === 'chunk' ? chunk : query, fence())).rejects.toThrow(reason);
    }
    for (const action of [() => b.sync.apply(offer), () => b.sync.stageTransfer(transfer),
      () => b.sync.stageChunk(chunk, Buffer.from(chunk.content, 'base64')), () => b.sync.applyTransfer(query),
      () => b.sync.missingChunks(query), () => b.sync.cancelStaging(query),
      () => b.sync.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash, query.rosterDigest),
      () => b.sync.acceptManual('replica-a', 'new', {})]) expect(action).toThrow('retiring');
    expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
    expect(['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions', 'sync_checkpoints'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  });

  it.each(['self', 'sender'] as const)('never acknowledges persisted checkpoint after %s retirement even with current digest', async (target) => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(); govern(a, root); govern(b, root);
    const doc = a.store.create({ title: 'Retiring checkpoint', status: 'approved', template: 'blank' }, user);
    const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    await b.service.offer('machine-a', offer, fence());
    const before = b.db.prepare('SELECT * FROM sync_checkpoints').all();
    const pending = requestRetirement(root, 'replica-a', target === 'self' ? 'replica-b' : 'replica-a'); govern(b, pending); b.restart();
    const query = { ...transferQuery(offer), rosterEpoch: pending.rosterEpoch, rosterDigest: pending.digest };
    expect(() => b.sync.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash, query.rosterDigest)).toThrow('retiring');
    expect(() => b.service.receiptQuery('machine-a', query)).toThrow(target === 'self' ? 'retiring' : 'not a roster member');
    expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual(before);
    expect(b.store.find(doc.id)).not.toBeNull();
  });

  it.each(['self', 'sender'] as const)('fences retiring %s during every delayed document/manual commit', async (target) => {
    for (const method of ['offer', 'transfer', 'chunk', 'apply', 'missing', 'cancel', 'manual', 'manual-deliver'] as const) {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const root = managedRoot(); govern(a, root); govern(b, root);
      const doc = a.store.create({ title: 'Retirement lease', status: 'approved', template: 'blank' }, user);
      const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
      if (['chunk', 'apply', 'missing', 'cancel'].includes(method)) await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
      if (method === 'apply') for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
        await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
      }
      if (method.startsWith('manual')) b.sync.prepareManual();
      const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
      b.service.register({ sdk: { peers: { handle: (name: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>) => handlers.set(name, handler) } },
        onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
      const query = transferQuery(transfer), { sessionId: _session, scopeHash: _scope, ...routing } = query;
      const input = method === 'offer' ? a.service.createOffer(intent) : method === 'transfer' ? transfer : method === 'chunk' ?
        a.sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0) : method.startsWith('manual') ?
        { ...routing, manualId: 'retirement-manual', heads: transfer.heads } : query;
      const before = ['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const pending = handlers.get(method)!({ peerId: 'machine-a', body: input, ...fence(), commitSync: async (fn) => { await gate; return fn(); } });
      govern(b, requestRetirement(root, 'replica-a', target === 'self' ? 'replica-b' : 'replica-a')); release();
      await expect(pending).rejects.toThrow(target === 'self' ? 'retiring' : 'not a roster member');
      expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
      expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
      expect(['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    }
  });

  it.each(['list', 'receipt-query', 'transfer', 'missing', 'chunk', 'apply'] as const)(
    'stops data calls and runner writes when local retirement occurs while awaiting %s', async (at) => {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const root = managedRoot(); govern(a, root); govern(b, root);
      const doc = a.store.create({ title: 'Retiring sender race', status: 'approved', files: [{ path: 'README.md', content: 'frozen' }] }, user);
      const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
      const peers = transport(a, b), call = peers.call, list = peers.list;
      let retired = false, laterCalls = 0;
      const retire = () => { govern(a, requestRetirement(root, 'replica-b', 'replica-a')); retired = true; };
      peers.list = async (args) => { const grants = await list(args); if (at === 'list' && !retired) retire(); return grants; };
      peers.call = async (peerId, method, body, args) => {
        if (retired) laterCalls++;
        const result = await call(peerId, method, body, args);
        if (method === at && !retired) retire();
        return result;
      };
      expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
      expect(retired).toBe(true); expect(laterCalls).toBe(0);
      expect(a.db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
      expect(a.db.prepare('SELECT * FROM sync_retry').all()).toEqual([]);
      expect(a.db.prepare('SELECT state FROM sync_intents').get()).toEqual({ state: 'pending' });
      expect(a.db.prepare("SELECT * FROM sync_transfers WHERE direction = 'out'").all()).toHaveLength(1);
      expect(a.sync.version('repo', intent.frozenHead)).not.toBeNull();
      const receiptBody = { sessionId: transfer.sessionId, scopeHash: transfer.scopeHash, stage: 'synced' as const, heads: transfer.heads, appliedHeads: transfer.heads };
      expect(() => a.sync.acceptTransferReceipt(intent, transfer, { ...receiptBody, checkpointHash: canonicalPeerHash(receiptBody) })).toThrow('retiring');
      if (at === 'apply') expect(b.store.find(doc.id)).not.toBeNull();
    });

  it.each(['syncNow', 'retry'] as const)('does not accept manual ACK or send again when self retires during %s', async (mode) => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(); govern(a, root); govern(b, root);
    a.store.create({ title: 'Retiring manual ACK', template: 'blank' }, user);
    b.sync.prepareManual(); if (mode === 'retry') a.sync.prepareManual();
    const peers = transport(a, b), call = peers.call;
    let retired = false, laterCalls = 0;
    peers.call = async (peerId, method, body, args) => {
      if (retired) laterCalls++;
      const result = await call(peerId, method, body, args);
      if (method === 'manual') { govern(a, requestRetirement(root, 'replica-b', 'replica-a')); retired = true; }
      return result;
    };
    if (mode === 'syncNow') await expect(a.service.syncNow(peers)).rejects.toThrow('retiring');
    else expect(await a.service.deliverPending(peers)).toEqual({ attempted: 0, synced: 0, blocked: 0 });
    expect(laterCalls).toBe(0); expect(retired).toBe(true);
    expect(a.db.prepare("SELECT state FROM sync_manual_sessions WHERE direction = 'out'").all()).toEqual([{ state: 'waiting' }]);
    expect(a.db.prepare('SELECT * FROM sync_retry').all()).toEqual([]);
  });

  it('blocks frozen intents to pending retiring recipient before any transport call and retains transport bytes', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(); govern(a, root); govern(b, root);
    a.store.create({ title: 'Blocked retiring recipient', status: 'approved', template: 'blank' }, user);
    const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
    const pending = requestRetirement(root, 'replica-a', 'replica-b'); govern(a, pending); govern(b, pending);
    expect(pending.members.map((member) => member.replicaId)).toContain('replica-b');
    expect(a.service.status().members.map((member) => member.replicaId)).not.toContain('replica-b');
    const peers = transport(a, b); peers.list = vi.fn(peers.list);
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(peers.list).not.toHaveBeenCalled(); expect(peers.call).not.toHaveBeenCalled();
    expect(a.db.prepare('SELECT state FROM sync_intents').get()).toEqual({ state: 'blocked' });
    expect(a.db.prepare('SELECT * FROM sync_retry').all()).toEqual([]);
    expect(a.db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
    expect(a.db.prepare("SELECT header_json FROM sync_transfers WHERE direction = 'out'").get()).toEqual({ header_json: expect.stringContaining(transfer.sessionId) });
    expect(a.sync.version('repo', intent.frozenHead)).not.toBeNull();
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 0, synced: 0, blocked: 0 });
  });

  it('blocks equal-epoch divergent histories and omitted digests before sending frozen bytes', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    govern(a, left); govern(b, right);
    const doc = a.store.create({ title: 'Divergent roster', status: 'approved', template: 'blank' }, user);
    const peers = transport(a, b);
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(vi.mocked(peers.call).mock.calls.map((call) => call[1])).toEqual(['handshake']);
    expect(b.store.find(doc.id)).toBeNull();
    const offer = a.service.createOffer(a.sync.readyIntents('repo', 100, true)[0]!);
    expect(offer.rosterEpoch).toBe(b.sync.localRepository()!.rosterEpoch);
    const { rosterDigest: _digest, ...missing } = offer;
    expect(() => b.service.handshake('machine-a', missing)).toThrow('authorization');
    await expect(b.service.offer('machine-a', missing, fence())).rejects.toThrow('authorization');
  });

  it.each(['offer', 'transfer', 'chunk', 'apply', 'missing', 'cancel', 'manual', 'manual-deliver'] as const)(
    'rechecks managed digest inside delayed %s commit without epoch change', async (method) => {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
      govern(a, left); govern(b, left);
      const doc = a.store.create({ title: 'Digest lease', status: 'approved', template: 'blank' }, user);
      const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
      if (['chunk', 'apply', 'missing', 'cancel'].includes(method)) await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
      if (method === 'apply') for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
        await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
      }
      const handlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
      b.service.register({ sdk: { peers: { handle: (name: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>) => handlers.set(name, handler) } },
        onDispose: (dispose: () => void) => cleanup.push(dispose) } as unknown as ZccPluginApi);
      const query = transferQuery(transfer), { sessionId: _session, scopeHash: _scope, ...routing } = query;
      if (method.startsWith('manual')) b.sync.prepareManual();
      const input = method === 'offer' ? a.service.createOffer(intent) : method === 'transfer' ? transfer : method === 'chunk' ?
        a.sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0) : method.startsWith('manual') ?
        { ...routing, manualId: 'remote-manual', heads: transfer.heads } : query;
      const before = ['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all());
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const pending = handlers.get(method)!({ peerId: 'machine-a', body: input, ...fence(),
        commitSync: async (fn) => { await gate; return fn(); } });
      govern(b, right); release();
      await expect(pending).rejects.toThrow('authorization');
      expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
      expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
      expect(['sync_transfers', 'sync_transfer_chunks', 'sync_manual_sessions'].map((table) => b.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    });

  it('rejects stale persisted checkpoint queries even when caller substitutes current digest', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    govern(a, left); govern(b, left);
    const doc = a.store.create({ title: 'Checkpoint digest', status: 'approved', template: 'blank' }, user);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1), query = transferQuery(transfer);
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    const receipt = b.service.receiptQuery('machine-a', query);
    expect(receipt).not.toHaveProperty('rosterDigest');
    b.restart(); expect(b.service.receiptQuery('machine-a', query)).toEqual(receipt);
    govern(b, right); b.restart();
    expect(() => b.service.receiptQuery('machine-a', query)).toThrow('authorization');
    const substituted = { ...query, rosterDigest: right.digest };
    expect(() => b.service.receiptQuery('machine-a', substituted)).toThrow('checkpoint roster digest');
    await expect(b.service.receiveTransfer('apply', 'machine-a', substituted, fence())).rejects.toThrow('checkpoint roster digest');
    expect(b.store.find(doc.id)).not.toBeNull();
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_checkpoints').get()).toEqual({ n: 1 });
  });

  it('does not reauthorize digest-less persisted checkpoints when managed roster appears at same epoch', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    a.store.create({ title: 'Legacy checkpoint', status: 'approved', template: 'blank' }, user);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1), query = transferQuery(transfer);
    expect(query).not.toHaveProperty('rosterDigest');
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    const root = managedRoot(); govern(b, root); b.restart();
    expect(root.rosterEpoch).toBe(transfer.rosterEpoch);
    expect(() => b.service.receiptQuery('machine-a', query)).toThrow('authorization');
    expect(() => b.service.receiptQuery('machine-a', { ...query, rosterDigest: root.digest })).toThrow('checkpoint roster digest');
    expect(() => b.sync.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash)).toThrow('authorization');
  });

  it('does not acknowledge applied transfer after same-epoch digest changes during grant refresh', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    govern(a, left); govern(b, left);
    const doc = a.store.create({ title: 'Digest ACK race', status: 'approved', template: 'blank' }, user);
    const peers = transport(a, b), list = peers.list;
    let calls = 0;
    peers.list = async (args) => { const grants = await list(args); if (++calls > 1) govern(a, right); return grants; };
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(b.store.find(doc.id)).not.toBeNull();
    expect(a.db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
    expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
  });

  it.each(['syncNow', 'retry'] as const)('keeps outgoing manual consent waiting when digest changes during %s ACK', async (mode) => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const root = managedRoot(), left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    govern(a, left); govern(b, left);
    a.store.create({ title: 'Private manual', template: 'blank' }, user);
    b.sync.prepareManual(); if (mode === 'retry') a.sync.prepareManual();
    const peers = transport(a, b), call = peers.call;
    peers.call = async (peerId, method, body, args) => {
      const result = await call(peerId, method, body, args);
      if (method === 'manual') govern(a, right);
      return result;
    };
    const result = await (mode === 'syncNow' ? a.service.syncNow(peers) : a.service.deliverPending(peers));
    expect(result.synced).toBe(0);
    expect(a.db.prepare("SELECT state FROM sync_manual_sessions WHERE direction = 'out'").all()).toEqual([{ state: 'waiting' }]);
    expect(vi.mocked(call).mock.calls.some((args) => args[1] === 'manual-deliver')).toBe(false);
  });
  it('awaits async lease before committing or invalidating; revoke during wait preserves domain', async () => {
    for (const revoke of [false, true]) {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const doc = a.store.create({ title: 'Lease', status: 'approved', template: 'blank' }, user);
      const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const controller = new AbortController();
      const pending = b.service.offer('machine-a', offer, { ...fence(), signal: controller.signal,
        commitSync: async (fn) => { await gate; return fn(); } });
      expect(b.store.find(doc.id)).toBeNull();
      expect(b.changed).not.toHaveBeenCalled();
      expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
      if (revoke) controller.abort();
      release();
      if (revoke) {
        await expect(pending).rejects.toThrow('cancelled');
        expect(b.store.find(doc.id)).toBeNull();
        expect(b.changed).not.toHaveBeenCalled();
      } else {
        await expect(pending).resolves.toMatchObject({ stage: 'synced' });
        expect(b.changed).toHaveBeenCalledWith(doc.id);
      }
    }
  });

  it('replicates full 24MiB doc with 2MiB binary/text files within packet/session caps', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const files = Array.from({ length: 12 }, (_, index) => index === 11 ? {
      path: 'asset.png', content: Buffer.alloc(2 * 1024 * 1024, 255).toString('base64'), encoding: 'base64' as const
    } : { path: index === 0 ? 'README.md' : `file-${index}.md`, content: String.fromCharCode(65 + index).repeat(2 * 1024 * 1024) });
    const doc = a.store.create({ title: 'Maximum', status: 'approved', files }, user);
    const peers = transport(a, b), call = peers.call;
    let maximum = 0, chunks = 0;
    peers.call = async (peerId, method, body, args) => {
      const bytes = Buffer.byteLength(JSON.stringify(body)); maximum = Math.max(maximum, bytes);
      expect(bytes).toBeLessThanOrEqual(MAX_PEER_PACKET_BYTES);
      if (method === 'chunk') chunks++;
      return call(peerId, method, body, args);
    };
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1);
    expect(transfer.blobs.reduce((sum, blob) => sum + blob.bytes, 0)).toBeLessThanOrEqual(MAX_PEER_SESSION_BYTES);
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(chunks).toBeGreaterThan(96);
    expect(maximum).toBeLessThan(MAX_PEER_PACKET_BYTES);
    for (const file of files) expect(b.store.readFile(doc.id, file.path).content).toBe(file.content);
    expect(b.db.prepare("SELECT * FROM sync_transfer_chunks WHERE direction = 'in'").all()).toEqual([]);
  }, 60_000);

  it('stages partially across restart, rejects incomplete/hash-invalid chunks and applies once', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Resume chunks', status: 'approved', files: [{ path: 'README.md', content: 'z'.repeat(2 * 1024 * 1024) }] }, user);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1), query = transferQuery(transfer);
    await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
    const descriptor = transfer.blobs.find((blob) => blob.bytes === 2 * 1024 * 1024)!;
    const chunk = a.sync.outgoingChunk(transfer, descriptor.hash, 0);
    await expect(b.service.receiveTransfer('chunk', 'machine-a', chunk, { ...fence(), scope: 'wrong' })).rejects.toThrow('matching');
    await b.service.receiveTransfer('chunk', 'machine-a', chunk, fence());
    expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
    b.restart(); a.restart();
    await expect(b.service.receiveTransfer('apply', 'machine-a', query, fence())).rejects.toThrow('incomplete');
    await expect(b.service.receiveTransfer('chunk', 'machine-a', { ...chunk, chunkHash: 'f'.repeat(64) }, fence())).rejects.toThrow('hash');
    await expect(b.service.receiveTransfer('chunk', 'machine-a', { ...chunk, blobHash: 'f'.repeat(64) }, fence())).rejects.toThrow('scope');
    await b.service.receiveTransfer('chunk', 'machine-a', chunk, fence());
    for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
      await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
    }
    expect(b.store.find(doc.id)).toBeNull();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = b.service.receiveTransfer('apply', 'machine-a', query, { ...fence(), commitSync: async (fn) => { await gate; return fn(); } });
    expect(b.changed).not.toHaveBeenCalled(); expect(b.store.find(doc.id)).toBeNull();
    release(); await expect(pending).resolves.toMatchObject({ stage: 'synced' });
    const history = b.store.history(doc.id);
    b.restart();
    await expect(b.service.receiveTransfer('apply', 'machine-a', query, fence())).resolves.toMatchObject({ stage: 'synced' });
    expect(b.store.history(doc.id)).toEqual(history);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('z'.repeat(2 * 1024 * 1024));
  });

  it('uses public grant epoch and fails closed when public grant info is unavailable', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    a.store.create({ title: 'Epoch 9', status: 'approved', template: 'blank' }, user);
    expect(await a.service.deliverPending(transport(a, b, false, 9))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    const c = fixture('a'), d = fixture('b'); c.pair(); d.pair();
    c.store.create({ title: 'No grant', status: 'approved', template: 'blank' }, user);
    const peers = transport(c, d); peers.list = async () => [];
    expect(await c.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(peers.call).not.toHaveBeenCalled();
  });

  it.each(['wrong-scope', 'daemon-id', 'disconnected', 'invalid-epoch', 'ambiguous'] as const)(
    'refuses %s grants before sending document bytes', async (reason) => {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      a.store.create({ title: 'Grant routing', status: 'approved', template: 'blank' }, user);
      const peers = transport(a, b);
      const grant = { id: members[1]!.machineId, name: 'Remote app', scope: 'repo', grantEpoch: 1, connected: true };
      if (reason === 'wrong-scope') grant.scope = 'group';
      if (reason === 'daemon-id') grant.id = 'enrolled-host-b';
      if (reason === 'disconnected') grant.connected = false;
      if (reason === 'invalid-epoch') grant.grantEpoch = 0;
      peers.list = async () => reason === 'ambiguous' ? [grant, grant] : [grant];
      expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
      expect(peers.call).not.toHaveBeenCalled();
      expect(b.sync.operations('repo')).toEqual([]);
      expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
    });

  it.each(['epoch', 'disconnected', 'missing', 'ambiguous', 'roster'] as const)(
    'does not acknowledge durable receiver apply after %s changes during grant refresh', async (reason) => {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const doc = a.store.create({ title: 'Receipt fencing', status: 'approved', template: 'blank' }, user);
      const peers = transport(a, b), list = peers.list;
      let calls = 0;
      peers.list = async (args) => {
        const grants = await list(args);
        if (++calls === 1) return grants;
        if (reason === 'epoch') grants[0]!.grantEpoch++;
        if (reason === 'disconnected') grants[0]!.connected = false;
        if (reason === 'missing') return [];
        if (reason === 'ambiguous') return [...grants, grants[0]!];
        if (reason === 'roster') a.pair();
        return grants;
      };
      expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
      expect(b.store.find(doc.id)).not.toBeNull();
      expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
      expect(a.db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
    });

  it('uses roster app instance IDs, not enrolled machine IDs or display names', async () => {
    const a = fixture('a'), b = fixture('b');
    const roster = members.map((member, index) => ({ ...member, machineId: `app-instance-${index}` }));
    a.sync.setGroup('repo', 'group', roster); b.sync.setGroup('repo', 'group', roster);
    const doc = a.store.create({ title: 'App identity', status: 'approved', template: 'blank' }, user);
    const peers: PluginSdkPeers = {
      list: async () => [
        { id: 'enrolled-host-b', name: 'app-instance-1', scope: 'repo', grantEpoch: 4, connected: true },
        { id: 'app-instance-1', name: 'Other repository', scope: 'other-repo', grantEpoch: 3, connected: true },
        { id: 'app-instance-1', name: 'Remote machine', scope: 'repo', grantEpoch: 9, connected: true }
      ],
      handle: () => {},
      call: async (peerId, method, body, args) => {
        expect(peerId).toBe('app-instance-1'); expect(args?.scope).toBe('repo');
        expect(body).toMatchObject({ grantEpoch: 9 });
        if (method === 'handshake') return b.service.handshake('app-instance-0', body, 9);
        if (method === 'receipt-query') return b.service.receiptQuery('app-instance-0', body, 9);
        return b.service.receiveTransfer(method as 'transfer' | 'chunk' | 'apply', 'app-instance-0', body, fence(9));
      }
    };
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.find(doc.id)).not.toBeNull();
  });

  it.each(['apply', 'offer', 'chunk', 'transfer'] as const)(
    'rechecks sender app identity inside delayed %s lease commit', async (method) => {
      const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
      const doc = a.store.create({ title: 'Identity fence', status: 'approved', template: 'blank' }, user);
      const intent = a.sync.readyIntents('repo')[0]!, transfer = a.service.createTransfer(intent, 1);
      if (method === 'apply' || method === 'chunk') await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
      if (method === 'apply') {
        for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
          await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
        }
      }
      const input = method === 'offer' ? a.service.createOffer(intent) : method === 'transfer' ? transfer :
        method === 'apply' ? transferQuery(transfer) : a.sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0);
      const stages = b.db.prepare("SELECT * FROM sync_transfers WHERE direction = 'in'").all();
      const chunks = b.db.prepare("SELECT * FROM sync_transfer_chunks WHERE direction = 'in'").all();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const lease = { ...fence(), commitSync: async <T>(fn: () => T): Promise<T> => { await gate; return fn(); } };
      const pending = method === 'offer' ? b.service.offer('machine-a', input, lease) : b.service.receiveTransfer(method, 'machine-a', input, lease);
      // Model persisted identity remapping independently of roster-epoch protection.
      b.db.prepare('UPDATE sync_group_members SET machine_id = ? WHERE replica_id = ?').run('app-instance-replacement', 'replica-a');
      release();
      await expect(pending).rejects.toThrow('not a roster member');
      expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
      expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
      expect(b.db.prepare("SELECT * FROM sync_transfers WHERE direction = 'in'").all()).toEqual(stages);
      expect(b.db.prepare("SELECT * FROM sync_transfer_chunks WHERE direction = 'in'").all()).toEqual(chunks);
    });

  it.each(['commit', 'revoke', 'reject'] as const)('registered offer awaits lease %s before reply or invalidation', async (result) => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const methods = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
    b.service.register({ sdk: { peers: { handle: (method: string, handler: (request: PluginPeerRequest) => unknown | Promise<unknown>) => methods.set(method, handler) } },
      onDispose: () => {} } as unknown as ZccPluginApi);
    const doc = a.store.create({ title: 'Registered async', status: 'approved', template: 'blank' }, user);
    const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const controller = new AbortController();
    const commit = vi.fn();
    const pending = methods.get('offer')!({ peerId: 'machine-a', body: offer, ...fence(), signal: controller.signal,
      commitSync: async (fn) => {
        await gate;
        if (result === 'reject') throw new Error('lease rejected');
        commit();
        return fn();
      }
    });
    expect(pending).toBeInstanceOf(Promise);
    expect(commit).not.toHaveBeenCalled(); expect(b.changed).not.toHaveBeenCalled();
    expect(b.store.find(doc.id)).toBeNull();
    expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
    if (result === 'revoke') controller.abort();
    release();
    if (result === 'commit') {
      await expect(pending).resolves.toMatchObject({ stage: 'synced', appliedHeads: offer.heads });
      expect(commit).toHaveBeenCalledOnce(); expect(b.changed).toHaveBeenCalledOnce();
      expect(b.changed).toHaveBeenCalledWith(doc.id); expect(b.store.find(doc.id)).not.toBeNull();
    } else {
      await expect(pending).rejects.toThrow(result === 'revoke' ? 'cancelled' : 'lease rejected');
      expect(b.changed).not.toHaveBeenCalled(); expect(b.store.find(doc.id)).toBeNull();
      expect(b.db.prepare('SELECT * FROM sync_checkpoints').all()).toEqual([]);
    }
  });

  it('rejects staged corruption, extra blobs, authorization changes and concurrent session exhaustion', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Stage safety', status: 'approved', template: 'blank' }, user);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1);
    await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
    await b.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
    const altered = { ...transfer, blobs: [...transfer.blobs, { hash: 'e'.repeat(64), bytes: 0 }] };
    altered.scopeHash = createTransferHash(altered);
    await expect(b.service.receiveTransfer('transfer', 'machine-a', altered, fence())).rejects.toThrow('transfer mismatch');
    await expect(b.service.receiveTransfer('transfer', 'machine-a', { ...transfer, blobs: [{ hash: 'a'.repeat(64), bytes: MAX_PEER_SESSION_BYTES + 1 }] }, fence())).rejects.toThrow();
    for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
      await b.service.receiveTransfer('chunk', 'machine-a', a.sync.outgoingChunk(transfer, blob.hash, index), fence());
    }
    b.db.prepare("UPDATE sync_transfer_chunks SET content = ? WHERE direction = 'in' AND blob_hash = ?").run(Buffer.alloc(transfer.blobs[0]!.bytes, 7), transfer.blobs[0]!.hash);
    await expect(b.service.receiveTransfer('apply', 'machine-a', transferQuery(transfer), fence())).rejects.toThrow('hash mismatch');
    expect(b.store.find(doc.id)).toBeNull(); expect(b.changed).not.toHaveBeenCalled();
    expect(b.sync.operations('repo')).toEqual([]);
    const c = fixture('b'); c.pair();
    const extra = { ...transfer, blobs: [...transfer.blobs, { hash: peerBlobHash(Buffer.from('extra')), bytes: 5 }] };
    extra.scopeHash = createTransferHash(extra);
    await c.service.receiveTransfer('transfer', 'machine-a', extra, fence());
    for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
      const chunk = a.sync.outgoingChunk(transfer, blob.hash, index);
      await c.service.receiveTransfer('chunk', 'machine-a', { ...chunk, scopeHash: extra.scopeHash }, fence());
    }
    const bytes = Buffer.from('extra');
    await c.service.receiveTransfer('chunk', 'machine-a', { ...transferQuery(extra), blobHash: peerBlobHash(bytes), index: 0,
      chunkHash: peerBlobHash(bytes), content: bytes.toString('base64') }, fence());
    await expect(c.service.receiveTransfer('apply', 'machine-a', transferQuery(extra), fence())).rejects.toThrow('outside frozen closure');
    expect(c.store.find(doc.id)).toBeNull(); expect(c.sync.operations('repo')).toEqual([]);
    for (let index = 1; index < 8; index++) {
      const header = { ...transfer, sessionId: `session-${index}` }; header.scopeHash = createTransferHash(header);
      await b.service.receiveTransfer('transfer', 'machine-a', header, fence());
    }
    const overflow = { ...transfer, sessionId: 'overflow' }; overflow.scopeHash = createTransferHash(overflow);
    await expect(b.service.receiveTransfer('transfer', 'machine-a', overflow, fence())).rejects.toThrow('session capacity');
    b.pair();
    await expect(b.service.receiveTransfer('apply', 'machine-a', transferQuery(transfer), fence())).rejects.toThrow('identity');
  });
  it('owns one startup/tick worker and disposes pending delivery without draft sweep', async () => {
    vi.useFakeTimers();
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const draft = a.store.create({ title: 'Private', template: 'blank' }, user);
    const peers = transport(a, b);
    let dispose!: () => void;
    a.service.register({ sdk: { peers: { handle: () => {} } }, onDispose: (fn: () => void) => { dispose = fn; } } as unknown as ZccPluginApi);
    a.service.start(peers); a.service.start(peers);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(peers.call).not.toHaveBeenCalled();
    expect(b.store.find(draft.id)).toBeNull();
    a.store.update(draft.id, { status: 'approved', expectedHead: a.sync.head('repo', draft.id) }, user);
    a.service.mutationCommitted();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.store.find(draft.id)).not.toBeNull();
    dispose();
    const calls = vi.mocked(peers.call).mock.calls.length;
    a.service.mutationCommitted(); a.service.start(peers);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(peers.call).mock.calls).toHaveLength(calls);
  });
  it('registers fenced receivers once and rejects old hosts, aborts and epoch mismatch', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const methods = new Map<string, (request: unknown) => unknown>();
    let dispose!: () => void;
    b.service.register({ sdk: { peers: { handle: (method: string, fn: (request: unknown) => unknown) => methods.set(method, fn) } },
      onDispose: (fn: () => void) => { dispose = fn; } } as unknown as ZccPluginApi);
    expect([...methods.keys()]).toEqual(['manual', 'manual-deliver', 'handshake', 'offer', 'receipt-query', 'transfer', 'chunk', 'apply', 'missing', 'cancel', 'ancestry']);
    const doc = a.store.create({ title: 'Fence', status: 'approved', template: 'blank' }, user);
    const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    expect(() => methods.get('offer')!({ peerId: 'machine-a', body: offer })).toThrow('commit fence');
    await expect(methods.get('offer')!({ peerId: 'machine-a', body: offer, ...fence(), signal: AbortSignal.abort() })).rejects.toThrow('cancelled');
    expect(methods.get('handshake')!({ peerId: 'machine-a', body: offer, ...fence() })).toMatchObject({ senderReplicaId: 'replica-b' });
    const result = await methods.get('offer')!({ peerId: 'machine-a', body: offer, ...fence() });
    expect(result).toMatchObject({ stage: 'synced' });
    const { versions: _versions, heads: _heads, ...query } = offer;
    expect(methods.get('receipt-query')!({ peerId: 'machine-a', body: query, ...fence() })).toEqual(result);
    expect(() => b.service.receiptQuery('machine-a', { ...offer, sessionId: '../bad' })).toThrow('receipt query');
    expect(b.store.find(doc.id)).not.toBeNull();
    dispose();
  });

  it('coalesces concurrent delivery and never accepts receipt after roster changes', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    a.store.create({ title: 'Race', status: 'approved', template: 'blank' }, user);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const peers = transport(a, b), call = peers.call;
    peers.call = async (peerId, method, body, args) => {
      if (method === 'handshake') await gate;
      const result = await call(peerId, method, body, args);
      if (method === 'apply') a.pair();
      return result;
    };
    const first = a.service.deliverPending(peers);
    expect(a.service.deliverPending(peers)).toBe(first);
    release();
    expect(await first).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
  });
  it('requires explicit pairing and never bootstraps old milestone documents automatically', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = a.store.create({ title: 'Old approval', status: 'approved', template: 'blank' }, user);
    expect(a.sync.readyIntents('repo')).toEqual([]);
    expect(a.service.status()).toEqual({ configured: false, members: [] });
    expect(() => a.service.handshake('machine-b', {})).toThrow('not configured');
    a.pair(); b.pair();
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 0, synced: 0, blocked: 0 });
    expect(b.store.find(doc.id)).toBeNull();
    expect(await a.service.syncNow(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 1 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe(a.store.readFile(doc.id, 'README.md').content);
    expect(b.sync.readyIntents('repo')).toEqual([]);
  });

  it('transfers text, binary, metadata, replies, retained history and inert references', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Payload', summary: 'Real content', tags: ['sync'], projectId: 'private-project',
      files: [{ path: 'README.md', content: 'old body' }, { path: 'asset.png', content: 'AAEC/w==', encoding: 'base64' }] }, user);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'actual body'.repeat(1000) }, user);
    const comment = a.store.addComment(doc.id, { body: 'review', path: 'README.md', quote: 'actual' }, user);
    a.store.addReply(doc.id, comment.id, 'reply', user);
    a.store.setCommentStatus(doc.id, comment.id, 'resolved', user, 'agreed');
    a.store.linkThread(doc.id, 'foreign-thread', 'Private agent', 'author');
    a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo', doc.id) }, user);
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('actual body'.repeat(1000));
    expect(b.store.readFile(doc.id, 'asset.png').content).toBe('AAEC/w==');
    expect(b.store.get(doc.id)).toMatchObject({ title: 'Payload', summary: 'Real content', tags: ['sync'], status: 'approved',
      projectId: null, threads: [], comments: [{ body: 'review', status: 'resolved', replies: [{ body: 'reply' }, { body: 'agreed' }] }] });
    expect(b.store.history(doc.id).map((row) => b.store.revisionContent(doc.id, row.id).content)).toContain('old body');
    const head = b.sync.head('repo', doc.id)!;
    expect(b.sync.version('repo', head)!.closure.threads[0]!.thread_id).toBe('foreign-thread');
    expect(b.sync.version('repo', head)!.closure.doc.project_id).toBe('private-project');
    expect(b.changed).toHaveBeenCalledWith(doc.id);
    expect(b.sync.operations('repo').every((op) => op.replicaId === 'replica-a')).toBe(true);
    expect(b.sync.readyIntents('repo')).toHaveLength(0);
  });

  it('survives both restarts and lost ACK without duplicate projections or premature receipt', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Durable', status: 'implemented', files: [{ path: 'README.md', content: 'durable bytes' }] }, user);
    const transfer = a.service.createTransfer(a.sync.readyIntents('repo')[0]!, 1);
    a.restart(); b.restart();
    expect(await a.service.deliverPending(transport(a, b, true))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    const history = b.store.history(doc.id), revision = b.store.summary(doc.id).revision;
    b.restart();
    const receipt = await b.service.receiveTransfer('apply', 'machine-a', transferQuery(transfer), fence()) as { stage: string };
    expect(receipt.stage).toBe('synced');
    expect(b.store.history(doc.id)).toEqual(history);
    expect(b.store.summary(doc.id).revision).toBe(revision);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('durable bytes');
    expect(a.sync.readyIntents('repo')).toEqual([]);
    await expect(b.service.receiveTransfer('apply', 'machine-a', { ...transferQuery(transfer), scopeHash: 'f'.repeat(64) }, fence())).rejects.toThrow();
  });

  it('never leaks newer draft heads or unrelated drafts during milestone retry', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Frozen', files: [{ path: 'README.md', content: 'approved bytes' }] }, user);
    a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo', doc.id) }, user);
    const frozen = a.sync.readyIntents('repo')[0]!.frozenHead;
    a.store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE NEW DRAFT' }, user);
    a.store.update(doc.id, { status: 'draft', expectedHead: a.sync.head('repo', doc.id) }, user);
    const unrelated = a.store.create({ title: 'Unrelated', template: 'blank' }, user);
    a.restart();
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('approved bytes');
    expect(b.sync.head('repo', doc.id)).toBe(frozen);
    expect(b.store.summary(doc.id).status).toBe('approved');
    expect(b.store.find(unrelated.id)).toBeNull();
    expect(JSON.stringify(b.sync.operations('repo'))).not.toContain(a.sync.head('repo', doc.id));
    expect(await a.service.syncNow(transport(a, b))).toEqual({ attempted: 2, synced: 2, blocked: 1 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('PRIVATE NEW DRAFT');
    expect(b.store.find(unrelated.id)).not.toBeNull();
  });

  it('preserves concurrent local and remote forks, including unsent local work', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Forks', status: 'approved', files: [{ path: 'README.md', content: 'base' }] }, user);
    await a.service.deliverPending(transport(a, b));
    b.store.writeFile(doc.id, { path: 'README.md', content: 'local fork' }, user);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'remote fork' }, user);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo', doc.id) }, user);
    const incoming = a.sync.readyIntents('repo')[0]!.frozenHead;
    const local = b.sync.head('repo', doc.id);
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('local fork');
    expect(b.sync.head('repo', doc.id)).toBe(local);
    expect(b.sync.version('repo', incoming)!.closure.files[0]!.content).toBe('remote fork');
    expect(b.db.prepare('SELECT * FROM sync_conflicts').all()).toHaveLength(1);
    expect(a.sync.readyIntents('repo', 100, true)).toHaveLength(1);
    b.restart();
    expect(b.sync.version('repo', incoming)).not.toBeNull();
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 0, synced: 0, blocked: 0 });
  });

  it('manual sharing converges a resolved multi-parent fork without leaking private parents before consent', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Resolved', status: 'approved', files: [{ path: 'README.md', content: 'one\ntwo\nthree' }] }, user);
    await a.service.deliverPending(transport(a, b));
    a.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nTHREE' }, user);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo', doc.id) }, user);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, user);
    const remoteHead = a.sync.head('repo', doc.id)!, localHead = b.sync.head('repo', doc.id)!;
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    const resolved = b.service.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead, choice: 'merge' }, user);
    expect(b.changed).toHaveBeenLastCalledWith(doc.id);
    expect(b.store.summary(doc.id).status).toBe('implemented');
    expect(b.sync.readyIntents('repo')).toEqual([]);
    expect(a.sync.version('repo', localHead)).toBeNull();
    a.sync.prepareManual(); b.sync.prepareManual();
    expect(await b.service.deliverPending(transport(b, a))).toMatchObject({ synced: 1, blocked: 0 });
    expect(a.sync.head('repo', doc.id)).toBe(resolved);
    expect(a.store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nTHREE');
    expect(a.sync.version('repo', resolved)!.operation.parents).toEqual([localHead, remoteHead].sort());
    expect(a.db.prepare('SELECT * FROM sync_conflicts').all()).toEqual([]);
    b.restart(); expect(b.sync.head('repo', doc.id)).toBe(resolved);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nTHREE');
  });

  it('chunks packet-sized payload and rejects metadata-only receipts, wrong identity and revocation', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Large', status: 'approved', files: [{ path: 'README.md', content: 'x'.repeat(300_000) }] }, user);
    expect(await a.service.deliverPending(transport(a, b))).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('x'.repeat(300_000));
    expect(a.sync.readyIntents('repo')).toHaveLength(0);
    const c = fixture('a'), d = fixture('b'); c.pair(); d.pair();
    const small = c.store.create({ title: 'Small', status: 'approved', template: 'blank' }, user);
    const peers = transport(c, d);
    const real = peers.call;
    peers.call = async (peerId, method, body, args) => method === 'apply' ? { received: 1 } : real(peerId, method, body, args);
    expect(await c.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 0, blocked: 1 });
    expect(c.sync.readyIntents('repo', 100, true)).toHaveLength(1);
    const offer = c.service.createOffer(c.sync.readyIntents('repo', 100, true)[0]!);
    await expect(d.service.offer('machine-x', offer, fence())).rejects.toThrow('not a roster member');
    await expect(d.service.offer('machine-a', offer, fence(2))).rejects.toThrow('identity');
    await expect(d.service.offer('machine-a', offer, { ...fence(), commitSync: async () => { throw new Error('revoked'); } })).rejects.toThrow('revoked');
    expect(d.store.find(small.id)).toBeNull();
    const tampered = structuredClone(offer); tampered.versions[0]!.closure.files[0]!.content = 'tampered';
    tampered.versions[0]!.closure.files[0]!.size = Buffer.byteLength('tampered');
    tampered.scopeHash = createScopeHash(tampered);
    await expect(d.service.offer('machine-a', tampered, fence())).rejects.toThrow('hash');
  });

  it('rolls back projection, journal and checkpoint together on SQLite failure', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Atomic', status: 'approved', template: 'blank' }, user);
    const offer = a.service.createOffer(a.sync.readyIntents('repo')[0]!);
    b.db.runScript("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON sync_checkpoints BEGIN SELECT RAISE(ABORT, 'checkpoint fault'); END;");
    await expect(b.service.offer('machine-a', offer, fence())).rejects.toThrow('checkpoint fault');
    expect(b.store.find(doc.id)).toBeNull();
    expect(b.sync.operations('repo')).toEqual([]);
    expect(b.db.prepare('SELECT * FROM sync_versions').all()).toEqual([]);
    expect(b.db.prepare('SELECT * FROM sync_doc_heads').all()).toEqual([]);
    expect(b.changed).not.toHaveBeenCalled();
  });
});

describe('peer protocol negotiation', () => {
  const authored = (peer: ReturnType<typeof fixture>) => {
    const doc = peer.store.create({ title: 'Negotiated', status: 'approved', files: [{ path: 'README.md', content: 'first' }] }, user);
    return {
      doc, next() {
        peer.store.writeFile(doc.id, { path: 'README.md', content: 'second' }, user);
        peer.store.update(doc.id, { status: 'implemented', expectedHead: peer.sync.head('repo', doc.id) }, user);
      }
    };
  };
  const record = (peers: PluginSdkPeers, rewrite?: (method: string, result: unknown) => unknown) => {
    const sent: Array<{ method: string; body: Record<string, unknown> }> = [], call = peers.call;
    peers.call = async (peerId, method, body, args) => {
      sent.push({ method, body: body as Record<string, unknown> });
      const result = await call(peerId, method, body, args);
      return rewrite ? rewrite(method, result) : result;
    };
    return sent;
  };

  it('opens at protocol 2, upgrades to 3 with delta-aware peers and omits ancestry they hold', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const { doc, next } = authored(a);
    const peers = transport(a, b), sent = record(peers);
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    const handshake = sent.find((item) => item.method === 'handshake')!.body;
    expect(handshake).toMatchObject({ protocolVersion: 2, maxProtocolVersion: 3 });
    expect(sent.find((item) => item.method === 'transfer')!.body).toMatchObject({ protocolVersion: 3 });
    expect(a.sync.peerProtocol('replica-b')).toBe(3);
    expect(a.sync.compactionBlocker()).toBeNull();
    next(); sent.length = 0;
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    expect((sent.find((item) => item.method === 'transfer')!.body.versions as unknown[])).toHaveLength(2);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('second');
    // A receiver also accepts session offers whose omitted parents it holds.
    const head = a.sync.head('repo', doc.id)!;
    const intent = { id: 'replay', repoId: 'repo', docId: doc.id, memberReplicaId: 'replica-b', frozenHead: head,
      scopeHash: a.sync.version('repo', head)!.operation.payloadHash };
    const offer = a.service.createOffer(intent);
    expect(offer.versions).toHaveLength(1);
    expect((await b.service.offer('machine-a', offer, fence())).appliedHeads).toEqual({ [doc.id]: intent.frozenHead });
  });

  it('keeps protocol-2 peers working: full closures at version 2 and a closed compaction gate', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const { doc, next } = authored(a);
    const peers = transport(a, b);
    const sent = record(peers, (method, result) => method === 'handshake' ? { ...(result as object), protocolVersion: 2 } : result);
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    next(); sent.length = 0;
    expect(await a.service.deliverPending(peers)).toEqual({ attempted: 1, synced: 1, blocked: 0 });
    // A protocol-2 receiver would reject any data packet above 2 or any omitted parent.
    for (const item of sent.filter((entry) => entry.method !== 'handshake')) expect(item.body.protocolVersion).toBe(2);
    expect((sent.find((item) => item.method === 'transfer')!.body.versions as unknown[])).toHaveLength(3);
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('second');
    expect(a.sync.peerProtocol('replica-b')).toBe(2);
    expect(a.sync.compactionBlocker()).toBe('member replica-b has not negotiated delta protocol');
  });

  it('answers each handshake with the highest version both sides speak', () => {
    const b = fixture('b'); b.pair();
    const hello = { protocolVersion: 2, repoId: 'repo', senderReplicaId: 'replica-a', recipientReplicaId: 'replica-b',
      grantEpoch: 1, groupId: 'group', rosterEpoch: 1 };
    expect(b.service.handshake('machine-a', hello).protocolVersion).toBe(2);
    expect(b.service.handshake('machine-a', { ...hello, maxProtocolVersion: 3 }).protocolVersion).toBe(3);
    expect(b.service.handshake('machine-a', { ...hello, protocolVersion: 3 }).protocolVersion).toBe(3);
    expect(() => b.service.handshake('machine-a', { ...hello, protocolVersion: 4 })).toThrow('unsupported peer protocol version');
  });
  it('rejects unconfigured and non-roster requests with a typed PeerProtocolError', () => {
    const unpaired = fixture('b');
    expect(() => unpaired.service.handshake('machine-a', {})).toThrow(PeerProtocolError);
    const paired = fixture('b'); paired.pair();
    const caught = (() => { try { paired.service.handshake('machine-x', { senderReplicaId: 'replica-zzz' }); } catch (error) { return error; } })();
    expect(caught).toBeInstanceOf(PeerProtocolError);
    expect(caught).toMatchObject({ code: 'invalid' });
  });

  // Regression: a whole-document deletion must propagate through syncNow even when an earlier manual session for
  // that doc was accepted on the receiver. The deletion is an archived milestone, so the private-draft manual gate
  // must not fence it; stageTransfer once lacked the milestone exemption that `apply` already had, so the tombstone
  // stuck as "bilateral manual consent missing for frozen head" and the doc resurrected on the originating peer.
  it('propagates a delete via syncNow after an accepted manual session for the same doc', async () => {
    const a = fixture('a'), b = fixture('b'); a.pair(); b.pair();
    const doc = a.store.create({ title: 'Doc from A', status: 'approved', files: [{ path: 'note.md', content: 'written on A' }] }, user);
    // Initial share A -> B (milestone over the pairing path, exactly like the explicit-pairing milestone test above).
    expect(await a.service.syncNow(transport(a, b))).toMatchObject({ synced: 1 });

    // B edits note.md and pushes it back to A through a bilateral manual session (A has an outbound session, so A's
    // inbound session for this doc flips to 'accepted'). This is the leftover accepted inbound session the delete must survive.
    b.store.writeFile(doc.id, { path: 'note.md', content: 'edited on B' }, user);
    b.store.update(doc.id, { status: 'implemented', expectedHead: b.sync.head('repo', doc.id) }, user);
    a.sync.prepareManual();
    await b.service.syncNow(transport(b, a));
    expect(a.store.readFile(doc.id, 'note.md').content).toBe('edited on B');

    // B deletes the whole doc (archived 'delete' tombstone) and syncs: it must reach A and settle there, not resurrect.
    b.store.remove(doc.id, user);
    for (let pass = 0; pass < 4 && a.store.find(doc.id); pass++) {
      a.sync.prepareManual();
      await b.service.syncNow(transport(b, a));
      await a.service.syncNow(transport(a, b));
    }
    expect(a.store.find(doc.id)).toBeNull();
    expect(a.sync.version('repo', a.sync.head('repo', doc.id)!)!.operation.kind).toBe('delete');
  });
});
