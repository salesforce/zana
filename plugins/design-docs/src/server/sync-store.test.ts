import { describe, expect, it } from 'vitest';
import { DesignDocSyncStore } from './sync-store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocStore } from './store.js';
import { DesignDocPeerService } from './peer-service.js';
import { MAX_PENDING_PEER_INTENTS, MAX_PEER_STORED_BYTES, MAX_PEER_STORED_VERSIONS, MAX_PEER_STORED_OPERATIONS } from '../shared/peer-limits.js';
import { DESIGN_DOC_MIGRATIONS } from './schema.js';
import { canonicalPeerHash } from '../shared/peer-contract.js';
import { transferQuery } from './peer-protocol.js';
import { createScopeHash } from './peer-protocol.js';
import { MAX_TEXT_REVISIONS_PER_FILE } from '../shared/limits.js';
import { createRoster, transferSeat, requestRetirement, appendSeat } from './peer-slots.js';
import { DesignDocPeerGroup } from './peer-group.js';

const actor = { kind: 'user' as const, label: 'You', threadId: null };
function fixture(paired = true, maxHistoryBytes?: number) {
  const db = createTestDatabase();
  let sync!: DesignDocSyncStore;
  const store = new DesignDocStore(db, { maxHistoryBytes, onMutation: (mutation) => sync.recordLocalMutation(mutation) });
  sync = new DesignDocSyncStore(db);
  sync.initialize('repo-a', 'replica-a');
  const pair = () => sync.setGroup('repo-a', 'group-a', [
    { replicaId: 'replica-a', machineId: 'machine-a', sponsorReplicaId: null, joinedAt: 1 },
    { replicaId: 'replica-b', machineId: 'machine-b', sponsorReplicaId: 'replica-a', joinedAt: 2 }
  ]);
  if (paired) pair();
  return { db, store, sync, pair, service: new DesignDocPeerService(sync) };
}

