import { describe, expect, it, vi } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocSyncStore } from './sync-store.js';
import { DesignDocPeerService } from './peer-service.js';
import { runCli, type CliDeps } from './cli.js';
import { createRpcHandlers } from './rpc.js';
import { deliveryReasonCode } from '../shared/sync-classify.js';

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
  return { db, store, sync, service: new DesignDocPeerService(sync), name, advance: (ms: number) => { now += ms; } };
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
const shared = (peer: Peer, title: string, content = `${title} body`) => peer.store.create({ title, status: 'approved', files: [{ path: 'README.md', content }] }, actor);

function cliDeps(peer: Peer, kind: 'user' | 'agent' = 'user'): CliDeps {
  const status = { members: [{ replicaId: 'replica-b', machineId: 'app-b', connected: true, authorized: true, grantEpoch: 1 }] };
  return { store: peer.store, changed: vi.fn(), caller: async () => ({ actor: { kind, label: 'x', threadId: null } as never, projectId: null, files: null }),
    readLocalFile: vi.fn(), pairing: { status: async () => status } as never, peers: {} as never, peerSync: peer.service };
}
const ctx = { pluginId: 'design-docs', argv: [] };

describe('queued delivery diagnostics', () => {
  it('lists the error, attempts, peer and direction for an unreachable peer, redacting secrets and bounding length', async () => {
    const a = fixture('a'), b = fixture('b'), doc = shared(a, 'Unreachable');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error(`peer request failed: 500: boom Authorization: Bearer abcdef123456 https://x.example/a?token=SECRET123 ${'z'.repeat(500)}`); };
    await a.service.deliverPending(peers);
    const [entry] = a.service.queuedDeliveries(doc.id);
    expect(entry).toMatchObject({ docId: doc.id, peerId: 'app-b', replicaId: 'replica-b', direction: 'outgoing', state: 'failed', attempts: 1, parked: false });
    expect(entry!.lastError).not.toMatch(/SECRET123|abcdef123456/);
    expect(entry!.lastError!.length).toBeLessThanOrEqual(300);
    expect(entry!.lastErrorAt).toBeGreaterThan(0);
    expect(a.service.queuedDeliveries('other-doc')).toEqual([]);
  });

  it('an offline peer reads waiting with its reason, a stage token carries no error, and the parked flag follows the row', async () => {
    const a = fixture('a'), b = fixture('b'), doc = shared(a, 'Offline');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error('peer grant unavailable'); };
    await a.service.deliverPending(peers);
    expect(a.service.queuedDeliveries(doc.id)[0]).toMatchObject({ state: 'waiting', lastError: 'peer grant unavailable' });
    a.db.prepare("UPDATE sync_retry SET error = 'conflict'").run();
    a.db.prepare("UPDATE sync_intents SET state = 'blocked'").run();
    expect(a.service.queuedDeliveries(doc.id)[0]).toMatchObject({ state: 'waiting', lastError: null, lastErrorAt: null, parked: true });
  });

  it('is empty without a group, and ignores delivered work and removed members', () => {
    const loneDb = createTestDatabase(); new DesignDocStore(loneDb);
    const lone = new DesignDocSyncStore(loneDb);
    lone.initialize('repo', 'replica-a');
    expect(lone.queuedDeliveries()).toEqual([]);
    expect(lone.peerDiagnostics()).toEqual([]);
    expect(lone.compareDocs()).toBeNull();
    const a = fixture('a'); shared(a, 'Queued');
    a.db.prepare("UPDATE sync_intents SET state = 'synced'").run();
    expect(a.service.queuedDeliveries()).toEqual([]);
    a.db.prepare("UPDATE sync_intents SET state = 'pending', member_replica_id = 'gone'").run();
    expect(a.service.queuedDeliveries()).toEqual([]);
  });

  it('per computer: queue depth, oldest queued time and at most 20 recent errors, newest first', async () => {
    const a = fixture('a');
    const docs = Array.from({ length: 22 }, (_, index) => shared(a, `Doc ${index}`));
    const intents = a.db.prepare('SELECT id FROM sync_intents ORDER BY created_at, id').all() as Array<{ id: string }>;
    intents.forEach((intent, index) => a.db.prepare("INSERT INTO sync_retry VALUES (?, 2, 0, ?, 'peer request failed: 409')").run(intent.id, 100 + index));
    const [peer] = a.service.peerDiagnostics();
    expect(peer).toMatchObject({ replicaId: 'replica-b', peerId: 'app-b', queueDepth: 22, queuedDocs: 22, failed: 22, waiting: 0 });
    expect(peer!.oldestQueuedAt).toBe(1000);
    expect(peer!.recentErrors).toHaveLength(20);
    expect(peer!.recentErrors[0]!.at).toBeGreaterThan(peer!.recentErrors[1]!.at);
    expect(docs).toHaveLength(22);
  });

  it('deferIntent returns the attempt count; the debug line carries ids and a reason code, never the error text', async () => {
    const a = fixture('a'), b = fixture('b'); shared(a, 'Log');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const peers = transport(a, b);
    peers.call = async () => { throw new Error('peer request failed: 500 token=SECRET123'); };
    await a.service.deliverPending(peers);
    a.advance(10 * 60_000);
    await a.service.deliverPending(peers);
    const lines = debug.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toMatch(/delivery deferred doc=\S+ peer=app-b direction=out reason=error attempts=1/);
    expect(lines[1]).toContain('attempts=2');
    expect(lines.join('\n')).not.toContain('SECRET123');
    // One summary line per distinct pass result, not one per retry.
    expect(info.mock.calls.filter((call) => String(call[0]).includes('sync pass'))).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('deliveryReasonCode never echoes the message', () => {
    expect(deliveryReasonCode(null)).toBe('none');
    expect(deliveryReasonCode('conflict')).toBe('stage-conflict');
    expect(deliveryReasonCode('peer grant unavailable')).toBe('offline');
    expect(deliveryReasonCode('secret detail')).toBe('error');
  });
});

