import { describe, expect, it, vi } from 'vitest';
import type { PluginPeerRequest, PluginSdkPeers, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { canonicalPeerHash, type PeerOperation } from '../shared/peer-contract.js';
import { createScopeHash, createTransferHash, transferQuery, validateAncestryPage, validateSessionOffer, validateTransfer,
  type PeerAncestryPage, type PeerSessionOffer, type PeerTransfer } from './peer-protocol.js';
import { MAX_PEER_CHUNK_BYTES, MAX_PEER_PAGE_OPERATIONS, MAX_PEER_SESSION_OPERATIONS, PEER_COMPACTION_BATCH } from '../shared/peer-limits.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
const members = ['a', 'b', 'c'].map((name, index) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`,
  sponsorReplicaId: index ? 'replica-a' : null, joinedAt: index + 1 }));
const fence = () => ({ grantEpoch: 1, scope: 'repo-a', signal: new AbortController().signal,
  commitSync: async <T>(fn: () => T): Promise<T> => fn() });
const routing = (sender = 'replica-a', recipient = 'replica-b', protocolVersion = 3) => ({ protocolVersion, repoId: 'repo-a',
  senderReplicaId: sender, recipientReplicaId: recipient, grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1 });
const expectation = (local = 'replica-b', remote = 'replica-a') => ({ repoId: 'repo-a', localReplicaId: local, remoteReplicaId: remote,
  grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1 });

function peer(name: 'a' | 'b' | 'c') {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo-a', `replica-${name}`);
  sync.setGroup('repo-a', 'group-a', members);
  const handlers = new Map<string, (request: PluginPeerRequest) => unknown>();
  const service = new DesignDocPeerService(sync);
  service.register({ sdk: { peers: { handle: (method: string, fn: (request: PluginPeerRequest) => unknown) => handlers.set(method, fn) } },
    onDispose: () => {} } as unknown as ZccPluginApi);
  return { db, store, sync, service, handlers, name };
}
type Peer = ReturnType<typeof peer>;

/** Routes calls from `from` to the registered handlers of each connected target, as the host would. */
function transport(from: Peer, ...targets: Peer[]): PluginSdkPeers {
  return {
    list: async () => targets.map((target) => ({ id: `machine-${target.name}`, name: target.name, scope: 'repo-a', grantEpoch: 1, connected: true })),
    handle: () => {},
    call: vi.fn(async (peerId: string, method: string, body: unknown) => {
      const target = targets.find((candidate) => `machine-${candidate.name}` === peerId)!;
      return target.handlers.get(method)!({ peerId: `machine-${from.name}`, body, ...fence() } as unknown as PluginPeerRequest);
    })
  } as unknown as PluginSdkPeers;
}

const all = (p: Peer) => { for (const member of ['replica-a', 'replica-b', 'replica-c']) if (member !== `replica-${p.name}`) p.sync.recordPeerProtocol(member, 3); };
const compacted = (p: Peer) => (p.db.prepare('SELECT head_id FROM sync_versions WHERE compacted = 1 ORDER BY head_id').all() as Array<{ head_id: string }>).map((row) => row.head_id);
const opIds = (p: Peer) => new Set((p.db.prepare('SELECT op_id FROM sync_operations').all() as Array<{ op_id: string }>).map((row) => row.op_id));

/** Draft chain (no intents), compacted on `a`, then approved so a frozen intent needs the compacted ancestry. */
function compactedDoc(a: Peer, edits = 3) {
  const doc = a.store.create({ title: 'Stubbed', template: 'blank' }, actor);
  const heads = [a.sync.head('repo-a', doc.id)!];
  for (let n = 0; n < edits; n++) {
    a.store.writeFile(doc.id, { path: 'README.md', content: `edit ${n}` }, actor);
    heads.push(a.sync.head('repo-a', doc.id)!);
  }
  all(a);
  expect(a.sync.compact().compacted).toBe(edits);
  a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
  const intent = a.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!;
  return { doc, heads, intent };
}

/** Payload-free operations authored by replica-c, prepended below the document's genesis on `p`. */
function deepAncestry(p: Peer, docId: string, count: number): string[] {
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const id = `deep-${String(n).padStart(4, '0')}`;
    p.sync.recordOperation('repo-a', { id, replicaId: 'replica-c', sequence: n, docId, parents: ids.length ? [ids.at(-1)!] : [],
      kind: 'document', payloadHash: canonicalPeerHash(id), origin: 'local-authoring' });
    p.db.prepare("INSERT INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes, compacted) VALUES ('repo-a', ?, ?, ?, '{}', 0, 1)")
      .run(id, docId, canonicalPeerHash(id));
    ids.push(id);
  }
  const genesis = (p.db.prepare("SELECT op_id FROM sync_operations WHERE doc_id = ? AND replica_id = 'replica-a' ORDER BY sequence LIMIT 1").get(docId) as { op_id: string }).op_id;
  p.db.prepare('UPDATE sync_operations SET parents_json = ? WHERE op_id = ?').run(JSON.stringify([ids.at(-1)]), genesis);
  return ids;
}

function signedOffer(body: Omit<PeerSessionOffer, 'scopeHash'>): PeerSessionOffer {
  return { ...body, scopeHash: createScopeHash(body) };
}
const stub = (id: string, docId: string, parents: string[] = [], overrides: Partial<PeerOperation> = {}): PeerOperation => ({
  id, replicaId: 'replica-c', sequence: Number(id.replace(/\D/g, '') || 1), docId, parents, kind: 'document',
  payloadHash: canonicalPeerHash(id), origin: 'local-authoring', ...overrides });

async function stage(to: Peer, from: Peer, transfer: PeerTransfer): Promise<void> {
  await to.service.receiveTransfer('transfer', 'machine-a', transfer, fence());
  for (const blob of transfer.blobs) for (let index = 0; index < Math.ceil(blob.bytes / MAX_PEER_CHUNK_BYTES); index++) {
    await to.service.receiveTransfer('chunk', 'machine-a', from.sync.outgoingChunk(transfer, blob.hash, index), fence());
  }
}

describe('protocol-3 ancestor stubs', () => {
  it('lets a member admitted after compaction receive payload-free ancestry that is never readable', () => {
    const a = peer('a'), b = peer('b');
    const { doc, heads, intent } = compactedDoc(a);
    const head = intent.frozenHead;
    const offer = a.service.createOffer(intent);
    expect(offer.stubs!.map((item) => item.id)).toEqual(heads.slice(0, 3));
    expect(offer.versions.map((version) => version.operation.id)).toEqual([heads[3], head]);
    expect(b.sync.apply(offer)).toMatchObject({ stage: 'synced', appliedHeads: { [doc.id]: head } });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('edit 2');
    for (const id of heads.slice(0, 3)) expect(b.sync.version('repo-a', id)).toBeNull();
    expect(compacted(b)).toEqual([...heads.slice(0, 3)].sort());
    expect(b.db.prepare('SELECT bytes, closure_json FROM sync_versions WHERE head_id = ?').get(heads[0])).toEqual({ bytes: 0, closure_json: '{}' });
    expect([...heads, head].every((id) => opIds(b).has(id))).toBe(true);
    // Replay of the same session is idempotent and returns the durable checkpoint.
    expect(b.sync.apply(offer)).toEqual(b.sync.apply(offer));
    // A receipt marks the stubs known, so the next delta omits them.
    a.sync.acceptReceipt(intent, offer, b.sync.apply(offer));
    a.store.writeFile(doc.id, { path: 'README.md', content: 'next' }, actor);
    a.store.update(doc.id, { status: 'implemented', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
    const next = a.service.createOffer(a.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!);
    expect(next.stubs).toBeUndefined();
    expect(b.sync.apply(next).stage).toBe('synced');
  });

  it('keeps the protocol-2 refusal and the frozen-head payload requirement', () => {
    const a = peer('a');
    const { intent } = compactedDoc(a);
    expect(() => a.service.createOffer(intent, 2)).toThrow('manual bootstrap required');
    expect(() => a.service.createTransfer(intent, 1, 2)).toThrow('manual bootstrap required');
    expect(a.sync.outgoingAncestry(intent, { ...routing(), protocolVersion: 2 })).toEqual([]);
    a.db.prepare("UPDATE sync_versions SET compacted = 1 WHERE head_id = ?").run(intent.frozenHead);
    expect(() => a.service.createOffer(intent, 3)).toThrow('manual bootstrap required');
  });

  it('fails closed on a missing operation row in the frozen ancestry', () => {
    const a = peer('a');
    const { heads, intent } = compactedDoc(a);
    a.db.prepare('DELETE FROM sync_operations WHERE op_id = ?').run(heads[1]);
    expect(() => a.service.createOffer(intent)).toThrow('immutable operation missing');
  });

  it('carries stubs through chunked transfers, including ancestors of a stub that still hold payloads', async () => {
    const a = peer('a'), b = peer('b');
    const { doc, heads, intent } = compactedDoc(a);
    // A retained ancestor below a compacted one still travels payload-free: stub sets stay ancestry-closed.
    a.db.prepare('UPDATE sync_versions SET compacted = 0 WHERE head_id = ?').run(heads[0]);
    a.db.prepare('UPDATE sync_versions SET compacted = 0, closure_json = (SELECT closure_json FROM sync_versions WHERE head_id = ?) WHERE head_id = ?').run(heads[3], heads[0]);
    const transfer = a.service.createTransfer(intent, 1);
    expect(transfer.stubs!.map((item) => item.id)).toEqual(heads.slice(0, 3));
    expect(a.sync.outgoingAncestry(intent, transfer)).toEqual([]);
    await stage(b, a, transfer);
    expect(await b.service.receiveTransfer('apply', 'machine-a', transferQuery(transfer), fence())).toMatchObject({ stage: 'synced' });
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('edit 2');
    expect(compacted(b)).toEqual([...heads.slice(0, 3)].sort());
  });

  it('pages deep stub ancestry roots-first through the ancestry method within the page limit', async () => {
    const a = peer('a'), b = peer('b');
    const doc = a.store.create({ title: 'Deep', template: 'blank' }, actor);
    const deep = deepAncestry(a, doc.id, MAX_PEER_PAGE_OPERATIONS + 20);
    all(a);
    a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
    const intent = a.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!;
    const transfer = a.service.createTransfer(intent, 1);
    expect(transfer.stubs).toHaveLength(MAX_PEER_PAGE_OPERATIONS);
    expect(transfer.stubs![0]!.id).toBe(deep[20]);
    const pages = a.sync.outgoingAncestry(intent, transfer);
    expect(pages.map((page) => page.stubs.length)).toEqual([MAX_PEER_PAGE_OPERATIONS, 20]);
    expect(pages[0]!.stubs[0]!.id).toBe(deep[0]);
    // Without the older pages the receiver cannot close the inline stubs.
    await expect(b.service.receiveTransfer('transfer', 'machine-a', transfer, fence())).rejects.toThrow('ancestor stub parent is missing');
    // Pages out of order are refused; in order they record payload-free rows and replay as no-ops.
    await expect(b.service.receiveTransfer('ancestry', 'machine-a', pages[1], fence())).rejects.toThrow('ancestor stub parent is missing');
    const peers = transport(a, b);
    expect(await a.service.deliverPending(peers)).toMatchObject({ synced: 1 });
    const methods = vi.mocked(peers.call).mock.calls.map((call) => call[1]);
    expect(methods.filter((method) => method === 'ancestry')).toHaveLength(2);
    expect(methods.indexOf('ancestry')).toBeLessThan(methods.indexOf('transfer'));
    expect(b.store.find(doc.id)).not.toBeNull();
    expect(deep.every((id) => opIds(b).has(id) && b.sync.version('repo-a', id) === null)).toBe(true);
    const before = opIds(b).size;
    expect(await b.service.receiveTransfer('ancestry', 'machine-a', pages[0], fence())).toEqual({ stage: 'received', stubs: MAX_PEER_PAGE_OPERATIONS });
    expect(opIds(b).size).toBe(before);
  });

  it('forwards stubs it holds to a third member without ever reading them', () => {
    const a = peer('a'), b = peer('b'), c = peer('c');
    const { doc, heads, intent } = compactedDoc(a);
    b.sync.apply(a.service.createOffer(intent));
    const onward = b.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-c')!;
    const offer = b.service.createOffer(onward);
    expect(offer.stubs!.map((item) => item.id)).toEqual(heads.slice(0, 3));
    expect(c.sync.apply(offer)).toMatchObject({ stage: 'synced' });
    expect(c.store.readFile(doc.id, 'README.md').content).toBe('edit 2');
  });

  it('falls to the common-ancestor-unavailable path when the only merge base is a stub', () => {
    const a = peer('a'), b = peer('b');
    const { doc, heads, intent } = compactedDoc(a);
    const offer = a.service.createOffer(intent);
    b.sync.apply(offer);
    const remote = structuredClone(offer.versions.at(-1)!);
    remote.closure.files[0]!.content = 'forked from a stub';
    remote.closure.files[0]!.size = Buffer.byteLength('forked from a stub');
    remote.operation = { ...remote.operation, id: 'fork-head', replicaId: 'replica-c', sequence: 9, parents: [heads[1]!],
      payloadHash: canonicalPeerHash(remote.closure) };
    const fork = signedOffer({ ...routing(), sessionId: 'fork', versions: [remote], heads: { [doc.id]: 'fork-head' } });
    expect(b.sync.apply(fork).stage).toBe('conflict');
    const preview = b.sync.conflictCandidate(doc.id, 'fork-head');
    expect(preview).toMatchObject({ baseHead: heads[1], candidate: null, conflicts: ['common ancestor unavailable'] });
    const expectedHead = b.sync.head('repo-a', doc.id)!;
    expect(() => b.sync.resolveConflict({ docId: doc.id, expectedHead, remoteHead: 'fork-head', choice: 'merge' }, actor)).toThrow('common ancestor unavailable');
    expect(b.sync.resolveConflict({ docId: doc.id, expectedHead, remoteHead: 'fork-head', choice: 'remote' }, actor)).toBeTruthy();
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('forked from a stub');
  });

  it('rehydrates a stub only with a payload whose operation matches exactly', () => {
    const a = peer('a'), b = peer('b');
    const { doc, heads, intent } = compactedDoc(a);
    const offer = a.service.createOffer(intent);
    b.sync.apply(offer);
    const full = structuredClone(offer.versions.at(-1)!);
    const forged = { ...full, operation: { ...full.operation, id: heads[2]!, sequence: 3 } };
    const send = (sessionId: string, version: typeof full) => signedOffer({ ...routing(), sessionId, versions: [version], heads: { [doc.id]: version.operation.id } });
    // The stub fixed parents and payload hash; a payload claiming that id under another operation is refused.
    expect(() => b.sync.apply(send('forged', forged))).toThrow('operation id payload mismatch');
    expect(b.sync.version('repo-a', heads[2]!)).toBeNull();
    const genesis = structuredClone(b.sync.version('repo-a', heads[3]!)!);
    expect(genesis.operation.parents).toEqual([heads[2]]);
  });
});

describe('ancestor stub validation', () => {
  const docId = 'doc-1';
  const base = (p: Peer) => {
    const doc = p.store.create({ title: 'Target', status: 'approved', template: 'blank' }, actor);
    const intent = p.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!;
    return { doc, intent, offer: p.service.createOffer(intent) };
  };
  /** Re-roots the single offered genesis onto the supplied stub chain and re-signs. */
  const withStubs = (offer: PeerSessionOffer, stubs: PeerOperation[], parent: string | null = stubs.at(-1)?.id ?? null, extra: Partial<PeerSessionOffer> = {}) => {
    const version = structuredClone(offer.versions[0]!);
    version.operation.parents = parent ? [parent] : [];
    const { scopeHash: _scope, ...body } = { ...offer, versions: [version], stubs, sessionId: `s-${stubs.length}-${parent}`, ...extra };
    return signedOffer(body);
  };

  it('rejects malformed, cyclic, cross-document, oversized and duplicate stubs before any commit', () => {
    const a = peer('a'), b = peer('b');
    const { doc, offer } = base(a);
    const id = doc.id;
    const check = (candidate: PeerSessionOffer) => validateSessionOffer(candidate, expectation(), (op) => b.sync.operationDoc('repo-a', op));
    expect(() => check(withStubs(offer, [stub('s1', id)]))).not.toThrow();
    expect(() => check(withStubs(offer, [stub('s1', id, [], { payloadHash: 'not-a-hash' })]))).toThrow('requires immutable payloads');
    expect(() => check(withStubs(offer, [stub('s1', id, ['s2']), stub('s2', id, ['s1'])], 's2'))).toThrow('missing, out of order');
    expect(() => check(withStubs(offer, [stub('s1', id, ['s1'])]))).toThrow('invalid operation parents');
    expect(() => check(withStubs(offer, [stub('s1', 'other-doc')]))).toThrow('cross-document parent');
    expect(() => check(withStubs(offer, [stub('s1', id), stub('s2', 'other-doc')], 's1'))).toThrow('payload outside frozen closure');
    expect(() => check(withStubs(offer, [stub('s1', 'other-doc'), stub('s2', id, ['s1'])], 's2'))).toThrow('cross-document');
    expect(() => check(withStubs(offer, [stub('s1', id), stub('s1', id)], 's1'))).toThrow('duplicate ancestor stub identity');
    expect(() => check(withStubs(offer, [stub('s1', id), stub('s9', id, [], { sequence: 1 })], 's1'))).toThrow('duplicate ancestor stub identity');
    expect(() => check(withStubs(offer, [stub('s1', id, [], { id: offer.versions[0]!.operation.id })], null))).toThrow('duplicate operation identity');
    expect(() => check(withStubs(offer, [], null))).toThrow('requires immutable payloads');
    const many = Array.from({ length: MAX_PEER_PAGE_OPERATIONS + 1 }, (_, n) => stub(`s${n + 1}`, id, n ? [`s${n}`] : []));
    expect(() => check(withStubs(offer, many))).toThrow('requires immutable payloads');
    expect(() => check(withStubs(offer, [stub('s1', id)], 's1', { protocolVersion: 2 }))).toThrow('ancestor stubs require delta protocol');
    expect(() => check(withStubs(offer, [stub('s1', id)], 's1', { heads: { [id]: 's1' } }))).toThrow('frozen head document mismatch');
    const tampered = { ...withStubs(offer, [stub('s1', id)]), stubs: [stub('s1', id, [], { payloadHash: canonicalPeerHash('forged') })] };
    expect(() => check(tampered)).toThrow('scope hash does not match');
    expect(opIds(b).size).toBe(0);
  });

  it('enforces origin, local-stream and held-identity fences on commit and stays atomic', () => {
    const a = peer('a'), b = peer('b');
    const { doc, offer } = base(a);
    const id = doc.id;
    b.sync.recordOperation('repo-a', stub('s1', id));
    const before = b.sync.operations('repo-a');
    expect(() => b.sync.apply(withStubs(offer, [stub('s1', id, [], { payloadHash: canonicalPeerHash('forged') })]))).toThrow('operation id payload mismatch');
    expect(() => b.sync.apply(withStubs(offer, [stub('s7', id, [], { sequence: 1 })]))).toThrow('operation sequence identity mismatch');
    expect(() => b.sync.apply(withStubs(offer, [stub('s2', id, [], { replicaId: 'replica-b' })]))).toThrow('peer cannot append to local replica stream');
    expect(() => b.sync.apply(withStubs(offer, [stub('s2', id, [], { replicaId: 'replica-z' })]))).toThrow('origin is not authorized');
    expect(b.sync.operations('repo-a')).toEqual(before);
    expect(b.store.find(id)).toBeNull();
    // Held identical stub replays cleanly, and a held stub may be a delta parent of a new stub.
    expect(b.sync.apply(withStubs(offer, [stub('s1', id), stub('s2', id, ['s1'])])).stage).toBe('synced');
    expect(b.sync.version('repo-a', 's2')).toBeNull();
    expect(() => validateSessionOffer(withStubs(offer, [stub('s3', id, ['s2'])]), expectation())).toThrow('missing, out of order');
  });

  it('validates transfers and ancestry pages with the same rules', () => {
    const a = peer('a'), b = peer('b');
    const { doc, intent } = base(a);
    const id = doc.id;
    const transfer = a.service.createTransfer(intent, 1);
    const resign = (patch: Partial<PeerTransfer>, reroot = true) => {
      const versions = structuredClone(transfer.versions);
      if (reroot && patch.stubs?.length) versions[0]!.operation.parents = [patch.stubs.at(-1)!.id];
      const { scopeHash: _scope, ...body } = { ...transfer, versions, ...patch };
      return { ...body, scopeHash: createTransferHash(body) } as PeerTransfer;
    };
    expect(() => validateTransfer(resign({ stubs: [stub('s1', id)] }), expectation())).not.toThrow();
    expect(() => validateTransfer(resign({ stubs: [stub('s1', id), stub('s2', 'other-doc')] }), expectation())).toThrow('cross-document');
    expect(() => validateTransfer(resign({ stubs: [stub('s2', 'other-doc'), stub('s1', id)] }), expectation())).toThrow('transfer contains unoffered versions');
    expect(() => validateTransfer(resign({ stubs: [stub('s1', id, [], { id: transfer.versions[0]!.operation.id })] }, false), expectation())).toThrow('duplicate transfer operation');
    expect(() => validateTransfer(resign({ protocolVersion: 2, stubs: [stub('s1', id)] }), { ...expectation() })).toThrow('ancestor stubs require delta protocol');

    const page = (stubs: PeerOperation[], patch: Partial<PeerAncestryPage> = {}): PeerAncestryPage => ({ ...routing(), docId: id, stubs, ...patch });
    expect(validateAncestryPage(page([stub('s1', id), stub('s2', id, ['s1'])]), expectation()).stubs).toHaveLength(2);
    expect(() => validateAncestryPage(page([stub('s1', id), stub('s2', 'other', [])]), expectation())).toThrow('spans documents');
    expect(() => validateAncestryPage(page([stub('s1', id)], { protocolVersion: 2 }), expectation())).toThrow('require delta protocol');
    expect(() => validateAncestryPage(page([]), expectation())).toThrow('invalid ancestor stub page');
    expect(() => validateAncestryPage({ ...page([stub('s1', id)]), extra: true }, expectation())).toThrow('invalid ancestor stub page');
    expect(() => validateAncestryPage(page(Array.from({ length: MAX_PEER_PAGE_OPERATIONS + 1 }, (_, n) => stub(`s${n + 1}`, id, n ? [`s${n}`] : [])))
      , expectation())).toThrow('invalid ancestor stub page');
    expect(() => validateAncestryPage(page([stub('s1', id)], { senderReplicaId: 'replica-c' }), expectation())).toThrow('does not match');

    // Store-level fences hold even for callers that skip packet validation.
    expect(() => b.sync.recordStubs(page([stub('s1', id)], { protocolVersion: 2 }))).toThrow('require delta protocol');
    expect(() => b.sync.recordStubs(page([stub('s1', 'other')]))).toThrow('spans documents');
    expect(() => b.sync.recordStubs(page([stub('s2', id, ['s1'])]))).toThrow('neither offered nor held');
    expect(() => b.sync.recordStubs(page([stub('s1', id)], { recipientReplicaId: 'replica-c' }))).toThrow('authorization changed');
    expect(b.sync.recordStubs(page([stub('s1', id)]))).toBe(1);
    expect(b.sync.recordStubs(page([stub('s1', id)]))).toBe(1);
    expect(b.sync.version('repo-a', 's1')).toBeNull();
    const v2 = { ...resign({}), protocolVersion: 2, stubs: [stub('s1', id)] };
    b.sync.stageTransfer(v2 as PeerTransfer);
    expect(() => b.sync.applyTransfer(transferQuery(v2))).toThrow();
  });
});

describe('ancestor stub fences', () => {
  it('bounds frozen ancestry by the session operation limit', () => {
    const a = peer('a');
    const doc = a.store.create({ title: 'Huge', template: 'blank' }, actor);
    deepAncestry(a, doc.id, MAX_PEER_SESSION_OPERATIONS);
    all(a);
    a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
    const intent = a.sync.readyIntents('repo-a').find((item) => item.memberReplicaId === 'replica-b')!;
    expect(() => a.service.createOffer(intent)).toThrow('frozen ancestry exceeds session limit');
  });

  it('refuses stubs below protocol 3 even when packet validation is bypassed', () => {
    const b = peer('b');
    const apply = (b.sync as unknown as { applyVerified: (offer: unknown, versions: unknown[]) => unknown }).applyVerified.bind(b.sync);
    expect(() => apply({ ...routing('replica-a', 'replica-b', 2), sessionId: 'x', scopeHash: canonicalPeerHash('x'), heads: {},
      stubs: [stub('s1', 'doc-x')] }, [])).toThrow('ancestor stubs require delta protocol');
    expect(opIds(b).size).toBe(0);
  });

  it('fences the ancestry handler to roster peers and well-formed packets', async () => {
    const b = peer('b');
    const page = { ...routing(), docId: 'doc-x', stubs: [stub('s1', 'doc-x')] };
    await expect(b.handlers.get('ancestry')!({ peerId: 'machine-a', body: null, ...fence() } as unknown as PluginPeerRequest)).rejects.toThrow();
    await expect(b.service.receiveTransfer('ancestry', 'machine-z', page, fence())).rejects.toThrow();
    await expect(b.service.receiveTransfer('ancestry', 'machine-a', { ...page, senderReplicaId: 'replica-c' }, fence())).rejects.toThrow();
    await expect(b.service.receiveTransfer('ancestry', 'machine-a', page, { ...fence(), grantEpoch: 2 })).rejects.toThrow();
    expect(opIds(b).size).toBe(0);
    expect(await b.service.receiveTransfer('ancestry', 'machine-a', page, fence())).toEqual({ stage: 'received', stubs: 1 });
    expect(b.sync.version('repo-a', 's1')).toBeNull();
  });
});

describe('opportunistic compaction', () => {
  it('runs one bounded batch after a sync completes on sender and receiver', async () => {
    const a = peer('a'), b = peer('b');
    const doc = a.store.create({ title: 'Schedule', template: 'blank' }, actor);
    for (let n = 0; n < 3; n++) a.store.writeFile(doc.id, { path: 'README.md', content: `draft ${n}` }, actor);
    a.store.update(doc.id, { status: 'approved', expectedHead: a.sync.head('repo-a', doc.id) }, actor);
    a.sync.recordPeerProtocol('replica-c', 3);
    const senderCompact = vi.spyOn(a.sync, 'compact'), receiverCompact = vi.spyOn(b.sync, 'compact');
    expect(await a.service.deliverPending(transport(a, b))).toMatchObject({ synced: 1 });
    expect(senderCompact).toHaveBeenCalledWith(PEER_COMPACTION_BATCH);
    expect(receiverCompact).toHaveBeenCalledWith(PEER_COMPACTION_BATCH);
    // The store's own pins decide: replica-c still awaits this document, so nothing it needs loses its payload.
    expect(senderCompact.mock.results[0]!.value).toMatchObject({ compacted: expect.any(Number) });
    expect(a.sync.version('repo-a', a.sync.head('repo-a', doc.id)!)).not.toBeNull();
    expect(b.store.readFile(doc.id, 'README.md').content).toBe('draft 2');
  });

  it('does not compact after a delivery round that synced nothing', async () => {
    const a = peer('a');
    a.store.create({ title: 'Offline', status: 'approved', template: 'blank' }, actor);
    const compact = vi.spyOn(a.sync, 'compact');
    expect(await a.service.deliverPending(transport(a))).toMatchObject({ synced: 0 });
    expect(compact).not.toHaveBeenCalled();
  });

  it('swallows a failing compaction so delivery still reports success', async () => {
    const a = peer('a'), b = peer('b');
    a.store.create({ title: 'Swallow', status: 'approved', template: 'blank' }, actor);
    vi.spyOn(a.sync, 'compact').mockImplementation(() => { throw new Error('boom'); });
    expect(await a.service.deliverPending(transport(a, b))).toMatchObject({ synced: 1 });
  });
});