describe('immutable sync store', () => {
  it('manual ACK accepts earlier incoming consent so bilateral peers can exchange either order', () => {
    const a = fixture(false), b = fixture(false);
    const left = a.store.create({ title: 'Left private', template: 'blank' }, actor);
    const right = b.store.create({ title: 'Right private', template: 'blank' }, actor);
    a.pair(); b.pair(); b.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-b'").run();
    a.sync.prepareManual();
    const ac = a.sync.manualConsent('replica-b')!;
    expect(b.sync.acceptManual('replica-a', ac.manualId, ac.heads)).toBe(false);
    b.sync.prepareManual();
    const bc = b.sync.manualConsent('replica-a')!;
    expect(a.sync.acceptManual('replica-b', bc.manualId, bc.heads)).toBe(true);
    b.sync.completeManual(bc.manualId);
    expect(() => b.sync.apply(a.service.createOffer(a.sync.readyIntents('repo-a')[0]!))).not.toThrow();
    expect(() => a.sync.apply(b.service.createOffer(b.sync.readyIntents('repo-a')[0]!))).not.toThrow();
    expect(a.store.find(right.id)).not.toBeNull(); expect(b.store.find(left.id)).not.toBeNull();
  });

  it('prunes delivered unreferenced operation rows at capacity while retaining sequence frontier and tombstones', () => {
    const { sync, db, store } = fixture();
    const doc = store.create({ title: 'Retention', template: 'blank' }, actor);
    const head = sync.head('repo-a', doc.id)!, operation = sync.version('repo-a', head)!.operation;
    sync.recordPeerProtocol('replica-b', 3);
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 2 UNION ALL SELECT x+1 FROM n WHERE x < ?)
      INSERT INTO sync_operations SELECT 'repo-a', 'old-' || x, 'replica-a', x, 'old-doc', '[]', 'document', ?, 'local-authoring', x FROM n`)
      .run(MAX_PEER_STORED_OPERATIONS, operation.payloadHash);
    db.runScript("INSERT INTO sync_peer_known SELECT repo_id, 'replica-b', op_id FROM sync_operations WHERE doc_id = 'old-doc';");
    const before = db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get();
    db.runScript("CREATE TRIGGER fail_operation BEFORE INSERT ON sync_operations BEGIN SELECT RAISE(ABORT, 'operation fault'); END;");
    expect(() => sync.recordOperation('repo-a', { ...operation, id: 'rollback-operation', sequence: MAX_PEER_STORED_OPERATIONS + 1 })).toThrow('operation fault');
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get()).toEqual(before);
    db.runScript('DROP TRIGGER fail_operation;');
    expect(() => sync.recordOperation('repo-a', { ...operation, id: 'next-operation', sequence: MAX_PEER_STORED_OPERATIONS + 1 })).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get() as { n: number }).n).toBeLessThan(MAX_PEER_STORED_OPERATIONS);
    expect(sync.version('repo-a', head)).not.toBeNull();
    expect(sync.operationDoc('repo-a', `old-${MAX_PEER_STORED_OPERATIONS}`)).toBe('old-doc');
  });

  it('refuses operation pruning before delta negotiation and while retained payloads pin every row', () => {
    const { sync, db, store } = fixture();
    store.create({ title: 'Pinned retention', template: 'blank' }, actor);
    const operation = sync.operations('repo-a')[0]!;
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 2 UNION ALL SELECT x+1 FROM n WHERE x < ?)
      INSERT INTO sync_operations SELECT 'repo-a', 'old-' || x, 'replica-a', x, 'old-doc', '[]', 'document', ?, 'local-authoring', x FROM n`)
      .run(MAX_PEER_STORED_OPERATIONS, operation.payloadHash);
    const next = { ...operation, id: 'no-room', sequence: MAX_PEER_STORED_OPERATIONS + 1 };
    expect(() => sync.recordOperation('repo-a', next)).toThrow('operation capacity');
    sync.recordPeerProtocol('replica-b', 3);
    db.runScript("INSERT INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes, compacted) SELECT repo_id, op_id, doc_id, payload_hash, '{}', 0, 1 FROM sync_operations WHERE doc_id = 'old-doc';");
    expect(() => sync.recordOperation('repo-a', next)).toThrow('operation capacity');
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_operations').get()).toEqual({ n: MAX_PEER_STORED_OPERATIONS });
  });

  it('pages Sync Now across more than ten thousand documents without buffering whole vault', () => {
    const { sync, db } = fixture();
    db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < 10001)
      INSERT INTO docs (id, slug, title, created_at, updated_at, created_by, updated_by)
      SELECT printf('doc-%05d', x), printf('doc-%05d', x), 'Paged manual', 1, 1, ?, ? FROM n`)
      .run(JSON.stringify(actor), JSON.stringify(actor));
    db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by, sync_id)
      SELECT id, 'README.md', '', 'utf8', 0, 1, 1, ?, 'file-' || id FROM docs`).run(JSON.stringify(actor));
    let cursor: string | null = '', total = 0;
    do {
      cursor = sync.prepareManual(cursor!);
      const consent = sync.manualConsent('replica-b')!;
      expect(Object.keys(consent.heads).length).toBeLessThanOrEqual(500);
      total += Object.keys(consent.heads).length;
      db.prepare("UPDATE sync_intents SET state = 'synced'").run();
      sync.completeManual(consent.manualId);
    } while (cursor);
    expect(total).toBe(10001);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sync_doc_heads').get()).toEqual({ n: 10001 });
  }, 120000);

  it('rejects private offers without exact bilateral consent before persisting payloads', () => {
    const a = fixture(false), b = fixture();
    b.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-b'").run();
    const doc = a.store.create({ title: 'Private offer', template: 'blank' }, actor);
    a.pair();
    a.sync.prepareManual();
    const consent = a.sync.manualConsent('replica-b')!, intent = a.sync.readyIntents('repo-a')[0]!;
    const offer = a.service.createOffer(intent), transfer = a.service.createTransfer(intent, 1);
    expect(() => b.sync.apply(offer)).toThrow('bilateral manual consent');
    expect(() => b.sync.stageTransfer(transfer)).toThrow('bilateral manual consent');
    expect(b.sync.acceptManual('replica-a', consent.manualId, consent.heads)).toBe(false);
    expect(() => b.sync.apply(offer)).toThrow('bilateral manual consent');
    b.sync.prepareManual();
    expect(b.sync.acceptManual('replica-a', consent.manualId, consent.heads)).toBe(true);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'later private' }, actor);
    const later = a.sync.freezeManual()[0]!, changed = a.service.createOffer(later);
    expect(() => b.sync.apply(changed)).toThrow('bilateral manual consent');
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_versions').get()).toEqual({ n: 0 });
    expect(b.sync.apply(offer).stage).toBe('synced');
    expect(b.sync.apply(offer).stage).toBe('synced');
    expect(b.store.find(doc.id)).not.toBeNull();
  });

  it('rejects a mismatched consent head on transfer even when operation is not bootstrap', () => {
    const a = fixture(), b = fixture();
    b.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-b'").run();
    const doc = a.store.create({ title: 'Tracked private', template: 'blank' }, actor);
    a.sync.prepareManual(); b.sync.prepareManual();
    const consent = a.sync.manualConsent('replica-b')!;
    expect(b.sync.acceptManual('replica-a', consent.manualId, consent.heads)).toBe(true);
    a.store.writeFile(doc.id, { path: 'README.md', content: 'later' }, actor);
    const intent = a.sync.freezeManual()[0]!;
    expect(() => b.sync.stageTransfer(a.service.createTransfer(intent, 1))).toThrow('bilateral manual consent');
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM sync_transfers').get()).toEqual({ n: 0 });
  });

  it('reclaims completed manual-session capacity without pruning waiting or undelivered consent', () => {
    const { sync, db, store } = fixture();
    db.runScript(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ${MAX_PENDING_PEER_INTENTS})
      INSERT INTO sync_manual_sessions SELECT 'completed-' || x, 'repo-a', 'replica-b', 'out', 'accepted', '{}', x FROM n;`);
    expect(() => sync.prepareManual()).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) AS n FROM sync_manual_sessions').get() as { n: number }).n).toBeLessThan(200);
    const waiting = sync.manualConsent('replica-b')!;
    store.create({ title: 'Undelivered consent', template: 'blank' }, actor);
    sync.prepareManual();
    sync.completeManual(waiting.manualId);
    const undelivered = sync.manualConsents()[0]!;
    sync.completeManual(undelivered.manualId);
    expect(db.prepare('SELECT 1 FROM sync_manual_sessions WHERE session_id = ?').get(undelivered.manualId)).toBeTruthy();
    expect(() => sync.acceptManual('replica-b', 'incoming-empty', {})).not.toThrow();
    expect(() => sync.acceptManual('replica-b', 'incoming-empty', { changed: 'head' })).toThrow('identity mismatch');
  });

  it('stops permanent delivery failure after ten attempts and retains terminal error across restart', () => {
    const { sync, db, store } = fixture();
    store.create({ title: 'Permanent failure', status: 'approved', template: 'blank' }, actor);
    const intent = sync.readyIntents('repo-a')[0]!;
    for (let attempt = 0; attempt < 10; attempt++) sync.deferIntent(intent, 'permanent failure');
    expect(new DesignDocSyncStore(db).readyIntents('repo-a', 100, true)).toEqual([]);
    expect(db.prepare('SELECT state FROM sync_intents WHERE id = ?').get(intent.id)).toEqual({ state: 'blocked' });
    expect(db.prepare('SELECT attempts, error FROM sync_retry WHERE intent_id = ?').get(intent.id))
      .toEqual({ attempts: 10, error: 'permanent failure' });
    sync.deferIntent(intent, 'late failure');
    expect(db.prepare('SELECT attempts, error FROM sync_retry WHERE intent_id = ?').get(intent.id))
      .toEqual({ attempts: 10, error: 'permanent failure' });
  });

  it('rolls back terminal retry state if durable error cannot be recorded', () => {
    const { sync, db, store } = fixture();
    store.create({ title: 'Retry rollback', status: 'approved', template: 'blank' }, actor);
    const intent = sync.readyIntents('repo-a')[0]!;
    for (let attempt = 0; attempt < 9; attempt++) sync.deferIntent(intent, 'offline');
    db.runScript("CREATE TRIGGER fail_retry BEFORE UPDATE ON sync_retry BEGIN SELECT RAISE(ABORT, 'retry fault'); END;");
    expect(() => sync.deferIntent(intent, 'terminal')).toThrow('retry fault');
    expect(db.prepare('SELECT state FROM sync_intents WHERE id = ?').get(intent.id)).toEqual({ state: 'pending' });
    expect(db.prepare('SELECT attempts FROM sync_retry WHERE intent_id = ?').get(intent.id)).toEqual({ attempts: 9 });
  });

  it('retained local removal fences data ACKs and runners after detach and restart without blocking authoring', () => {
    const a = fixture(), b = fixture();
    b.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-b'").run();
    const root = createRoster('repo-a', 'group-a', a.sync.members('repo-a'), 'genesis', 'replica-a');
    const roster = appendSeat(root, { kind: 'admit', seat: 3, requestId: 'admit-c', ownerReplicaId: 'replica-a',
      member: { replicaId: 'replica-c', machineId: 'machine-c', joinedAt: 3, sponsorReplicaId: 'replica-a' } });
    for (const [peer, machine] of [[a, 'machine-a'], [b, 'machine-b']] as const) {
      peer.sync.setGroup('repo-a', 'group-a', roster.members);
      peer.db.prepare('UPDATE sync_group_control SET local_peer_id = ?, roster_json = ?').run(machine, JSON.stringify(roster));
      peer.db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(roster.rosterEpoch);
    }
    const incoming = b.store.create({ title: 'Committed incoming', status: 'approved', template: 'blank' }, actor);
    const offer = b.service.createOffer(b.sync.readyIntents('repo-a').find((intent) => intent.memberReplicaId === 'replica-a')!);
    a.sync.apply(offer);
    const own = a.store.create({ title: 'Pending local', status: 'approved', files: [{ path: 'README.md', content: 'frozen' }] }, actor);
    const intent = a.sync.readyIntents('repo-a').find((item) => item.docId === own.id)!, transfer = a.service.createTransfer(intent, 1);
    a.sync.prepareManual(); const manual = a.sync.manualConsent('replica-b')!;
    a.sync.deferIntent(intent, 'offline');
    new DesignDocPeerGroup(a.db).remove('replica-a');
    expect(a.sync.localRepository()!.groupId).toBeNull();
    const tables = ['sync_intents', 'sync_transfers', 'sync_manual_sessions', 'sync_retry', 'sync_checkpoints'];
    const retained = tables.map((table) => a.db.prepare(`SELECT * FROM ${table}`).all());
    for (const sync of [a.sync, new DesignDocSyncStore(a.db)]) {
      const query = transferQuery(offer);
      expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(true);
      expect(sync.readyIntents('repo-a', 100, true)).toEqual([]); expect(sync.manualConsents()).toEqual([]);
      expect(() => sync.checkpoint(query.repoId, query.senderReplicaId, query.sessionId, query.scopeHash, query.rosterDigest)).toThrow('retiring');
      expect(() => sync.completeManual(manual.manualId)).toThrow('retiring');
      expect(() => sync.acceptManual('replica-b', 'terminal', {})).toThrow('retiring');
      expect(() => sync.outgoingChunk(transfer, transfer.blobs.find((blob) => blob.bytes > 0)!.hash, 0)).toThrow('retiring');
      sync.deferIntent(intent, 'terminal');
      expect(sync.createFrozenIntents('repo-a', own.id, intent.frozenHead, intent.scopeHash)).toEqual([]);
    }
    a.store.writeFile(own.id, { path: 'README.md', content: 'private after detach' }, actor);
    a.store.update(own.id, { status: 'implemented' }, actor);
    expect(a.store.readFile(own.id, 'README.md').content).toBe('private after detach');
    expect(a.store.find(incoming.id)).not.toBeNull(); expect(a.sync.version('repo-a', intent.frozenHead)).not.toBeNull();
    expect(tables.map((table) => a.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(retained);
  });

  it('detached terminal fence ignores unrelated repo, replica, local identity and legacy rosters', () => {
    const { sync, db } = fixture();
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    const roster = appendSeat(root, { kind: 'admit', seat: 3, requestId: 'admit-c', ownerReplicaId: 'replica-a',
      member: { replicaId: 'replica-c', machineId: 'machine-c', joinedAt: 3, sponsorReplicaId: 'replica-a' } });
    db.prepare('UPDATE sync_group_control SET local_peer_id = ?, roster_json = ?').run('machine-a', JSON.stringify(roster));
    sync.setGroup('repo-a', 'group-a', roster.members);
    new DesignDocPeerGroup(db).remove('replica-a');
    const terminal = JSON.parse((db.prepare('SELECT roster_json FROM sync_group_control').get() as { roster_json: string }).roster_json);
    for (const patch of [{ repoId: 'other' }, { version: 2 }]) {
      db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify({ ...terminal, ...patch }));
      expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(false);
    }
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(terminal));
    db.prepare("UPDATE sync_group_control SET local_peer_id = 'other'").run();
    expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(false);
    db.prepare("UPDATE sync_group_control SET local_peer_id = 'machine-a'").run();
    db.prepare("UPDATE sync_repositories SET replica_id = 'other'").run();
    expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(false);
    db.prepare("UPDATE sync_repositories SET replica_id = 'replica-a'").run();
    expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(true);
    expect(sync.isRetiringReplica('other', 'replica-a')).toBe(false);
    expect(sync.isRetiringReplica('repo-a', 'replica-b')).toBe(false);
  });

  it('filters retiring data members only for matching managed repo/group and keeps bare setGroup unchanged', () => {
    const { sync, db } = fixture();
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    const pending = requestRetirement(root, 'replica-a', 'replica-b');
    expect(sync.isRetiringReplica('repo-a', 'replica-b')).toBe(false);
    expect(sync.members('repo-a')).toHaveLength(2);
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(pending));
    expect(pending.members).toHaveLength(2);
    expect(sync.isRetiringReplica('repo-a', 'replica-b')).toBe(true);
    expect(sync.isRetiringReplica('other-repo', 'replica-b')).toBe(false);
    expect(sync.isRetiringReplica('repo-a', 'replica-a')).toBe(false);
    expect(sync.members('repo-a').map((member) => member.replicaId)).toEqual(['replica-a']);
    for (const patch of [{ repoId: 'other-repo' }, { groupId: 'other-group' }, { version: 2 }]) {
      db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify({ ...pending, ...patch }));
      expect(sync.isRetiringReplica('repo-a', 'replica-b')).toBe(false);
      expect(sync.members('repo-a')).toHaveLength(2);
    }
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(pending));
    db.prepare('UPDATE sync_repositories SET group_id = NULL').run();
    expect(sync.isRetiringReplica('repo-a', 'replica-b')).toBe(false);
    expect(sync.members('repo-a')).toHaveLength(2);
  });

  it('journals retiring local edits causally without new intents, manual authority or runner writes', () => {
    const { sync, db, store, service } = fixture();
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(root));
    const doc = store.create({ title: 'Local retirement', status: 'approved', files: [{ path: 'README.md', content: 'shared' }] }, actor);
    const intent = sync.readyIntents('repo-a')[0]!, original = sync.version('repo-a', intent.frozenHead);
    sync.prepareManual();
    const manual = sync.manualConsent('replica-b')!;
    const pending = requestRetirement(root, 'replica-b', 'replica-a');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(pending));
    db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(pending.rosterEpoch);
    const retained = db.prepare('SELECT * FROM sync_intents').all(), sessions = db.prepare('SELECT * FROM sync_manual_sessions').all();
    store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE RETIRING EDIT' }, actor);
    const edited = sync.head('repo-a', doc.id)!;
    expect(sync.version('repo-a', edited)!.operation.parents).toEqual([intent.frozenHead]);
    store.update(doc.id, { status: 'implemented', expectedHead: edited }, actor);
    expect(sync.version('repo-a', sync.head('repo-a', doc.id)!)!.operation.parents).toEqual([edited]);
    expect(sync.version('repo-a', intent.frozenHead)).toEqual(original);
    expect(store.readFile(doc.id, 'README.md').content).toBe('PRIVATE RETIRING EDIT');
    expect(db.prepare('SELECT * FROM sync_intents').all()).toEqual(retained);
    expect(sync.readyIntents('repo-a', 100, true)).toEqual([]); expect(sync.manualConsents()).toEqual([]);
    sync.deferIntent(intent, 'retired');
    expect(db.prepare('SELECT * FROM sync_retry').all()).toEqual([]);
    expect(() => sync.freezeManual()).toThrow('retiring'); expect(() => sync.prepareManual()).toThrow('retiring');
    expect(() => sync.acceptManual('replica-b', 'new-consent', {})).toThrow('retiring');
    expect(() => sync.completeManual(manual.manualId)).toThrow('retiring');
    expect(db.prepare('SELECT * FROM sync_manual_sessions').all()).toEqual(sessions);
    expect(service.status()).toEqual({ configured: false, members: [] });
    expect(() => service.createOffer(intent)).toThrow('retiring');
    const restarted = new DesignDocSyncStore(db);
    expect(restarted.readyIntents('repo-a')).toEqual([]);
    expect(restarted.version('repo-a', intent.frozenHead)).toEqual(original);
  });

  it('creates new intents only for data members and blocks old retiring-recipient intents without discarding frozen state', () => {
    const { sync, db, store, service } = fixture();
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(root));
    const doc = store.create({ title: 'Target retires', status: 'approved', template: 'blank' }, actor);
    const intent = sync.readyIntents('repo-a')[0]!, offer = service.createOffer(intent), transfer = service.createTransfer(intent, 1);
    sync.prepareManual(); const manual = sync.manualConsent('replica-b')!;
    const pending = requestRetirement(root, 'replica-a', 'replica-b');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(pending));
    db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(pending.rosterEpoch);
    store.update(doc.id, { status: 'implemented', expectedHead: sync.head('repo-a', doc.id) }, actor);
    expect(db.prepare('SELECT * FROM sync_intents').all()).toHaveLength(1);
    expect(() => sync.acceptManual('replica-b', 'remote', {})).toThrow('retiring');
    expect(() => sync.completeManual(manual.manualId)).toThrow('retiring');
    expect(() => service.createTransfer(intent, 1)).toThrow('retiring');
    const body = { sessionId: offer.sessionId, scopeHash: offer.scopeHash, stage: 'synced' as const, heads: offer.heads, appliedHeads: offer.heads };
    expect(() => sync.acceptReceipt(intent, offer, { ...body, checkpointHash: canonicalPeerHash(body) })).toThrow('retiring');
    const transferBody = { ...body, sessionId: transfer.sessionId, scopeHash: transfer.scopeHash };
    expect(() => sync.acceptTransferReceipt(intent, transfer, { ...transferBody, checkpointHash: canonicalPeerHash(transferBody) })).toThrow('retiring');
    sync.deferIntent(intent, 'retiring target');
    expect(db.prepare('SELECT state FROM sync_intents').get()).toEqual({ state: 'blocked' });
    expect(db.prepare('SELECT * FROM sync_outgoing_sessions').all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM sync_transfers WHERE direction = 'out'").all()).toHaveLength(1);
    expect(sync.version('repo-a', intent.frozenHead)).not.toBeNull();
    expect(sync.readyIntents('repo-a')).toEqual([]);
  });
  it('projects only matching managed governance digest and leaves bare setGroup digest absent', () => {
    const { sync, db } = fixture(false);
    expect(sync.localRepository()).toMatchObject({ groupId: null, rosterDigest: null });
    const empty = createTestDatabase(); new DesignDocStore(empty);
    expect(new DesignDocSyncStore(empty).localRepository()).toBeNull();
    const roster = createRoster('repo-a', 'group-a', [
      { replicaId: 'replica-a', machineId: 'machine-a', sponsorReplicaId: null, joinedAt: 1 },
      { replicaId: 'replica-b', machineId: 'machine-b', sponsorReplicaId: 'replica-a', joinedAt: 2 }
    ], 'genesis', 'replica-a');
    sync.setGroup('repo-a', 'group-a', roster.members);
    expect(sync.localRepository()).toHaveProperty('rosterDigest', null);
    db.prepare('UPDATE sync_group_control SET roster_json = ? WHERE singleton = 1').run(JSON.stringify(roster));
    expect(sync.localRepository()).toHaveProperty('rosterDigest', roster.digest);
    db.prepare('UPDATE sync_repositories SET group_id = ?').run('other-group');
    expect(sync.localRepository()).toHaveProperty('rosterDigest', null);
    db.prepare('UPDATE sync_repositories SET group_id = NULL').run();
    expect(sync.localRepository()).toHaveProperty('rosterDigest', null);
    db.prepare('UPDATE sync_repositories SET group_id = ?').run('group-a');
    db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify({ ...roster, repoId: 'other-repo' }));
    expect(sync.localRepository()).toHaveProperty('rosterDigest', null);
  });

  it('rejects stale persisted outgoing ACKs and chunks before rotation, then rotates same-epoch digest without draft capture', () => {
    const { sync, store, service, db } = fixture();
    const root = createRoster('repo-a', 'group-a', sync.members('repo-a'), 'genesis', 'replica-a');
    const left = transferSeat(root, 'replica-a', 'replica-b', 'left'), right = transferSeat(root, 'replica-b', 'replica-a', 'right');
    const govern = (roster: typeof root) => {
      db.prepare('UPDATE sync_group_control SET roster_json = ?').run(JSON.stringify(roster));
      db.prepare('UPDATE sync_repositories SET roster_epoch = ?').run(roster.rosterEpoch);
    };
    govern(left);
    const doc = store.create({ title: 'Digest rotation', status: 'approved', files: [{ path: 'README.md', content: 'frozen bytes' }] }, actor);
    const intent = sync.readyIntents('repo-a')[0]!, offer = service.createOffer(intent), transfer = service.createTransfer(intent, 1);
    expect(service.createOffer(intent)).toEqual(offer); expect(service.createTransfer(intent, 1)).toEqual(transfer);
    const blob = transfer.blobs.find((blob) => blob.bytes === 12)!;
    const chunk = sync.outgoingChunk(transfer, blob.hash, 0);
    const receipt = (scope: typeof transfer | typeof offer) => {
      const body = { sessionId: scope.sessionId, scopeHash: scope.scopeHash, stage: 'synced' as const, heads: scope.heads, appliedHeads: scope.heads };
      return { ...body, checkpointHash: canonicalPeerHash(body) };
    };
    store.writeFile(doc.id, { path: 'README.md', content: 'PRIVATE LATER' }, actor);
    govern(right);
    expect(left.rosterEpoch).toBe(right.rosterEpoch); expect(left.digest).not.toBe(right.digest);
    const restarted = new DesignDocSyncStore(db), resumed = new DesignDocPeerService(restarted);
    expect(() => restarted.acceptReceipt(intent, offer, receipt(offer))).toThrow('authorization');
    expect(() => restarted.acceptTransferReceipt(intent, transfer, receipt(transfer))).toThrow('authorization');
    expect(() => restarted.outgoingChunk(transfer, blob.hash, 0)).toThrow('authorization');
    expect(db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
    const rotatedOffer = resumed.createOffer(intent), rotated = resumed.createTransfer(intent, 1);
    for (const [prior, next] of [[offer, rotatedOffer], [transfer, rotated]] as const) {
      expect(next.sessionId).not.toBe(prior.sessionId); expect(next.scopeHash).not.toBe(prior.scopeHash);
      expect(next.rosterEpoch).toBe(prior.rosterEpoch); expect(next.rosterDigest).toBe(right.digest);
      expect(next.heads).toEqual(prior.heads); expect(next.versions).toEqual(prior.versions);
    }
    expect(rotatedOffer.versions[0]!.closure.files[0]!.content).toBe('frozen bytes');
    expect(rotated.blobs).toEqual(transfer.blobs);
    expect(restarted.outgoingChunk(rotated, blob.hash, 0).content).toBe(chunk.content);
    restarted.acceptReceipt(intent, rotatedOffer, receipt(rotatedOffer));
    restarted.acceptTransferReceipt(intent, rotated, receipt(rotated));
    expect(restarted.readyIntents('repo-a')).toEqual([]);
  });
  function fork(projectId: string | null = null, remoteProjectId: string | null = projectId, maxHistoryBytes?: number) {
    const state = fixture(true, maxHistoryBytes);
    const doc = state.store.create({ title: 'Merge', projectId, files: [{ path: 'README.md', content: 'one\ntwo\nthree' }] }, actor);
    const base = state.sync.head('repo-a', doc.id)!;
    const remote = structuredClone(state.sync.version('repo-a', base)!);
    remote.operation = { ...remote.operation, id: 'remote-head', replicaId: 'replica-b', sequence: 1, parents: [base] };
    remote.closure.files[0]!.content = 'one\ntwo\nTHREE';
    remote.closure.doc.project_id = remoteProjectId;
    remote.operation.payloadHash = canonicalPeerHash(remote.closure);
    state.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, actor);
    const body = { protocolVersion: 2, repoId: 'repo-a', senderReplicaId: 'replica-b', recipientReplicaId: 'replica-a',
      grantEpoch: 1, groupId: 'group-a', rosterEpoch: 1, sessionId: 'fork-session',
      versions: [state.sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    const offer = { ...body, scopeHash: createScopeHash(body) };
    expect(state.sync.apply(offer).stage).toBe('conflict');
    return { ...state, doc, base, remote, offer, localHead: state.sync.head('repo-a', doc.id)! };
  }

  it('resolves reviewed forks atomically with both parents and no synthetic milestone intent', () => {
    const { sync, store, db, doc, localHead, remote } = fork();
    const preview = sync.conflictCandidate(doc.id, remote.operation.id);
    expect(preview).toMatchObject({ localHead, remoteHead: remote.operation.id, conflicts: [] });
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor);
    expect(store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nTHREE');
    expect(sync.version('repo-a', resolved)!.operation).toMatchObject({ parents: [localHead, remote.operation.id].sort(), origin: 'maintenance' });
    expect(sync.version('repo-a', localHead)).not.toBeNull(); expect(sync.version('repo-a', remote.operation.id)).not.toBeNull();
    expect(db.prepare('SELECT * FROM sync_conflicts').all()).toEqual([]);
    expect(sync.readyIntents('repo-a')).toEqual([]);
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor)).toThrow(/head changed/);
  });

  it.each(['stale', 'quota', 'fault'] as const)('rejects %s resolution without dropping forks or changing domain', (failure) => {
    const { sync, store, db, doc, localHead, remote } = fork();
    if (failure === 'stale') store.writeFile(doc.id, { path: 'README.md', content: 'Newer private edit' }, actor);
    if (failure === 'quota') db.prepare('UPDATE sync_versions SET bytes = ?').run(MAX_PEER_STORED_BYTES);
    if (failure === 'fault') db.runScript("CREATE TRIGGER fail_resolution BEFORE INSERT ON sync_operations WHEN NEW.origin = 'maintenance' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    const before = store.get(doc.id), operations = sync.operations('repo-a'), conflicts = db.prepare('SELECT * FROM sync_conflicts').all();
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor)).toThrow();
    expect(store.get(doc.id)).toEqual(before); expect(sync.operations('repo-a')).toEqual(operations);
    expect(db.prepare('SELECT * FROM sync_conflicts').all()).toEqual(conflicts);
  });

  it('requires retained fork and unique common base; explicit selection can recover missing base', () => {
    const { sync, db, doc, localHead, remote, base } = fork();
    expect(() => sync.conflictCandidate(doc.id, 'unrelated')).toThrow(/fork/);
    db.prepare('DELETE FROM sync_versions WHERE head_id = ?').run(base);
    expect(sync.conflictCandidate(doc.id, remote.operation.id).conflicts).toContain('common ancestor unavailable');
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor)).toThrow(/common ancestor/);
    expect(sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'local' }, actor)).toEqual(expect.any(String));
  });

  it('paginates retained forks and previews one normalized file without exposing arbitrary versions', () => {
    const { sync, store, db, doc, localHead, remote } = fork();
    expect(sync.conflictReview(doc.id, remote.operation.id)).toMatchObject({ localHead, mergeAvailable: true,
      local: { paths: ['README.md'] }, remote: { paths: ['README.md'] } });
    expect(sync.conflictFile(doc.id, remote.operation.id, './README.md')).toMatchObject({ local: { content: 'ONE\ntwo\nthree' },
      remote: { content: 'one\ntwo\nTHREE' }, candidate: { content: 'ONE\ntwo\nTHREE' } });
    expect(sync.conflictFile(doc.id, remote.operation.id, 'absent.md')).toMatchObject({ local: null, remote: null, candidate: null });
    expect(() => sync.conflictFile(doc.id, remote.operation.id, '../secret')).toThrow();
    for (let n = 0; n < 25; n++) db.prepare('INSERT INTO sync_conflicts VALUES (?, ?, ?, ?)')
      .run('repo-a', doc.id, localHead, `fork-${String(n).padStart(2, '0')}`);
    const first = sync.conflicts(doc.id), second = sync.conflicts(doc.id, first.nextCursor!);
    expect(first.remoteHeads).toHaveLength(20); expect(second.remoteHeads).toHaveLength(6); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.remoteHeads, ...second.remoteHeads]).size).toBe(26);
    expect(store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nthree');
    expect(fixture(false).sync.conflicts('doc')).toEqual({ remoteHeads: [], nextCursor: null });
    expect(() => fixture(false).sync.conflictCandidate('doc', 'remote')).toThrow(/configured/);
    expect(() => fixture(false).sync.resolveConflict({ docId: 'doc', expectedHead: 'local', remoteHead: 'remote', choice: 'merge' }, actor)).toThrow(/configured/);
  });

  it('explicit peer selection uses ordinary remote status, preserves forks and rejects invalid choices/projection drift', () => {
    const { sync, store, db, doc, localHead, remote } = fork();
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'force' as never }, actor)).toThrow(/choice/);
    db.prepare('UPDATE doc_files SET content = ?, size = ? WHERE doc_id = ?').run('drift', 5, doc.id);
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'remote' }, actor)).toThrow(/projection changed/);
    db.prepare('UPDATE doc_files SET content = ?, size = ? WHERE doc_id = ?').run('ONE\ntwo\nthree', 13, doc.id);
    const head = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'remote' }, actor);
    expect(store.readFile(doc.id, 'README.md').content).toBe('one\ntwo\nTHREE');
    expect(sync.version('repo-a', head)!.operation.parents).toEqual([localHead, remote.operation.id].sort());
    expect(sync.readyIntents('repo-a')).toEqual([]);
  });

  it('new sessions offering an integrated ancestor cannot reopen resolved conflict or roll back projection', () => {
    const { sync, db, store, doc, offer, localHead, remote } = fork();
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor);
    const body = { ...offer, sessionId: 'retry-after-resolution' }, replay = { ...body, scopeHash: createScopeHash(body) };
    expect(sync.apply(replay)).toMatchObject({ stage: 'merged', heads: offer.heads, appliedHeads: { [doc.id]: resolved } });
    expect(sync.apply(offer).stage).toBe('conflict'); // Original receipt remains immutable.
    expect(sync.head('repo-a', doc.id)).toBe(resolved);
    expect(store.readFile(doc.id, 'README.md').content).toBe('ONE\ntwo\nTHREE');
    expect(db.prepare('SELECT * FROM sync_conflicts').all()).toEqual([]);
  });

  it('rejects corrupt immutable merge bases before proposing or committing any resolution', () => {
    const { sync, db, doc, base, localHead, remote } = fork();
    const row = db.prepare('SELECT closure_json FROM sync_versions WHERE head_id = ?').get(base) as { closure_json: string };
    const manifest = JSON.parse(row.closure_json); manifest.doc.summary = 'corrupt immutable base';
    db.prepare('UPDATE sync_versions SET closure_json = ? WHERE head_id = ?').run(JSON.stringify(manifest), base);
    expect(() => sync.conflictCandidate(doc.id, remote.operation.id)).toThrow(/hash mismatch/);
    expect(() => sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'merge' }, actor)).toThrow(/hash mismatch/);
    expect(sync.head('repo-a', doc.id)).toBe(localHead);
  });

  it.each(['local', 'remote'] as const)('retains both branches in normal restore history after %s selection', (choice) => {
    const { sync, store, db, doc, base, remote, offer } = fork();
    const remoteHistory = { ...remote.closure.history[0]!, sync_id: 'remote-history', content: 'Remote historical bytes', size: 23, revision: 2, op: 'write' as const };
    remote.closure.history.push(remoteHistory); remote.operation.payloadHash = canonicalPeerHash(remote.closure);
    // Replace fixture's already-received branch with a fresh, independently authored branch.
    remote.operation.id = 'history-remote'; remote.operation.sequence = 2; remote.operation.parents = [base];
    const body = { ...offer, sessionId: 'history-session', versions: [sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    const localHistory = store.history(doc.id).map((row) => row.id);
    sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice }, actor);
    for (const id of localHistory) expect(store.revisionContent(doc.id, id)).toBeTruthy();
    expect(store.history(doc.id).map((row) => store.revisionContent(doc.id, row.id).content)).toContain('Remote historical bytes');
    expect(db.prepare('SELECT * FROM sync_conflicts WHERE remote_head = ?').all(remote.operation.id)).toEqual([]);
  });

  it('local project changes and thread unlink after resolution replace provenance shadows', () => {
    const { sync, store, doc, remote } = fork();
    store.update(doc.id, { projectId: 'p1', expectedHead: sync.head('repo-a', doc.id) }, actor);
    store.linkThread(doc.id, 'thread-local', 'Local thread', 'editor');
    sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice: 'local' }, actor);
    store.update(doc.id, { projectId: 'p2', expectedHead: sync.head('repo-a', doc.id) }, actor);
    store.unlinkThread(doc.id, 'thread-local');
    sync.freezeManual();
    expect(sync.version('repo-a', sync.head('repo-a', doc.id)!)!.closure).toMatchObject({ doc: { project_id: 'p2' }, threads: [] });
  });

  it('explicit peer selection drops unchosen local association without granting foreign thread execution', () => {
    const { sync, store, doc, remote } = fork();
    store.linkThread(doc.id, 'thread-local', 'Local thread', 'editor');
    sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice: 'remote' }, actor);
    expect(store.get(doc.id).threads).toEqual([]);
  });

  it.each([
    { choice: 'merge', remoteProject: null, binding: null },
    { choice: 'remote', remoteProject: 'foreign', binding: null },
    { choice: 'local', remoteProject: 'foreign', binding: 'local-project' },
    { choice: 'remote', remoteProject: 'local-project', binding: 'local-project' }
  ] as const)('keeps only authorized existing project binding for $choice/$remoteProject', ({ choice, remoteProject, binding }) => {
    const { sync, store, doc, localHead, remote } = fork('local-project', remoteProject);
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice }, actor);
    expect(store.summary(doc.id).projectId).toBe(binding);
    expect(sync.version('repo-a', resolved)!.closure.doc.project_id).toBe(choice === 'local' ? 'local-project' : remoteProject);
    expect(() => sync.freezeManual()).not.toThrow();
  });

  it('journals logical project reset even when local binding already equals requested value', () => {
    const { sync, store, doc, localHead, remote } = fork('local-project', 'foreign');
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice: 'remote' }, actor);
    store.update(doc.id, { projectId: null, expectedHead: resolved }, actor);
    const reset = sync.head('repo-a', doc.id)!;
    expect(reset).not.toBe(resolved);
    expect(sync.version('repo-a', reset)!.closure.doc.project_id).toBeNull();
    store.update(doc.id, { projectId: null, expectedHead: reset }, actor);
    expect(sync.head('repo-a', doc.id)).toBe(reset);
    sync.freezeManual();
    expect(sync.head('repo-a', doc.id)).toBe(reset);
  });

  it.each(['merge', 'local', 'remote'] as const)('preserves reviewed causal history in %s resolution and restore UI', (choice) => {
    const { sync, store, doc, base, remote, offer } = fork();
    const shared = remote.closure.history[0]!;
    const older = { ...shared, sync_id: 'older-pruned-row', content: 'older', size: 5, created_at: shared.created_at + 100 };
    const newer = { ...shared, sync_id: 'remote-new-row', content: 'newer', size: 5, created_at: 0 };
    remote.closure.history = [older, shared, newer];
    remote.operation = { ...remote.operation, id: 'history-order-head', sequence: 2, payloadHash: canonicalPeerHash(remote.closure) };
    const body = { ...offer, sessionId: 'history-order-session', versions: [sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    const preview = sync.conflictCandidate(doc.id, remote.operation.id).candidate!;
    expect(preview.history[0]).toEqual(older);
    const head = sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice }, actor);
    const committed = sync.version('repo-a', head)!.closure.history;
    expect(committed).toEqual(preview.history);
    expect(store.history(doc.id).map((row) => store.revisionContent(doc.id, row.id).content)).toEqual(committed.map((row) => row.content).reverse());
    expect(store.history(doc.id, { path: 'README.md', limit: 1 })[0]!.id).toBe(store.history(doc.id)[0]!.id);
  });

  it('ancestor replay ignores comment collisions that no longer affect selected projection', () => {
    const { sync, store, db, doc, base, remote, offer } = fork();
    remote.closure.comments = [{ id: 'discarded-comment', path: null, quote: null, body: 'Remote comment', author: JSON.stringify(actor),
      status: 'open', created_at: 1, resolved_at: null, parent_id: null }];
    remote.operation = { ...remote.operation, id: 'comment-head', sequence: 2, payloadHash: canonicalPeerHash(remote.closure) };
    const body = { ...offer, sessionId: 'comment-session', versions: [sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice: 'local' }, actor);
    const other = store.create({ title: 'Other document', template: 'blank' }, actor);
    const comment = store.addComment(other.id, { body: 'Unrelated' }, actor);
    db.prepare('UPDATE doc_comments SET id = ? WHERE id = ?').run('discarded-comment', comment.id);
    const replay = { ...body, sessionId: 'comment-replay' };
    expect(sync.apply({ ...replay, scopeHash: createScopeHash(replay) })).toMatchObject({ stage: 'merged', appliedHeads: { [doc.id]: resolved } });
    expect(sync.conflicts(doc.id).remoteHeads).not.toContain(remote.operation.id);
    expect(store.get(doc.id).comments).toEqual([]);
  });

  it.each(['local', 'remote'] as const)('recovers conflicting historical linearizations with explicit %s choice', (choice) => {
    const { sync, store, doc, base, remote, offer } = fork();
    const localHead = sync.head('repo-a', doc.id)!, localHistory = sync.version('repo-a', localHead)!.closure.history;
    remote.closure.history = [...localHistory].reverse();
    remote.operation = { ...remote.operation, id: 'reversed-history', sequence: 2, payloadHash: canonicalPeerHash(remote.closure) };
    const body = { ...offer, sessionId: 'reversed-session', versions: [sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    expect(sync.conflictCandidate(doc.id, remote.operation.id).conflicts).toContain('history causal order conflict');
    const head = sync.resolveConflict({ docId: doc.id, expectedHead: localHead, remoteHead: remote.operation.id, choice }, actor);
    expect(sync.version('repo-a', head)!.closure.history).toEqual(choice === 'local' ? localHistory : remote.closure.history);
    expect(sync.conflicts(doc.id).remoteHeads).not.toContain(remote.operation.id);
    expect(store.history(doc.id)).toHaveLength(localHistory.length);
  });

  it('concurrent resolutions on opposite peers converge history order before exchange', () => {
    const a = fixture(), b = fixture();
    b.db.prepare("UPDATE sync_repositories SET replica_id = 'replica-b'").run();
    const doc = a.store.create({ title: 'Concurrent merge', files: [{ path: 'README.md', content: 'one\ntwo\nthree' }] }, actor);
    const exchange = (from: typeof a, to: typeof b, sessionId: string) => {
      const sender = from.sync.localRepository()!, recipient = to.sync.localRepository()!;
      const versions = new Map<string, NonNullable<ReturnType<DesignDocSyncStore['version']>>>();
      const visit = (head: string) => {
        if (versions.has(head)) return;
        const version = from.sync.version('repo-a', head)!;
        version.operation.parents.forEach(visit);
        versions.set(head, version);
      };
      visit(from.sync.head('repo-a', doc.id)!);
      const body = { protocolVersion: 2, repoId: 'repo-a', groupId: 'group-a', rosterEpoch: 1, grantEpoch: 1, sessionId,
        senderReplicaId: sender.replicaId, recipientReplicaId: recipient.replicaId,
        versions: [...versions.values()],
        heads: { [doc.id]: from.sync.head('repo-a', doc.id)! } };
      return to.sync.apply({ ...body, scopeHash: createScopeHash(body) });
    };
    expect(exchange(a, b, 'bootstrap').stage).toBe('synced');
    a.store.writeFile(doc.id, { path: 'README.md', content: 'ONE\ntwo\nthree' }, actor);
    b.store.writeFile(doc.id, { path: 'README.md', content: 'one\ntwo\nTHREE' }, actor);
    const aHead = a.sync.head('repo-a', doc.id)!, bHead = b.sync.head('repo-a', doc.id)!;
    expect(exchange(a, b, 'a-to-b').stage).toBe('conflict');
    expect(exchange(b, a, 'b-to-a').stage).toBe('conflict');
    const resolvedA = a.sync.resolveConflict({ docId: doc.id, expectedHead: aHead, remoteHead: bHead, choice: 'merge' }, actor);
    const resolvedB = b.sync.resolveConflict({ docId: doc.id, expectedHead: bHead, remoteHead: aHead, choice: 'merge' }, actor);
    expect(a.sync.version('repo-a', resolvedA)!.closure.history).toEqual(b.sync.version('repo-a', resolvedB)!.closure.history);
    expect(exchange(b, a, 'resolution-exchange').stage).toBe('conflict');
    expect(a.sync.conflictCandidate(doc.id, resolvedB).conflicts).toEqual(['common ancestor ambiguous']);
    expect(() => a.sync.resolveConflict({ docId: doc.id, expectedHead: resolvedA, remoteHead: resolvedB, choice: 'local' }, actor)).not.toThrow();
  });

  it.each(['rows', 'bytes'] as const)('prunes by causal order under %s cap after importing older snapshots', (cap) => {
    const { sync, store, doc, base, remote, offer } = fork(null, null, cap === 'bytes' ? 30 : undefined);
    const shared = remote.closure.history[0]!;
    remote.closure.history = [...Array.from({ length: MAX_TEXT_REVISIONS_PER_FILE }, (_, index) =>
      ({ ...shared, sync_id: `old-${index}`, content: `old-${index}`, size: Buffer.byteLength(`old-${index}`) })), shared];
    remote.operation = { ...remote.operation, id: 'pruning-head', sequence: 2, payloadHash: canonicalPeerHash(remote.closure) };
    const body = { ...offer, sessionId: 'pruning-session', versions: [sync.version('repo-a', base)!, remote], heads: { [doc.id]: remote.operation.id } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice: 'local' }, actor);
    store.writeFile(doc.id, { path: 'README.md', content: 'new' }, actor);
    const history = store.history(doc.id).map((row) => store.revisionContent(doc.id, row.id).content);
    expect(history.slice(0, 2)).toEqual(['new', 'ONE\ntwo\nthree']);
    expect(history).not.toContain('old-0');
    if (cap === 'rows') expect(history).toHaveLength(MAX_TEXT_REVISIONS_PER_FILE);
    else expect(history.reduce((sum, content) => sum + Buffer.byteLength(content), 0)).toBeLessThanOrEqual(30);
  });

  it('ancestor replay stays integrated even while another unrelated fork remains unresolved', () => {
    const { sync, db, doc, remote, offer, base } = fork();
    const sibling = structuredClone(remote); sibling.operation.id = 'sibling'; sibling.operation.sequence = 2;
    const body = { ...offer, sessionId: 'sibling-session', versions: [sync.version('repo-a', base)!, sibling], heads: { [doc.id]: 'sibling' } };
    sync.apply({ ...body, scopeHash: createScopeHash(body) });
    const resolved = sync.resolveConflict({ docId: doc.id, expectedHead: sync.head('repo-a', doc.id)!, remoteHead: remote.operation.id, choice: 'merge' }, actor);
    const replay = { ...offer, sessionId: 'integrated-with-other-fork' };
    expect(sync.apply({ ...replay, scopeHash: createScopeHash(replay) })).toMatchObject({ stage: 'merged', appliedHeads: { [doc.id]: resolved } });
    expect(db.prepare('SELECT remote_head FROM sync_conflicts').all()).toEqual([{ remote_head: 'sibling' }]);
  });

  it('upgrades old hash-only state without altering history or preserving false synced receipts', () => {
    const db = createTestDatabase();
    // Old state: every migration through the first peer-sync one, before hash-only intents were blocked.
    const firstSync = DESIGN_DOC_MIGRATIONS.findIndex((sql) => sql.includes('CREATE TABLE sync_repositories')) + 1;
    expect(firstSync).toBeGreaterThan(0);
    db.migrate(DESIGN_DOC_MIGRATIONS.slice(0, firstSync));
    db.prepare(`INSERT INTO docs (id, slug, title, created_at, updated_at, created_by, updated_by) VALUES ('old', 'old', 'Old', 1, 1, ?, ?)`)
      .run(JSON.stringify(actor), JSON.stringify(actor));
    db.runScript(`INSERT INTO sync_intents VALUES ('intent', 'repo', 'old', 'hash-only', 'remote', 'hash', 'synced', 1, 1);
      INSERT INTO sync_receipts VALUES ('repo', 'remote', 'hash-only', 'hash', 'synced', 1);`);
    db.migrate(DESIGN_DOC_MIGRATIONS.slice(firstSync));
    expect(db.prepare('SELECT title FROM docs WHERE id = ?').get('old')).toEqual({ title: 'Old' });
    expect(db.prepare('SELECT state FROM sync_intents').get()).toEqual({ state: 'blocked' });
    expect(db.prepare('SELECT * FROM sync_receipts').all()).toEqual([]);
  });
  it('retains initialized identity, rejects missing repositories and invalid roster', () => {
    const { sync } = fixture(false);
    expect(sync.initializeLocal()).toEqual({ repoId: 'repo-a', replicaId: 'replica-a' });
    expect(() => sync.setGroup('missing', 'group', [])).toThrow();
    expect(() => sync.recordOperation('missing', {} as never)).toThrow('not initialized');
    expect(() => sync.recordOperation('repo-a', {} as never)).toThrow('incomplete');
    expect(() => sync.createFrozenIntents('repo-a', 'doc', 'hash-only', 'scope')).toThrow('immutable');
  });

  it('pins full canonical closures with parents independently from mutable local rows', () => {
    const { store, sync } = fixture();
    const doc = store.create({ title: 'Frozen', status: 'approved', files: [{ path: 'README.md', content: 'old' }] }, actor);
    const head = sync.head('repo-a', doc.id)!;
    const frozen = sync.version('repo-a', head)!;
    expect(frozen.closure.files[0]!.content).toBe('old');
    store.writeFiles(doc.id, [{ path: 'README.md', content: 'new' }, { path: 'second.md', content: 'second' }], actor);
    const next = sync.head('repo-a', doc.id)!;
    expect(sync.operations('repo-a')).toHaveLength(2);
    expect(sync.version('repo-a', next)!.operation.parents).toEqual([head]);
    expect(sync.version('repo-a', head)).toEqual(frozen);
    expect(sync.readyIntents('repo-a')).toHaveLength(1);
    const before = sync.operations('repo-a');
    expect(() => store.writeFiles(doc.id, [{ path: 'README.md', content: 'rolled back' }, { path: '../bad', content: 'bad' }], actor)).toThrow();
    expect(sync.operations('repo-a')).toEqual(before);
    expect(store.readFile(doc.id, 'README.md').content).toBe('new');
  });

  it.each(['approved', 'implemented', 'archived'] as const)('captures exact %s transitions, never import/restore/no-op triggers', (status) => {
    const { store, sync } = fixture();
    const imported = store.create({ title: 'Import', status, template: 'blank' }, actor, 'import');
    expect(sync.operations('repo-a')[0]!.origin).toBe('import');
    expect(sync.readyIntents('repo-a')).toHaveLength(0);
    const doc = store.create({ title: 'Local', template: 'blank' }, actor);
    store.update(doc.id, { status, expectedHead: sync.head('repo-a', doc.id) }, actor);
    expect(sync.readyIntents('repo-a')).toHaveLength(1);
    const operations = sync.operations('repo-a').length;
    store.update(doc.id, { status, expectedHead: sync.head('repo-a', doc.id) }, actor);
    expect(sync.operations('repo-a')).toHaveLength(operations);
    store.writeFile(doc.id, { path: 'README.md', content: 'edit' }, actor);
    const oldRevision = store.history(doc.id).find((row) => row.op === 'create')!;
    store.restoreRevision(doc.id, oldRevision.id, actor);
    expect(sync.operations('repo-a').at(-1)!.origin).toBe('restore-undo');
    expect(sync.readyIntents('repo-a')).toHaveLength(1);
    expect(imported.status).toBe(status);
  });

  it('journals comment and persisted thread changes without milestone intents', () => {
    const { store, sync } = fixture();
    const doc = store.create({ title: 'Review', template: 'blank' }, actor);
    const comment = store.addComment(doc.id, { body: 'review' }, actor);
    store.addReply(doc.id, comment.id, 'reply', actor);
    store.setCommentStatus(doc.id, comment.id, 'resolved', actor);
    store.linkThread(doc.id, 'thread-1', 'thread', 'editor');
    store.touchThread('thread-1', 'new title');
    store.unlinkThread(doc.id, 'thread-1');
    store.linkThread(doc.id, 'thread-2', 'thread', 'editor');
    store.forgetThread('thread-2');
    store.deleteComment(doc.id, comment.id, actor);
    expect(sync.operations('repo-a')).toHaveLength(10);
    expect(sync.version('repo-a', sync.head('repo-a', doc.id)!)!.closure).toMatchObject({ comments: [], threads: [] });
    expect(sync.readyIntents('repo-a')).toEqual([]);
  });

  it('pages operations with a frozen frontier: no truncation, no later-write leakage, bad cursors rejected', () => {
    const { store, sync } = fixture();
    const doc = store.create({ title: 'Paged', template: 'blank' }, actor);
    for (let i = 0; i < 6; i++) store.writeFile(doc.id, { path: 'README.md', content: `v${i}` }, actor);
    const all = sync.operations('repo-a');
    expect(all).toHaveLength(7);
    const first = sync.operationsPage('repo-a', { limit: 3 });
    expect(first.operations).toEqual(all.slice(0, 3));
    expect(first.next).not.toBeNull();
    store.writeFile(doc.id, { path: 'README.md', content: 'after-freeze' }, actor);
    const collected = [...first.operations];
    for (let page = first.next; page;) {
      const result = sync.operationsPage('repo-a', { limit: 3, cursor: page });
      collected.push(...result.operations);
      page = result.next;
    }
    expect(collected).toEqual(all);
    expect(sync.operations('repo-a')).toHaveLength(8);
    expect(sync.operationsPage('repo-a', { limit: 100 }).next).toBeNull();
    expect(sync.operationsPage('repo-a', { limit: 0 }).operations).toHaveLength(1);
    const bad = [{ afterReplicaId: 1, afterSequence: 0, upper: {} }, { afterReplicaId: 'r', afterSequence: -1, upper: {} },
      { afterReplicaId: 'r', afterSequence: 0, upper: null }, { afterReplicaId: 'r', afterSequence: 0, upper: { r: 1.5 } },
      { afterReplicaId: 'r', afterSequence: 0, upper: { '': 1 } }];
    for (const cursor of bad) expect(() => sync.operationsPage('repo-a', { cursor: cursor as never })).toThrow('operation cursor is invalid');
  });

  it('records paired deletion as a scrubbed tombstone head; archive and unpaired deletion stay legal', () => {
    const paired = fixture(), unpaired = fixture(false);
    const archived = paired.store.create({ title: 'Archive me', template: 'blank' }, actor);
    paired.store.update(archived.id, { status: 'archived', expectedHead: paired.sync.head('repo-a', archived.id) }, actor);
    expect(paired.store.find(archived.id)!.status).toBe('archived');
    const doc = paired.store.create({ title: 'Secret title', status: 'approved', template: 'blank' }, actor);
    paired.store.addComment(doc.id, { body: 'private note' }, actor);
    const before = paired.sync.head('repo-a', doc.id)!;
    paired.store.remove(doc.id, actor);
    expect(paired.store.find(doc.id)).toBeNull();
    const head = paired.sync.head('repo-a', doc.id)!;
    const tombstone = paired.sync.version('repo-a', head)!;
    expect(tombstone.operation).toMatchObject({ kind: 'delete', parents: [before], origin: 'local-authoring' });
    expect(tombstone.closure).toMatchObject({ files: [], history: [], comments: [], threads: [], deleted: { by: JSON.stringify(actor) } });
    expect(JSON.stringify(tombstone.closure)).not.toContain('Secret title');
    expect(JSON.stringify(tombstone.closure)).not.toContain('private note');
    expect(paired.sync.readyIntents('repo-a').filter((intent) => intent.docId === doc.id).map((intent) => intent.frozenHead)).toEqual([head]);
    for (const table of ['doc_files', 'doc_revisions', 'doc_comments', 'doc_threads', 'sync_doc_references', 'sync_history_order']) {
      expect(paired.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE doc_id = ?`).get(doc.id)).toEqual({ n: 0 });
    }
    // Re-recording the delete is idempotent: the head is already a tombstone.
    paired.sync.recordLocalMutation({ docId: doc.id, kind: 'delete-doc', payload: { actor } });
    expect(paired.sync.head('repo-a', doc.id)).toBe(head);
    expect(() => paired.sync.recordLocalMutation({ docId: archived.id, kind: 'delete-doc', payload: { actor } })).toThrow();
    const local = unpaired.store.create({ title: 'Local', template: 'blank' }, actor);
    unpaired.store.remove(local.id);
    expect(unpaired.store.find(local.id)).toBeNull();
    expect(unpaired.sync.head('repo-a', local.id)).toBeNull();
  });

  it('rejects op and sequence substitution; transactional bulk insertion rolls back', () => {
    const { sync, store } = fixture();
    store.create({ title: 'Ops', template: 'blank' }, actor);
    const op = sync.operations('repo-a')[0]!;
    sync.recordOperation('repo-a', op);
    expect(() => sync.recordOperation('repo-a', { ...op, payloadHash: 'f'.repeat(64) })).toThrow('payload mismatch');
    expect(() => sync.recordOperation('repo-a', { ...op, id: 'other' })).toThrow('sequence');
    expect(() => sync.recordOperation('repo-a', { ...op, id: 'other', sequence: 0 })).toThrow('sequence');
    expect(() => sync.recordOperations('repo-a', [{ ...op, id: 'new', sequence: 2 }, { ...op, kind: 'changed' }])).toThrow();
    expect(sync.operations('repo-a')).toHaveLength(1);
  });

  it('reserves durable capacity atomically and never deletes unsent state to fit', () => {
    for (const cap of ['bytes', 'versions', 'intents']) {
      const { db, sync, store } = fixture();
      const doc = store.create({ title: 'Cap', template: 'blank' }, actor);
      const frozen = sync.head('repo-a', doc.id)!;
      if (cap === 'bytes') db.prepare('UPDATE sync_versions SET bytes = ?').run(MAX_PEER_STORED_BYTES);
      if (cap === 'versions') db.runScript(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ${MAX_PEER_STORED_VERSIONS - 1})
        INSERT INTO sync_versions (repo_id, head_id, doc_id, payload_hash, closure_json, bytes) SELECT 'repo-a', 'fake-' || x, 'doc', 'hash', '{}', 0 FROM n;`);
      if (cap === 'intents') db.runScript(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ${MAX_PENDING_PEER_INTENTS})
        INSERT INTO sync_intents SELECT 'intent-' || x, 'repo-a', 'doc', 'head-' || x, 'replica-b', 'scope', 'pending', 1, 1 FROM n;`);
      expect(() => store.update(doc.id, { status: 'approved', expectedHead: sync.head('repo-a', doc.id) }, actor)).toThrow(/capacity/);
      expect(store.summary(doc.id).status).toBe('draft');
      expect(sync.head('repo-a', doc.id)).toBe(frozen);
      expect(sync.operations('repo-a')).toHaveLength(1);
    }
  });

  it('freezes manual consent and durable sessions without duplicate intents', () => {
    const { sync, store, service } = fixture();
    const doc = store.create({ title: 'Manual', template: 'blank' }, actor);
    const intents = sync.freezeManual();
    sync.freezeManual();
    expect(sync.readyIntents('repo-a')).toHaveLength(1);
    const offer = service.createOffer(intents[0]!);
    expect(service.createOffer(intents[0]!)).toEqual(offer);
    const forged = { sessionId: offer.sessionId, scopeHash: offer.scopeHash, stage: 'synced', heads: offer.heads, appliedHeads: {}, checkpointHash: 'f'.repeat(64) };
    expect(() => sync.acceptReceipt(intents[0]!, offer, forged as never)).toThrow();
    expect(sync.readyIntents('repo-a')[0]!.docId).toBe(doc.id);
  });

  it('fences roster and immutable history substitutions before any domain commit', () => {
    const { sync, store, service, db } = fixture();
    expect(() => sync.setGroup('repo-a', 'group-a', ['b', 'c'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, joinedAt: 1, sponsorReplicaId: null })))).toThrow('local replica');
    const doc = store.create({ title: 'History', status: 'approved', template: 'blank' }, actor);
    const intent = sync.readyIntents('repo-a')[0]!;
    service.createOffer(intent);
    db.prepare('UPDATE sync_history_projections SET payload_hash = ?').run('f'.repeat(64));
    expect(() => store.writeFile(doc.id, { path: 'README.md', content: 'new' }, actor)).toThrow('history identity');
    expect(store.readFile(doc.id, 'README.md').content).not.toBe('new');
    sync.setGroup('repo-a', 'group-a', [
      { replicaId: 'replica-a', machineId: 'machine-a', sponsorReplicaId: null, joinedAt: 1 },
      { replicaId: 'replica-b', machineId: 'machine-b', sponsorReplicaId: null, joinedAt: 1 }
    ]);
    expect(service.createOffer(intent).rosterEpoch).toBe(2);
  });

  it('pins bounded outgoing chunks and fences receipt/staging misuse', () => {
    const { sync, store, service, db } = fixture();
    store.create({ title: 'Chunks', status: 'approved', template: 'blank' }, actor);
    const intent = sync.readyIntents('repo-a')[0]!, transfer = service.createTransfer(intent, 7);
    expect(service.createTransfer(intent, 7)).toEqual(transfer);
    const rotated = service.createTransfer(intent, 8);
    expect(rotated.sessionId).not.toBe(transfer.sessionId);
    expect(rotated.heads).toEqual(transfer.heads);
    expect(rotated.versions).toEqual(transfer.versions);
    expect(rotated.blobs).toEqual(transfer.blobs);
    expect(() => sync.outgoingChunk(transfer, 'f'.repeat(64), 0)).toThrow('missing');
    const receiptBody = { sessionId: transfer.sessionId, scopeHash: transfer.scopeHash, stage: 'synced' as const,
      heads: transfer.heads, appliedHeads: transfer.heads };
    const receipt = { ...receiptBody, checkpointHash: canonicalPeerHash(receiptBody) };
    expect(() => sync.acceptTransferReceipt({ ...intent, frozenHead: 'wrong' }, transfer, receipt)).toThrow('matching');
    expect(() => sync.stageChunk({ ...transferQuery(transfer), blobHash: 'f'.repeat(64), index: 0,
      chunkHash: 'f'.repeat(64), content: '' }, Buffer.alloc(0))).toThrow('no authorized transfer');
    expect(() => sync.applyTransfer(transferQuery(transfer))).toThrow('authorization changed');
    db.prepare("DELETE FROM sync_transfers WHERE direction = 'out'").run();
    expect(() => sync.acceptTransferReceipt(intent, transfer, receipt)).toThrow('matching');
  });
});