describe('compare and counts', () => {
  it('equal content gives equal salted hashes even with different revisions; different content differs; paging works', async () => {
    const a = fixture('a'), b = fixture('b');
    const doc = shared(a, 'Same');
    await a.service.deliverPending(transport(a, b));
    const first = a.sync.compareDocs()!, second = b.sync.compareDocs()!;
    expect(first.docs.map((item) => item.hash)).toEqual(second.docs.map((item) => item.hash));
    expect(first.docs[0]).toMatchObject({ docId: doc.id, files: 1 });
    expect(first.docs[0]!.hash).toMatch(/^[0-9a-f]{16}$/);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'changed' }, actor);
    expect(a.sync.compareDocs()!.docs[0]!.hash).not.toBe(second.docs[0]!.hash);
    shared(a, 'Another');
    expect(a.sync.compareDocs(0, 1)).toMatchObject({ total: 2, offset: 0, limit: 1 });
    expect(a.sync.compareDocs(1, 5)!.docs).toHaveLength(1);
    // The same content in a different group hashes differently.
    const c = fixture('a'); c.sync.setGroup('repo', 'other-group', roster);
    shared(c, 'Same');
    expect(c.sync.compareDocs()!.docs[0]!.hash).not.toBe(first.docs[0]!.hash);
  });

  it('counts every status, project and the unmapped sub-count', () => {
    const a = fixture('a');
    shared(a, 'One');
    a.store.create({ title: 'Archived', status: 'archived', files: [{ path: 'README.md', content: 'x' }] }, actor);
    a.store.create({ title: 'Scoped', projectId: 'p1', files: [{ path: 'README.md', content: 'x' }] }, actor);
    const counts = a.store.counts();
    expect(counts.total).toBe(3);
    expect(counts.byStatus).toMatchObject({ approved: 1, archived: 1, draft: 1 });
    expect(counts.byProject).toEqual({ p1: 1 });
    expect(counts.unmapped).toBe(0);
  });
});

describe('CLI surfaces', () => {
  it('sync --json lists per-doc deliveries; sync status <doc> reads without syncing and is allowed for agents', async () => {
    const a = fixture('a'), b = fixture('b'), doc = shared(a, 'CLI');
    const peers = transport(a, b);
    peers.call = async () => { throw new Error('peer request failed: 409: nope'); };
    await a.service.deliverPending(peers);
    const syncNow = vi.spyOn(a.service, 'syncNow').mockResolvedValue({ attempted: 0, synced: 0, blocked: 0, waiting: 0, needsChoice: 0, failed: 0 });
    const full = JSON.parse((await runCli(cliDeps(a), ['sync'], ctx)).stdout!);
    expect(full.docs[0]).toMatchObject({ docId: doc.id, state: 'failed', attempts: 1, deliveries: [{ peerId: 'app-b', direction: 'outgoing', state: 'failed' }] });
    expect(full.docs[0].queuedAt).toBe(1000);
    syncNow.mockClear();
    for (const kind of ['user', 'agent'] as const) {
      const out = JSON.parse((await runCli(cliDeps(a, kind), ['sync', 'status', doc.id], ctx)).stdout!);
      expect(out.queue[0]).toMatchObject({ docId: doc.id, peerId: 'app-b', lastError: expect.stringContaining('409'), ageMs: expect.any(Number) });
      expect(out.docs[0]).toMatchObject({ state: 'failed' });
    }
    expect(JSON.parse((await runCli(cliDeps(a), ['sync', 'status'], ctx)).stdout!).queue).toHaveLength(1);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('peers --diagnose merges connection state with queue data; owner only', async () => {
    const a = fixture('a'); shared(a, 'Diag');
    const res = await runCli(cliDeps(a), ["peers", "--diagnose"], ctx); const out = JSON.parse(res.stdout ?? String(res.stderr));
    expect(out.diagnostics).toEqual([expect.objectContaining({ replicaId: 'replica-b', connected: true, authorized: true, queueDepth: 1, recentErrors: [] })]);
    expect(await runCli(cliDeps(a, 'agent'), ['peers', '--diagnose'], ctx)).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('reserved for the owner') });
    expect((await runCli(cliDeps(a, 'agent'), ['peers'], ctx)).exitCode).toBe(0);
    const noService = { ...cliDeps(a), peerSync: undefined };
    expect(JSON.parse((await runCli(noService, ['peers', '--diagnose'], ctx)).stdout!).diagnostics).toEqual([]);
  });

  it('compare: json and text, paging note, owner only, refused without a group', async () => {
    const a = fixture('a'); shared(a, 'One'); shared(a, 'Two');
    const json = JSON.parse((await runCli(cliDeps(a), ['compare', '--json', '--limit', '1'], ctx)).stdout!);
    expect(json).toMatchObject({ total: 2, limit: 1 });
    const text = await runCli(cliDeps(a), ['compare', '--limit', '1'], ctx);
    expect(text.stdout).toMatch(/^\S+ [0-9a-f]{16} files=1/);
    expect(text.stderr).toContain('showing 1 of 2');
    expect((await runCli(cliDeps(a), ['compare'], ctx)).stderr).toBeUndefined();
    expect(await runCli(cliDeps(a, 'agent'), ['compare'], ctx)).toMatchObject({ exitCode: 2 });
    expect(await runCli({ ...cliDeps(a), peerSync: undefined }, ['compare'], ctx)).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('unavailable') });
    const lone = fixture('a'); lone.db.prepare('DELETE FROM sync_group_members').run();
    lone.db.prepare("UPDATE sync_repositories SET group_id = NULL").run();
    expect(await runCli(cliDeps(lone), ['compare'], ctx)).toMatchObject({ exitCode: 2, stderr: expect.stringContaining('not set up') });
  });

  it('counts: text and json, agent allowed', async () => {
    const a = fixture('a'); shared(a, 'One');
    expect(JSON.parse((await runCli(cliDeps(a, 'agent'), ['counts', '--json'], ctx)).stdout!)).toMatchObject({ total: 1, unmapped: 0 });
    const text = (await runCli(cliDeps(a), ['counts'], ctx)).stdout!;
    expect(text).toContain('1 docs, 0 unmapped');
    expect(text).toContain('approved 1');
  });

  it('RPC exposes diagnostics and counts, and tolerates no peer service', async () => {
    const a = fixture('a'); shared(a, 'Rpc');
    const handlers = createRpcHandlers({ store: a.store, peerSync: a.service, sdk: {} } as never);
    expect(await handlers.syncDiagnostics!(undefined)).toMatchObject({ peers: [{ queueDepth: 1 }], queue: [{ direction: 'outgoing' }], counts: { total: 1 } });
    expect((await handlers.docCounts!(undefined) as { total: number }).total).toBe(1);
    const bare = createRpcHandlers({ store: a.store, sdk: {} } as never);
    expect(await bare.syncDiagnostics!(undefined)).toMatchObject({ peers: [], queue: [] });
  });
});
