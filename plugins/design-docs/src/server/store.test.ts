import { describe, expect, it } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import {
  LARGE_TEXT_FILE_BYTES,
  MAX_COMMENTS_PER_DOC,
  MAX_FILES_PER_DOC,
  MAX_LARGE_TEXT_REVISIONS_PER_FILE,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_REVISIONS_PER_FILE,
  MAX_THREAD_LINKS_PER_DOC
} from '../shared/limits.js';
import { formatBytes } from '../shared/display.js';
import { AGENT_FALLBACK_LABEL, DesignDocError, DesignDocStore, applyEdits, repairLegacyPeerSyncMigrationIndexes, slugify } from './store.js';
import { createTestDatabase } from './test-db.js';
import { DesignDocSyncStore } from './sync-store.js';
import { MAX_PEER_STORED_BYTES, MAX_PEER_STORED_VERSIONS } from '../shared/peer-limits.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };
const agent: DocActor = { kind: 'agent', label: 'Planner', threadId: 'thread-1' };

describe('DesignDocStore legacy migration repair', () => {
  const hashes = [
    '0e5d810d8f1a4bb65a824698f308f5974bc08a3a9da2fade6f420b7fae1523a4',
    '1772c965b891ad3733a7a09f309a446618ddf2cdfb8d1ce110a2c0931f1d9452',
    'aa5f8a86522e9269645d9cb75152b25ac056de47ec4a51b7c275e8fff2340847',
    '18dcdf7f9c7f9f11aba3cf208e1762756c22ba77200ad996ac66bd3141a0e2af',
    '3c30314de2fbe9d7cb7636a36bec1932e966921f3ab14d7280fac45261d590a5',
    'c3fbd92f3bde8ad54b4e9cda5c900ec160f595855e7916c62fba72e74bfa69a0',
    'e83e0a9271c8ff8868d43ec06cb9d40dd360fa1da2d6f7dabe2227ce8ec914a5'
  ];

  function legacyDatabase() {
    const db = createTestDatabase();
    db.runScript('CREATE TABLE _zcc_migrations (id INTEGER PRIMARY KEY, statement_hash TEXT, applied_at INTEGER NOT NULL)');
    const insert = db.prepare('INSERT INTO _zcc_migrations VALUES (?, ?, ?)');
    insert.run(0, 'docs', 100); insert.run(1, 'comments', 101);
    hashes.forEach((hash, index) => insert.run(index + 2, hash, index + 102));
    return db;
  }

  it('shifts only the exact complete legacy lineage once, preserving migration evidence', () => {
    const db = legacyDatabase();
    const before = db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all() as Array<{ id: number; statement_hash: string; applied_at: number }>;
    repairLegacyPeerSyncMigrationIndexes(db);
    const shifted = before.map((row) => ({ ...row, id: row.id < 2 ? row.id : row.id + 1 }));
    expect(db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all()).toEqual(shifted);
    repairLegacyPeerSyncMigrationIndexes(db);
    expect(db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all()).toEqual(shifted);
  });

  it.each(['hash', 'null', 'missing', 'extra', 'gap'])('leaves nonmatching %s lineage untouched', (mode) => {
    const db = legacyDatabase();
    if (mode === 'hash') db.prepare('UPDATE _zcc_migrations SET statement_hash = ? WHERE id = 4').run('different');
    if (mode === 'null') db.prepare('UPDATE _zcc_migrations SET statement_hash = NULL WHERE id = 4').run();
    if (mode === 'missing') db.prepare('DELETE FROM _zcc_migrations WHERE id = 8').run();
    if (mode === 'extra') db.prepare('INSERT INTO _zcc_migrations VALUES (9, ?, 109)').run('extra');
    if (mode === 'gap') db.prepare('UPDATE _zcc_migrations SET id = 9 WHERE id = 8').run();
    const before = db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all();
    repairLegacyPeerSyncMigrationIndexes(db);
    expect(db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all()).toEqual(before);
  });

  it('rolls back the whole shift if a migration-book update fails', () => {
    const db = legacyDatabase();
    db.runScript("CREATE TRIGGER fail_shift BEFORE UPDATE ON _zcc_migrations WHEN OLD.id = 4 BEGIN SELECT RAISE(ABORT, 'shift failed'); END");
    const before = db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all();
    expect(() => repairLegacyPeerSyncMigrationIndexes(db)).toThrow('shift failed');
    expect(db.prepare('SELECT * FROM _zcc_migrations ORDER BY id').all()).toEqual(before);
  });
});

describe('DesignDocStore peer mutation boundary', () => {
  it.each([{ status: 'approved' as const }, { title: 'Stale' }, { tags: ['stale'] }, { entryPath: 'other.md' }])(
    'rejects stale paired metadata %j without journal or intents', (patch) => {
      const db = createTestDatabase();
      let sync!: DesignDocSyncStore;
      const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
      sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
      sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
      const doc = store.create({ title: 'Reviewed', files: [{ path: 'README.md', content: 'reviewed' }, { path: 'other.md', content: 'other' }] }, user);
      const expectedHead = sync.head('repo', doc.id)!;
      store.writeFile(doc.id, { path: 'README.md', content: 'unreviewed replacement' }, agent);
      const before = store.get(doc.id), operations = sync.operations('repo');
      expectError(() => store.update(doc.id, { ...patch, expectedHead }, user), 'conflict', /head/);
      expectError(() => store.update(doc.id, patch, user), 'conflict', /expectedHead/);
      expect(store.get(doc.id)).toEqual(before);
      expect(sync.operations('repo')).toEqual(operations);
      expect(sync.readyIntents('repo')).toEqual([]);
      store.update(doc.id, { ...patch, expectedHead: sync.head('repo', doc.id) }, user);
      expect(sync.operations('repo')).toHaveLength(operations.length + 1);
      expect(sync.readyIntents('repo')).toHaveLength('status' in patch ? 1 : 0);
    }
  );

  it.each([undefined, 'README.md'])('journals nested imports with entry %s and no autosync', (entry) => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const doc = store.create({ title: 'Import', template: 'blank' }, user);
    const before = sync.operations('repo').length;
    store.importFiles(doc.id, [{ path: 'README.md', content: 'imported' }], user, entry);
    expect(sync.operations('repo')).toHaveLength(before + 1);
    const op = sync.operations('repo').at(-1)!;
    expect(op.origin).toBe('import');
    expect(sync.version('repo', op.id)!.closure.files[0]!.content).toBe('imported');
    expect(sync.readyIntents('repo')).toEqual([]);
  });

  it('captures imported creation and its thread link as one complete import', () => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const doc = store.createImported({ title: 'Imported', status: 'approved', template: 'blank' }, user, { id: 'import-thread', title: 'Importer' });
    expect(doc.threads).toEqual([expect.objectContaining({ threadId: 'import-thread', title: 'Importer', role: 'assistant' })]);
    const operations = sync.operations('repo');
    expect(operations).toHaveLength(1);
    expect(operations[0]!.origin).toBe('import');
    expect(sync.version('repo', sync.head('repo', doc.id)!)!.closure.threads).toHaveLength(1);
    expect(sync.readyIntents('repo')).toEqual([]);
  });

  it('imports multiple files and entry metadata atomically with one mutation', () => {
    const db = createTestDatabase();
    const mutations: unknown[] = [];
    const store = new DesignDocStore(db, { onMutation: (mutation) => mutations.push(mutation) });
    const doc = store.create({ title: 'Import', template: 'blank' }, user);
    store.importFiles(doc.id, [{ path: 'README.md', content: 'new readme' }, { path: 'entry.md', content: 'new entry' }], user, 'entry.md');
    expect(mutations).toHaveLength(2);
    expect(mutations[1]).toMatchObject({ docId: doc.id, kind: 'update', origin: 'import' });
    expect(store.summary(doc.id).entryPath).toBe('entry.md');
    const before = store.get(doc.id), files = store.readAllFiles(doc.id), history = store.history(doc.id);
    expectError(() => store.importFiles(doc.id, [{ path: 'README.md', content: 'rollback' }], user, 'absent.md'), 'invalid', /entryPath/);
    expect(store.get(doc.id)).toEqual(before);
    expect(store.readAllFiles(doc.id)).toEqual(files);
    expect(store.history(doc.id)).toEqual(history);
    expect(mutations).toHaveLength(2);
    store.writeFile(doc.id, { path: 'README.md', content: 'local again' }, user);
    expect(mutations[2]).toMatchObject({ origin: 'local-authoring' });
  });

  it.each(['update', 'write', 'createImported'])('rolls back %s when mutation capture fails', (mode) => {
    const db = createTestDatabase();
    let fail = false;
    const mutations: unknown[] = [];
    const store = new DesignDocStore(db, { onMutation: (mutation) => {
      if (fail) throw new Error('capture failed');
      mutations.push(mutation);
    } });
    const doc = store.create({ title: 'Keep', template: 'blank' }, user);
    const before = store.get(doc.id), files = store.readAllFiles(doc.id), history = store.history(doc.id);
    fail = true;
    expect(() => {
      if (mode === 'update') store.update(doc.id, { title: 'Rollback', status: 'approved' }, agent);
      else if (mode === 'write') store.writeFile(doc.id, { path: 'README.md', content: 'rollback' }, agent);
      else store.createImported({ title: 'Rollback', template: 'blank' }, user, { id: 'import-thread', title: 'Importer' });
    }).toThrow('capture failed');
    expect(store.list()).toEqual([expect.objectContaining({ id: doc.id })]);
    expect(store.get(doc.id)).toEqual(before);
    expect(store.readAllFiles(doc.id)).toEqual(files);
    expect(store.history(doc.id)).toEqual(history);
    expect(db.prepare('SELECT * FROM doc_threads').all()).toEqual([]);
    fail = false;
    store.update(doc.id, { summary: 'Recovered' }, user);
    expect(mutations).toHaveLength(2);
    expect(mutations[1]).toMatchObject({ docId: doc.id, origin: 'local-authoring' });
  });

  it('rolls back nested imports when capture fails and discards failed child mutations', () => {
    const db = createTestDatabase();
    let fail = false;
    const mutations: unknown[] = [];
    const store = new DesignDocStore(db, { onMutation: (mutation) => {
      if (fail) throw new Error('capture quota exhausted');
      mutations.push(mutation);
    } });
    const doc = store.create({ title: 'Import', template: 'blank' }, user);
    const before = store.get(doc.id), history = store.history(doc.id), file = store.readFile(doc.id, 'README.md');
    fail = true;
    expect(() => store.importFiles(doc.id, [{ path: 'README.md', content: 'rollback' }], user)).toThrow('capture quota exhausted');
    expect(store.get(doc.id)).toEqual(before);
    expect(store.history(doc.id)).toEqual(history);
    expect(store.readFile(doc.id, 'README.md')).toEqual(file);
    fail = false;
    expect(() => store.importFiles(doc.id, [{ path: 'README.md', content: 'failed child' }, { path: '../bad.md', content: '' }], user)).toThrow();
    store.importFiles(doc.id, [{ path: 'README.md', content: file.content }], user);
    expect(mutations).toHaveLength(1);
    store.importFiles(doc.id, [{ path: 'README.md', content: 'success' }], user);
    expect(mutations).toHaveLength(2);
  });

  it.each(['bytes', 'versions'])('rolls back imported domain and journal state at %s quota', (cap) => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const doc = store.create({ title: 'Quota', template: 'blank' }, user);
    if (cap === 'bytes') db.prepare('UPDATE sync_versions SET bytes = ?').run(MAX_PEER_STORED_BYTES);
    else db.runScript(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x < ${MAX_PEER_STORED_VERSIONS - 1})
      INSERT INTO sync_versions SELECT 'repo', 'fake-' || x, 'doc', 'hash', '{}', 0, 0 FROM n;`);
    const before = store.get(doc.id), files = store.readAllFiles(doc.id), history = store.history(doc.id);
    const operations = sync.operations('repo');
    expect(() => store.importFiles(doc.id, [{ path: 'README.md', content: 'quota failure' }], user)).toThrow(/capacity/);
    expect(store.get(doc.id)).toEqual(before);
    expect(store.readAllFiles(doc.id)).toEqual(files);
    expect(store.history(doc.id)).toEqual(history);
    expect(sync.operations('repo')).toEqual(operations);
    expect(sync.readyIntents('repo')).toEqual([]);
  });

  it('keeps unpaired metadata CAS optional, validates explicit heads, and requires paired no-head assertion', () => {
    const db = createTestDatabase();
    const store = new DesignDocStore(db);
    const doc = store.create({ title: 'Unpaired', template: 'blank' }, user);
    expect(doc.head).toBeNull();
    store.update(doc.id, { title: 'Optional' }, user);
    store.update(doc.id, { title: 'Explicit null', expectedHead: null }, user);
    expectError(() => store.update(doc.id, { title: 'Bad', expectedHead: '' }, user), 'invalid', /non-empty/);
    expectError(() => store.update(doc.id, { title: 'Stale', expectedHead: 'missing' }, user), 'conflict', /head/);
    const sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    expectError(() => store.update(doc.id, { title: 'No head' }, user), 'conflict', /expectedHead/);
    // Local-only navigation and empty patches replicate nothing, so they need no peer head.
    const other = store.create({ title: 'Other', template: 'blank' }, user);
    expect(store.update(doc.id, {}, user).title).toBe('Explicit null');
    expect(store.update(doc.id, { alternativeTo: other.id }, user).alternativeTo).toBe(other.id);
    expectError(() => store.update(doc.id, { alternativeTo: null, title: 'x' }, user), 'conflict', /expectedHead/);
    expect(store.update(doc.id, { title: 'Paired null', expectedHead: null }, user).title).toBe('Paired null');
  });

  it('re-reads expected head inside the transaction, not from the pre-transaction lookup', () => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const doc = store.create({ title: 'Transaction CAS', template: 'blank' }, user);
    const expectedHead = store.summary(doc.id).head;
    const transaction = db.transaction.bind(db);
    let replace = true;
    db.transaction = (fn) => {
      if (replace) {
        replace = false;
        store.writeFile(doc.id, { path: 'README.md', content: 'replacement before lock' }, user);
      }
      return transaction(fn);
    };
    expectError(() => store.update(doc.id, { status: 'approved', expectedHead }, user), 'conflict', /head changed/);
    expect(store.summary(doc.id).status).toBe('draft');
    expect(store.readFile(doc.id, 'README.md').content).toBe('replacement before lock');
    expect(sync.operations('repo')).toHaveLength(2);
    expect(sync.readyIntents('repo')).toEqual([]);
  });

  it.each(['write', 'edit', 'delete', 'rename', 'restore'])('rejects ABA replacement for %s even when revision repeats', (mode) => {
    const db = createTestDatabase();
    const mutations: unknown[] = [];
    const store = new DesignDocStore(db, { onMutation: (mutation) => mutations.push(mutation) });
    const doc = store.create({ title: 'ABA', files: [{ path: 'README.md', content: 'reviewed' }, { path: 'other.md', content: 'other' }] }, user);
    const file = store.readFile(doc.id, 'README.md'), revision = store.history(doc.id).find((row) => row.path === file.path)!;
    // Simulate a peer projection replacing a path while its local counter repeats.
    db.prepare('UPDATE doc_files SET sync_id = ?, content = ? WHERE doc_id = ? AND path = ?').run('replacement-id', 'unreviewed', doc.id, file.path);
    const options = { baseRevision: file.revision, baseFileId: file.fileId };
    const before = store.get(doc.id), history = store.history(doc.id), count = mutations.length;
    const mutate = () => {
      if (mode === 'write') return store.writeFile(doc.id, { path: file.path, content: 'stale', ...options }, user);
      if (mode === 'edit') return store.editFile(doc.id, { path: file.path, edits: [{ oldText: 'unreviewed', newText: 'stale' }], ...options }, user);
      if (mode === 'delete') return store.deleteFile(doc.id, file.path, user, options);
      if (mode === 'rename') return store.renameFile(doc.id, file.path, 'moved.md', user, options);
      return store.restoreRevision(doc.id, revision.id, user, options);
    };
    expectError(mutate, 'conflict', /identity changed/);
    expect(store.get(doc.id)).toEqual(before);
    expect(store.history(doc.id)).toEqual(history);
    expect(store.readFile(doc.id, file.path).content).toBe('unreviewed');
    expect(mutations).toHaveLength(count);
  });

  it('exposes stable file ids, preserves rename identity, and fences recreation without history', () => {
    const db = createTestDatabase();
    const store = new DesignDocStore(db);
    const doc = store.create({ title: 'Identity', files: [{ path: 'README.md', content: 'one' }, { path: 'other.md', content: 'two' }] }, user);
    const original = store.readFile(doc.id, 'other.md');
    expect(doc.files.find((file) => file.path === original.path)!.fileId).toBe(original.fileId);
    expect(store.readAllFiles(doc.id).find((file) => file.path === original.path)!.fileId).toBe(original.fileId);
    const moved = store.renameFile(doc.id, original.path, 'moved.md', user, { baseFileId: original.fileId, baseRevision: original.revision });
    expect(moved.fileId).toBe(original.fileId);
    store.deleteFile(doc.id, moved.path, user, { baseFileId: moved.fileId });
    db.prepare('DELETE FROM doc_revisions WHERE doc_id = ? AND path = ?').run(doc.id, moved.path);
    const recreated = store.writeFile(doc.id, { path: moved.path, content: 'new', baseRevision: 0, baseFileId: null }, user);
    expect(recreated.revision).toBe(moved.revision);
    expect(recreated.fileId).not.toBe(moved.fileId);
    expectError(() => store.writeFile(doc.id, { path: moved.path, content: 'stale', baseRevision: moved.revision, baseFileId: moved.fileId }, user), 'conflict', /identity/);
    expectError(() => store.writeFile(doc.id, { path: moved.path, content: 'bad', baseFileId: '' }, user), 'invalid', /non-empty/);
    expectError(() => store.writeFile(doc.id, { path: 'absent.md', content: 'bad', baseFileId: moved.fileId }, user), 'conflict', /identity/);
    expect(store.writeFile(doc.id, { path: moved.path, content: 'fresh', baseRevision: recreated.revision, baseFileId: recreated.fileId }, user).fileId).toBe(recreated.fileId);
  });

  it('blocks paired removal without a sync observer and rolls back failed capture', () => {
    const db = createTestDatabase();
    const store = new DesignDocStore(db);
    const sync = new DesignDocSyncStore(db);
    sync.initialize('repo', 'replica-a');
    expect(store.isPaired()).toBe(false);
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    expect(store.isPaired()).toBe(true);
    const doc = store.create({ title: 'Keep', template: 'blank' }, user);
    expectError(() => store.remove(doc.id), 'conflict', /sync capture is unavailable/);
    expect(store.find(doc.id)).not.toBeNull();
    const failing = createTestDatabase();
    const capture = new DesignDocStore(failing, { onMutation: (mutation) => { if (mutation.kind === 'delete-doc') throw new Error('tombstone failed'); } });
    const failingSync = new DesignDocSyncStore(failing); failingSync.initialize('repo', 'replica-a');
    failingSync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const kept = capture.create({ title: 'Kept on failure', template: 'blank' }, agent);
    capture.addComment(kept.id, { body: 'Keep comment' }, user);
    const before = capture.get(kept.id), files = capture.readAllFiles(kept.id), history = capture.history(kept.id);
    expect(() => capture.remove(kept.id)).toThrow('tombstone failed');
    expect(capture.get(kept.id)).toEqual(before);
    expect(capture.readAllFiles(kept.id)).toEqual(files);
    expect(capture.history(kept.id)).toEqual(history);
    const other = createTestDatabase();
    const observed = new DesignDocStore(other, { onMutation: () => { throw new Error('capture failed'); } });
    expect(() => observed.create({ title: 'Rollback', status: 'approved', template: 'blank' }, user)).toThrow('capture failed');
    expect(observed.list()).toEqual([]);
    expect(other.prepare('SELECT * FROM doc_files').all()).toEqual([]);
    expect(other.prepare('SELECT * FROM doc_revisions').all()).toEqual([]);
  });

  it('deletes paired doc dependents and records a scrubbed tombstone in the same transaction', () => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const doc = store.create({ title: 'Private title', status: 'approved', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'private comment' }, user);
    const alternative = store.create({ title: 'Alternative', template: 'blank' }, user);
    store.update(alternative.id, { alternativeTo: doc.id }, user);
    db.prepare('INSERT INTO sync_doc_references VALUES (?, ?, ?)').run(doc.id, 'null', '[]');
    db.prepare('INSERT INTO sync_history_order VALUES (?, ?, ?)').run(doc.id, 'history', 1);
    const head = store.summary(doc.id).head;
    store.remove(doc.id, agent);
    expect(store.find(doc.id)).toBeNull();
    expect(store.summary(alternative.id).alternativeTo).toBeNull();
    for (const table of ['doc_files', 'doc_revisions', 'doc_comments', 'doc_threads', 'sync_doc_references', 'sync_history_order']) {
      expect(db.prepare(`SELECT * FROM ${table} WHERE doc_id = ?`).all(doc.id)).toEqual([]);
    }
    const tombstone = sync.version('repo', sync.head('repo', doc.id)!)!;
    expect(tombstone.operation).toMatchObject({ kind: 'delete', parents: [head], origin: 'local-authoring' });
    expect(tombstone.closure).toMatchObject({ files: [], history: [], comments: [], threads: [], deleted: { by: JSON.stringify(agent) } });
    expect(JSON.stringify(tombstone.closure)).not.toContain('Private title');
    expect(JSON.stringify(tombstone.closure)).not.toContain('private comment');
    expect(sync.readyIntents('repo')).toHaveLength(1);
  });

  it('keeps stable file identity across rename and freezes file/comment tombstone state', () => {
    const db = createTestDatabase();
    let sync!: DesignDocSyncStore;
    const store = new DesignDocStore(db, { onMutation: (mutation) => sync.recordLocalMutation(mutation) });
    sync = new DesignDocSyncStore(db); sync.initialize('repo', 'replica-a');
    sync.setGroup('repo', 'group', ['a', 'b'].map((name) => ({ replicaId: `replica-${name}`, machineId: `machine-${name}`, sponsorReplicaId: null, joinedAt: 1 })));
    const repo = sync.localRepository()!.repoId;
    const doc = store.create({ title: 'Rename', files: [{ path: 'README.md', content: 'one' }, { path: 'other.md', content: 'two' }] }, user);
    const initial = sync.version(repo, sync.head(repo, doc.id)!)!;
    const identity = initial.closure.files.find((file) => file.path === 'other.md')!.sync_id;
    const comment = store.addComment(doc.id, { body: 'anchor', path: 'other.md' }, user);
    store.renameFile(doc.id, 'other.md', 'renamed.md', user);
    const renamed = sync.version(repo, sync.head(repo, doc.id)!)!;
    expect(renamed.closure.files.find((file) => file.path === 'renamed.md')!.sync_id).toBe(identity);
    expect(renamed.closure.comments[0]!.path).toBe('renamed.md');
    store.deleteFile(doc.id, 'renamed.md', user);
    store.deleteComment(doc.id, comment.id, user);
    const deleted = sync.version(repo, sync.head(repo, doc.id)!)!;
    expect(deleted.closure.files).toHaveLength(1);
    expect(deleted.closure.comments).toHaveLength(0);
    expect(deleted.closure.history.some((row) => row.path === 'renamed.md' && row.op === 'delete')).toBe(true);
    expect(initial.closure.files).toHaveLength(2);
  });
});

function makeStore(options: { maxHistoryBytes?: number; frozenClock?: boolean; ids?: 'counter' | 'descending' } = {}) {
  let clock = 1_000;
  let counter = 0;
  const store = new DesignDocStore(createTestDatabase(), {
    now: () => (options.frozenClock ? clock : (clock += 10)),
    // Descending ids make sure nothing orders by id by accident.
    randomId: (prefix) => `${prefix}${(options.ids === 'descending' ? 9999 - (counter += 1) : (counter += 1)).toString().padStart(4, '0')}`,
    maxHistoryBytes: options.maxHistoryBytes
  });
  return store;
}

function expectError(fn: () => unknown, code: string, message?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DesignDocError);
    expect((error as DesignDocError).code).toBe(code);
    if (message) expect((error as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected an error');
}

describe('DesignDocStore — docs', () => {
  it('creates a doc from the default template with an entry file and history', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Offline Sync', summary: 'Sync while offline', projectId: 'p1' }, agent);
    expect(doc.slug).toBe('offline-sync');
    expect(doc.entryPath).toBe('README.md');
    expect(doc.files.map((file) => file.path)).toEqual(['README.md', 'diagrams/architecture.mmd']);
    expect(doc.files[1]!.kind).toBe('mermaid');
    expect(doc.createdBy).toEqual(agent);
    expect(doc.threads).toEqual([
      expect.objectContaining({ threadId: 'thread-1', title: 'Planner', role: 'author' })
    ]);
    expect(store.readFile(doc.id, 'README.md').content).toContain('# Offline Sync');
    expect(store.readFile(doc.id, 'README.md').content).toContain('> Sync while offline');
    expect(store.history(doc.id)).toHaveLength(2);
  });

  it('creates from explicit files, picks a markdown entry, and rejects bad input', () => {
    const store = makeStore();
    const doc = store.create(
      { title: 'Files', files: [{ path: 'notes.txt', content: 'n' }, { path: 'spec.md', content: '# Spec' }] },
      user
    );
    expect(doc.entryPath).toBe('spec.md');
    expect(doc.threads).toEqual([]);
    const site = store.create({ title: 'Site', files: [{ path: 'data/a.csv', content: 'a\n1\n' }, { path: 'notes.md', content: '' }, { path: 'index.html', content: '<p>Home</p>' }] }, user);
    expect(site.entryPath).toBe('index.html');
    expectError(() => store.create({ title: '  ' }, user), 'invalid', /title is required/);
    expectError(() => store.create({ title: 'x'.repeat(200) }, user), 'invalid', /at most/);
    expectError(() => store.create({ title: 'T', template: 'nope' }, user), 'invalid', /unknown template/);
    expectError(() => store.create({ title: 'T', status: 'weird' as never }, user), 'invalid', /unknown status/);
    expectError(
      () => store.create({ title: 'T', files: [{ path: 'a.md', content: '' }, { path: 'A.md', content: '' }] }, user),
      'invalid',
      /duplicate/
    );
    expectError(
      () => store.create({ title: 'T', files: [{ path: 'a.md', content: '' }], entryPath: 'b.md' }, user),
      'invalid',
      /entryPath/
    );
    expectError(
      () => store.create({ title: 'T', files: [{ path: '../evil.md', content: '' }] }, user),
      'invalid',
      /"\."/
    );
    expectError(
      () =>
        store.create(
          { title: 'T', files: Array.from({ length: MAX_FILES_PER_DOC + 1 }, (_, i) => ({ path: `f${i}.md`, content: '' })) },
          user
        ),
      'limit'
    );
    expectError(() => store.create({ title: 'T', tags: ['x'.repeat(40)] }, user), 'invalid', /longer/);
    expectError(() => store.create({ title: 'T', tags: 'a' as never }, user), 'invalid', /array/);
    expectError(() => store.create({ title: 'T', tags: [1 as never] }, user), 'invalid', /array/);
    expectError(() => store.create({ title: 'T', tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }, user), 'invalid');
    expectError(() => store.create({ title: 'T', summary: 's'.repeat(700) }, user), 'invalid', /summary/);
  });

  it('makes slugs unique and resolves docs by id or slug', () => {
    const store = makeStore();
    const a = store.create({ title: 'Café API!', template: 'blank' }, user);
    const b = store.create({ title: 'Cafe API', template: 'blank' }, user);
    const c = store.create({ title: '!!!', template: 'blank' }, user);
    expect([a.slug, b.slug, c.slug]).toEqual(['cafe-api', 'cafe-api-2', 'design-doc']);
    expect(store.find('CAFE-API-2')?.id).toBe(b.id);
    expect(store.find(a.id)?.slug).toBe('cafe-api');
    expect(store.find('missing')).toBeNull();
    expect(store.find(42)).toBeNull();
    expectError(() => store.get('missing'), 'not_found', /list docs/);
  });

  it('lists with project scope, status and full-text filters', () => {
    const store = makeStore();
    const p1 = store.create({ title: 'Alpha', projectId: 'p1', tags: ['Mobile App'], template: 'blank' }, user);
    const global = store.create({ title: 'Beta', template: 'blank' }, user);
    store.create({ title: 'Gamma', projectId: 'p2', template: 'blank' }, user);
    store.writeFile(global.id, { path: 'README.md', content: 'mentions 100%_done' }, user);
    store.update(p1.id, { status: 'archived' }, user);

    expect(store.list().map((doc) => doc.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(store.list({ projectId: 'p1' }).map((doc) => doc.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(store.list({ projectId: null }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ status: 'active' }).map((doc) => doc.title)).toEqual(['Beta', 'Gamma']);
    expect(store.list({ status: 'archived' }).map((doc) => doc.title)).toEqual(['Alpha']);
    expect(store.list({ query: 'mobile-app' }).map((doc) => doc.title)).toEqual(['Alpha']);
    expect(store.list({ query: '100%_' }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ query: '%' }).map((doc) => doc.title)).toEqual(['Beta']);
    expect(store.list({ query: 'zzz' })).toEqual([]);
    expect(store.list({ limit: 1 })).toHaveLength(1);
    expect(store.list({ limit: -3 })).toHaveLength(3);
    expectError(() => store.list({ status: 'nope' as never }), 'invalid');
    const [first] = store.list({ projectId: 'p1', status: 'archived' });
    expect(first).toMatchObject({ fileCount: 1, openComments: 0, tags: ['mobile-app'] });
  });

  it('matches ASCII case-insensitively, other letters as typed, and can skip file contents', () => {
    const store = makeStore();
    const accented = store.create({ title: 'Été planning', template: 'blank' }, user);
    const body = store.create({ title: 'Other', template: 'blank' }, user);
    store.writeFile(body.id, { path: 'README.md', content: 'The été rollout' }, user);
    // LIKE folds ASCII case only, so accented letters match as typed.
    expect(store.list({ query: 'Été' }).map((doc) => doc.id)).toEqual([accented.id]);
    expect(store.list({ query: 'été' }).map((doc) => doc.id)).toEqual([body.id]);
    expect(store.list({ query: 'PLANNING' }).map((doc) => doc.id)).toEqual([accented.id]);
    expect(store.list({ query: 'rollout', contents: false })).toEqual([]);
    expect(store.list({ query: 'rollout' }).map((doc) => doc.id)).toEqual([body.id]);
  });

  it('updates metadata and bumps the doc revision', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'technical' }, user);
    const updated = store.update(
      doc.id,
      { title: ' New   title ', summary: 'S', status: 'review', tags: ['A', 'a', ' '], entryPath: 'diagrams/architecture.mmd', projectId: 'p9' },
      agent
    );
    expect(updated).toMatchObject({
      title: 'New title',
      summary: 'S',
      status: 'review',
      tags: ['a'],
      entryPath: 'diagrams/architecture.mmd',
      projectId: 'p9',
      revision: doc.revision + 1,
      updatedBy: agent
    });
    expect(store.update(doc.id, {}, user).revision).toBe(updated.revision);
    expectError(() => store.update(doc.id, { entryPath: 'nope.md' }, user), 'invalid', /entryPath/);
    expectError(() => store.update(doc.id, { status: 'nope' as never }, user), 'invalid');
  });

  it('removes a doc and everything that belongs to it', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'hi' }, user);
    store.remove(doc.id);
    expect(store.find(doc.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });
});

describe('DesignDocStore — files', () => {
  it('writes, skips no-op writes, and enforces baseRevision', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const first = store.writeFile(doc.id, { path: 'README.md', content: 'v2', baseRevision: 1, note: '  tidy  ' }, agent);
    expect(first).toMatchObject({ revision: 2, created: false, updatedBy: agent });
    expect(store.history(doc.id, { path: 'README.md' })[0]).toMatchObject({ op: 'write', note: 'tidy', revision: 2 });
    const same = store.writeFile(doc.id, { path: 'README.md', content: 'v2' }, user);
    expect(same.revision).toBe(2);
    expectError(
      () => store.writeFile(doc.id, { path: 'README.md', content: 'v3', baseRevision: 1 }, user),
      'conflict',
      /changed since revision 1 \(now 2, last edited by agent|Planner/
    );
    expectError(() => store.writeFile(doc.id, { path: 'new.md', content: 'x', baseRevision: 3 }, user), 'conflict', /does not exist/);
    expectError(() => store.writeFile(doc.id, { path: 'README.md', content: 'x', baseRevision: -1 }, user), 'invalid');
    const created = store.writeFile(doc.id, { path: 'docs/new.md', content: 'x', baseRevision: 0 }, user);
    expect(created).toMatchObject({ created: true, revision: 1 });
    expect(store.get(doc.id).threads).toEqual([expect.objectContaining({ role: 'editor' })]);
  });

  it('validates content type, size, case clashes and file count', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    expectError(() => store.writeFile(doc.id, { path: 'x.md', content: 5 as never }, user), 'invalid', /string/);
    expectError(() => store.writeFile(doc.id, { path: 'readme.md', content: 'x' }, user), 'conflict', /letter case/);
    expectError(
      () => store.writeFile(doc.id, { path: 'big.md', content: 'x'.repeat(MAX_TEXT_FILE_BYTES + 1) }, user),
      'limit',
      /split/
    );
    expectError(() => store.writeFile(doc.id, { path: 'a.png', content: 'abc', encoding: 'utf8' }, user), 'invalid', /base64/);
    expectError(() => store.writeFile(doc.id, { path: 'a.md', content: 'abc', encoding: 'base64' }, user), 'invalid', /UTF-8/);
    expectError(() => store.writeFile(doc.id, { path: 'a.png', content: 'not base64!' }, user), 'invalid', /valid base64/);
    const png = store.writeFile(doc.id, { path: 'img/a.png', content: 'iVBO\nRw0K' }, user);
    expect(png).toMatchObject({ kind: 'image', size: 6 });
    expect(store.readFile(doc.id, 'img/a.png')).toMatchObject({ encoding: 'base64', content: 'iVBORw0K' });
    for (let index = store.get(doc.id).files.length; index < MAX_FILES_PER_DOC; index += 1) {
      store.writeFile(doc.id, { path: `f/${index}.md`, content: '' }, user);
    }
    expectError(() => store.writeFile(doc.id, { path: 'overflow.md', content: '' }, user), 'limit', /files/);
    expectError(() => store.readFile(doc.id, 'nope.md'), 'not_found', /files: /);
  });

  it('applies exact-match edits like an agent Edit tool', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'a b a c' }] }, user);
    const result = store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'b', newText: 'B' }], baseRevision: 1 }, agent);
    expect(result.revision).toBe(2);
    expect(store.readFile(doc.id, 'README.md').content).toBe('a B a c');
    store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'a', newText: '$&x', replaceAll: true }] }, agent);
    expect(store.readFile(doc.id, 'README.md').content).toBe('$&x B $&x c');
    expectError(() => store.editFile(doc.id, { path: 'README.md', edits: [] }, agent), 'invalid', /non-empty/);
    expectError(() => store.editFile(doc.id, { path: 'gone.md', edits: [{ oldText: 'a', newText: 'b' }] }, agent), 'not_found');
    expectError(
      () => store.editFile(doc.id, { path: 'README.md', edits: Array.from({ length: 51 }, () => ({ oldText: 'a', newText: 'b' })) }, agent),
      'limit'
    );
    expectError(
      () => store.editFile(doc.id, { path: 'README.md', edits: [{ oldText: 'B', newText: 'C' }], baseRevision: 1 }, agent),
      'conflict'
    );
    store.writeFile(doc.id, { path: 'a.png', content: 'iVBORw0K' }, user);
    expectError(() => store.editFile(doc.id, { path: 'a.png', edits: [{ oldText: 'i', newText: 'j' }] }, agent), 'invalid', /binary/);
  });

  it('deletes and renames files, keeping history and the entry path valid', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'technical' }, user);
    store.renameFile(doc.id, 'README.md', 'overview.md', agent);
    expect(store.get(doc.id).entryPath).toBe('overview.md');
    expect(store.history(doc.id, { path: 'overview.md' })[0]).toMatchObject({ op: 'rename', renamedFrom: 'README.md' });
    expect(store.history(doc.id, { path: 'README.md' })[0]).toMatchObject({ op: 'delete', note: 'Renamed to overview.md' });
    expectError(() => store.renameFile(doc.id, 'overview.md', 'overview.md', user), 'invalid', /differ/);
    expectError(() => store.renameFile(doc.id, 'overview.md', 'DIAGRAMS/architecture.mmd', user), 'conflict', /already exists/);
    expectError(() => store.renameFile(doc.id, 'overview.md', 'overview.png', user), 'invalid', /encoding/);
    expectError(() => store.renameFile(doc.id, 'missing.md', 'x.md', user), 'not_found');
    store.renameFile(doc.id, 'overview.md', 'Overview.md', user);

    store.deleteFile(doc.id, 'Overview.md', user, { note: 'gone' });
    const after = store.get(doc.id);
    expect(after.files.map((file) => file.path)).toEqual(['diagrams/architecture.mmd']);
    expect(after.entryPath).toBe('diagrams/architecture.mmd');
    expectError(() => store.deleteFile(doc.id, 'diagrams/architecture.mmd', user), 'invalid', /at least one/);
    expectError(() => store.deleteFile(doc.id, 'Overview.md', user), 'not_found');

    // Recreating a deleted path continues its revision numbering.
    const recreated = store.writeFile(doc.id, { path: 'README.md', content: 'back' }, user);
    expect(recreated.revision).toBeGreaterThan(1);
    store.deleteFile(doc.id, 'README.md', agent);
    expect(store.get(doc.id).threads[0]).toMatchObject({ role: 'editor' });
  });

  it('restores past revisions, including deleted files', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'one' }, { path: 'x.md', content: 'x' }] }, user);
    store.writeFile(doc.id, { path: 'README.md', content: 'two' }, user);
    const firstRevision = store.history(doc.id, { path: 'README.md' }).at(-1)!;
    expect(store.revisionContent(doc.id, firstRevision.id)).toMatchObject({ content: 'one', encoding: 'utf8' });
    const restored = store.restoreRevision(doc.id, firstRevision.id, user);
    expect(restored.revision).toBe(3);
    expect(store.readFile(doc.id, 'README.md').content).toBe('one');
    expect(store.history(doc.id, { path: 'README.md' })[0]!.note).toBe('Restored revision 1');

    store.deleteFile(doc.id, 'x.md', user);
    const deletion = store.history(doc.id, { path: 'x.md' })[0]!;
    store.restoreRevision(doc.id, deletion.id, user);
    expect(store.readFile(doc.id, 'x.md').content).toBe('x');
    expectError(() => store.revisionContent(doc.id, 'abc'), 'not_found');
    expectError(() => store.restoreRevision(doc.id, 99999, user), 'not_found');
  });

  it('prunes per-file history to the retention cap', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    for (let index = 0; index < MAX_TEXT_REVISIONS_PER_FILE + 5; index += 1) {
      store.writeFile(doc.id, { path: 'README.md', content: `v${index}` }, user);
    }
    const history = store.history(doc.id, { path: 'README.md', limit: 100 });
    expect(history).toHaveLength(MAX_TEXT_REVISIONS_PER_FILE);
    expect(store.history(doc.id, { limit: 3 })).toHaveLength(3);
  });

  it('keeps fewer revisions of large text files and stores fonts as binary', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Site', template: 'blank' }, user);
    const big = 'x'.repeat(LARGE_TEXT_FILE_BYTES);
    for (let index = 0; index < MAX_LARGE_TEXT_REVISIONS_PER_FILE + 3; index += 1) {
      store.writeFile(doc.id, { path: 'data.json', content: `${big}${index}` }, user);
    }
    expect(store.history(doc.id, { path: 'data.json', limit: 100 })).toHaveLength(MAX_LARGE_TEXT_REVISIONS_PER_FILE);

    store.writeFile(doc.id, { path: 'assets/fonts/Inter.woff2', content: 'AAEAAA==' }, user);
    expect(store.readFile(doc.id, 'assets/fonts/Inter.woff2')).toMatchObject({ kind: 'font', encoding: 'base64' });
    expectError(
      () => store.writeFile(doc.id, { path: 'a.ttf', content: 'text', encoding: 'utf8' }, user),
      'invalid',
      /binary file; send its bytes base64-encoded/
    );
    expectError(() => store.renameFile(doc.id, 'assets/fonts/Inter.woff2', 'Inter.css', user), 'invalid', /change encoding/);
  });

  it('drops the oldest history over the byte cap but keeps every path\'s newest snapshot', () => {
    const store = makeStore({ maxHistoryBytes: 1_000 });
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'a'.repeat(300) }] }, user);
    store.writeFile(doc.id, { path: 'gone.md', content: 'g'.repeat(400) }, user);
    store.deleteFile(doc.id, 'gone.md', user);
    for (let index = 0; index < 4; index += 1) {
      store.writeFile(doc.id, { path: 'README.md', content: `${index}`.repeat(300) }, user);
    }
    const history = store.history(doc.id, { limit: 100 });
    const total = history.reduce((sum, entry) => sum + entry.size, 0);
    expect(total).toBeLessThanOrEqual(1_000);
    // The deleted file's last snapshot survives, so it can still be restored.
    const gone = history.find((entry) => entry.path === 'gone.md');
    expect(gone).toBeDefined();
    expect(store.revisionContent(doc.id, gone!.id).content).toBe('g'.repeat(400));
    expect(history.find((entry) => entry.path === 'README.md')!.revision).toBe(5);
  });

  it('returns every file in tree order', () => {
    const store = makeStore();
    const doc = store.create(
      { title: 'Doc', files: [{ path: 'b/z.md', content: '' }, { path: 'README.md', content: '' }, { path: 'a.md', content: '' }] },
      user
    );
    expect(store.readAllFiles(doc.id).map((file) => file.path)).toEqual(['a.md', 'README.md', 'b/z.md']);
  });
});

describe('DesignDocStore — comments and threads', () => {
  it('adds, resolves, reopens and deletes comments', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const comment = store.addComment(doc.id, { body: ' Why? ', path: 'README.md', quote: '  # Doc ' }, agent);
    expect(comment).toMatchObject({ body: 'Why?', path: 'README.md', quote: '# Doc', status: 'open', author: agent });
    expect(store.summary(doc.id).openComments).toBe(1);
    expect(store.get(doc.id).threads[0]).toMatchObject({ role: 'reviewer' });
    const resolved = store.setCommentStatus(doc.id, comment.id, 'resolved', user);
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).not.toBeNull();
    expect(store.setCommentStatus(doc.id, comment.id, 'open', user).resolvedAt).toBeNull();
    store.deleteComment(doc.id, comment.id, user);
    expect(store.get(doc.id).comments).toEqual([]);
    expectError(() => store.addComment(doc.id, { body: ' ' }, user), 'invalid');
    expectError(() => store.addComment(doc.id, { body: 'x'.repeat(9000) }, user), 'limit');
    expectError(() => store.addComment(doc.id, { body: 'x', path: 'nope.md' }, user), 'not_found');
    expectError(() => store.setCommentStatus(doc.id, 'c_nope', 'resolved', user), 'not_found');
    expectError(() => store.setCommentStatus(doc.id, comment.id, 'weird' as never, user), 'invalid');
    expectError(() => store.deleteComment(doc.id, 'c_nope', user), 'not_found');
  });

  it('keeps "last edited by" on content edits when people review the doc', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const edited = store.summary(doc.id);
    const comment = store.addComment(doc.id, { body: 'Why?' }, agent);
    store.addReply(doc.id, comment.id, 'Because.', agent);
    store.setCommentStatus(doc.id, comment.id, 'resolved', agent, 'Done.');
    store.deleteComment(doc.id, comment.id, agent);
    const reviewed = store.summary(doc.id);
    expect(reviewed).toMatchObject({ updatedAt: edited.updatedAt, updatedBy: user });
    expect(reviewed.revision).toBe(edited.revision + 4);
  });

  it('threads replies under a comment and moves comments with their file', () => {
    const store = makeStore({ frozenClock: true, ids: 'descending' });
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const root = store.addComment(doc.id, { body: 'Why?', path: 'README.md', quote: '# Doc' }, user);
    const first = store.addReply(doc.id, root.id, ' Because. ', agent);
    expect(first.replies.map((reply) => reply.body)).toEqual(['Because.']);
    const second = store.addReply(doc.id, root.id, 'And more', user);
    // Same millisecond, ids counting down: replies still read in the order written.
    expect(second.replies.map((reply) => reply.body)).toEqual(['Because.', 'And more']);
    expect(second.replies[0]).toMatchObject({ author: agent });
    expect(store.summary(doc.id).openComments).toBe(1);
    expect(store.get(doc.id).comments).toHaveLength(1);

    const replyId = second.replies[0]!.id;
    expectError(() => store.addReply(doc.id, replyId, 'nested', user), 'invalid', new RegExp(`use its comment ${root.id}`));
    expectError(() => store.setCommentStatus(doc.id, replyId, 'resolved', user), 'invalid');
    expectError(() => store.addReply(doc.id, 'c_nope', 'x', user), 'not_found');
    expectError(() => store.addReply(doc.id, root.id, ' ', user), 'invalid');

    const resolved = store.setCommentStatus(doc.id, root.id, 'resolved', agent, 'Fixed in README');
    expect(resolved).toMatchObject({ status: 'resolved' });
    expect(resolved.replies.at(-1)!.body).toBe('Fixed in README');
    expect(store.summary(doc.id).openComments).toBe(0);

    store.renameFile(doc.id, 'README.md', 'docs/intro.md', user);
    expect(store.get(doc.id).comments[0]!.path).toBe('docs/intro.md');

    store.deleteComment(doc.id, replyId, user);
    expect(store.get(doc.id).comments[0]!.replies).toHaveLength(2);
    store.deleteComment(doc.id, root.id, user);
    expect(store.get(doc.id).comments).toEqual([]);
    // Replies went with their comment: the doc can take a full set again.
    for (let index = 0; index < MAX_COMMENTS_PER_DOC; index += 1) store.addComment(doc.id, { body: `c${index}` }, user);
  });

  it('carries the newest message of the open threads in the summary', () => {
    const store = makeStore({ frozenClock: true, ids: 'descending' });
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    expect(store.summary(doc.id).lastComment).toBeNull();

    const first = store.addComment(doc.id, { body: 'Why?' }, user);
    const second = store.addComment(doc.id, { body: 'x'.repeat(400) }, agent);
    // Same millisecond, ids counting down: the later write still wins.
    expect(store.summary(doc.id).lastComment).toEqual({ body: 'x'.repeat(160), author: agent, createdAt: second.createdAt });
    store.addReply(doc.id, first.id, 'Because.', agent);
    expect(store.list()[0]!.lastComment).toMatchObject({ body: 'Because.', author: agent });

    // A resolved thread's messages, replies included, no longer count.
    store.setCommentStatus(doc.id, first.id, 'resolved', user);
    expect(store.summary(doc.id).lastComment).toMatchObject({ body: 'x'.repeat(160) });
    store.setCommentStatus(doc.id, second.id, 'resolved', user);
    expect(store.summary(doc.id).lastComment).toBeNull();
  });

  it('counts replies toward the comment cap', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const root = store.addComment(doc.id, { body: 'root' }, user);
    for (let index = 1; index < MAX_COMMENTS_PER_DOC; index += 1) store.addReply(doc.id, root.id, `r${index}`, user);
    expectError(() => store.addReply(doc.id, root.id, 'one more', user), 'limit', /comments and replies/);
    expectError(() => store.setCommentStatus(doc.id, root.id, 'resolved', user, 'note'), 'limit');
    expect(store.get(doc.id).comments[0]!.status).toBe('open');
  });

  it('keeps a known thread title when an agent label falls back', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'x' }, { ...agent, label: AGENT_FALLBACK_LABEL });
    expect(store.get(doc.id).threads[0]!.title).toBe('Planner');
    store.linkThread(doc.id, 'thread-new', AGENT_FALLBACK_LABEL, 'assistant');
    expect(store.get(doc.id).threads.find((thread) => thread.threadId === 'thread-new')!.title).toBe(AGENT_FALLBACK_LABEL);
  });

  it('caps comments per doc', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    for (let index = 0; index < MAX_COMMENTS_PER_DOC; index += 1) store.addComment(doc.id, { body: `c${index}` }, user);
    expectError(() => store.addComment(doc.id, { body: 'one more' }, user), 'limit', /resolved/);
  });

  it('keeps the strongest thread role, tracks activity and forgets deleted threads', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, agent);
    store.addComment(doc.id, { body: 'x' }, agent);
    expect(store.get(doc.id).threads[0]!.role).toBe('author');
    store.linkThread(doc.id, 'thread-2', 'Reviewer', 'assistant');
    store.linkThread(doc.id, 'thread-2', '', 'reviewer');
    expect(store.get(doc.id).threads[0]).toMatchObject({ threadId: 'thread-2', title: 'Reviewer', role: 'reviewer' });
    expect(store.touchThread('thread-2', 'Renamed')).toEqual([doc.id]);
    expect(store.get(doc.id).threads.find((thread) => thread.threadId === 'thread-2')!.title).toBe('Renamed');
    expect(store.touchThread('unknown', 'x')).toEqual([]);
    store.unlinkThread(doc.id, 'thread-2');
    expect(store.get(doc.id).threads.map((thread) => thread.threadId)).toEqual(['thread-1']);
    expect(store.forgetThread('thread-1')).toEqual([doc.id]);
    expect(store.forgetThread('thread-1')).toEqual([]);
    for (let index = 0; index < MAX_THREAD_LINKS_PER_DOC + 3; index += 1) {
      store.linkThread(doc.id, `t-${index}`, `T${index}`, 'assistant');
    }
    expect(store.get(doc.id).threads).toHaveLength(MAX_THREAD_LINKS_PER_DOC);
  });
});

describe('pure helpers', () => {
  it('slugifies titles', () => {
    expect(slugify('Hello, World — 2026!')).toBe('hello-world-2026');
    expect(slugify('x'.repeat(80))).toHaveLength(48);
  });

  it('reports precise edit failures', () => {
    expect(() => applyEdits('aa', [{ oldText: 'a', newText: 'b' }], 'f.md')).toThrow(/matches 2 places/);
    expect(() => applyEdits('aa', [{ oldText: 'z', newText: 'b' }, { oldText: 'a', newText: 'c' }], 'f.md')).toThrow(/edit 1/);
    expect(() => applyEdits('aa', [{ oldText: '', newText: 'b' }], 'f.md')).toThrow(/empty/);
    expect(() => applyEdits('aa', [{ oldText: 'a', newText: 'a' }], 'f.md')).toThrow(/identical/);
    expect(() => applyEdits('aa', [{ oldText: 1 } as never], 'f.md')).toThrow(/string/);
  });

  it('formats byte sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2 KiB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MiB');
  });
});

describe('DesignDocStore — pins and alternatives', () => {
  it('pins and unpins without counting as an edit', () => {
    const store = makeStore();
    const doc = store.create({ title: 'Sync', template: 'blank' }, user);
    const pinned = store.setPinned(doc.slug, true);
    expect(pinned.pinnedAt).toEqual(expect.any(Number));
    expect(pinned).toMatchObject({ revision: doc.revision, updatedAt: doc.updatedAt });
    // Pinning again keeps the original pin time.
    expect(store.setPinned(doc.id, true).pinnedAt).toBe(pinned.pinnedAt);
    expect(store.setPinned(doc.id, false).pinnedAt).toBeNull();
    expectError(() => store.setPinned('missing', true), 'not_found');
  });

  it('links an alternative one level deep and detaches it', () => {
    const store = makeStore();
    const original = store.create({ title: 'Trace API', template: 'blank' }, user);
    const alternative = store.create({ title: 'Unlocked package', template: 'blank' }, user);
    const third = store.create({ title: 'Integration user', template: 'blank' }, user);

    const linked = store.update(alternative.id, { alternativeTo: original.slug }, agent);
    expect(linked.alternativeTo).toBe(original.id);
    expect(linked.revision).toBe(alternative.revision + 1);

    expectError(() => store.update(original.id, { alternativeTo: original.id }, user), 'invalid', /itself/);
    expectError(() => store.update(third.id, { alternativeTo: alternative.id }, user), 'invalid', /is itself an alternative/);
    expectError(() => store.update(original.id, { alternativeTo: third.id }, user), 'invalid', /has its own alternatives/);
    expectError(() => store.update(third.id, { alternativeTo: 'missing' }, user), 'not_found');

    expect(store.update(alternative.id, { alternativeTo: null }, user).alternativeTo).toBeNull();
  });

  it('detaches alternatives when the doc they point at is deleted', () => {
    const store = makeStore();
    const original = store.create({ title: 'Trace API', template: 'blank' }, user);
    const alternative = store.create({ title: 'Unlocked package', template: 'blank' }, user);
    store.update(alternative.id, { alternativeTo: original.id }, user);
    store.remove(original.id);
    expect(store.summary(alternative.id).alternativeTo).toBeNull();
  });
});

describe('DesignDocStore — summary lastComment', () => {
  function makeSeededStore() {
    const db = createTestDatabase();
    let clock = 1_000;
    let counter = 0;
    const store = new DesignDocStore(db, {
      now: () => (clock += 10),
      randomId: (prefix) => `${prefix}${(counter += 1).toString().padStart(4, '0')}`
    });
    return { db, store };
  }

  it('is null without comments and when every thread is resolved', () => {
    const { store } = makeSeededStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    expect(store.summary(doc.id).lastComment).toBeNull();
    const root = store.addComment(doc.id, { body: 'Why?' }, user);
    store.addReply(doc.id, root.id, 'Because', agent);
    store.setCommentStatus(doc.id, root.id, 'resolved', user);
    expect(store.summary(doc.id).lastComment).toBeNull();
  });

  it('carries the newest open comment or reply, truncated, with its author', () => {
    const { store } = makeSeededStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const root = store.addComment(doc.id, { body: 'First question' }, user);
    expect(store.summary(doc.id).lastComment).toMatchObject({ body: 'First question', author: user });
    store.addReply(doc.id, root.id, 'x'.repeat(400), agent);
    const excerpt = store.summary(doc.id).lastComment!;
    expect(excerpt.body).toBe('x'.repeat(160));
    expect(excerpt.author).toEqual(agent);
    expect(excerpt.createdAt).toBeGreaterThan(1_000);
    expect(store.list().find((item) => item.id === doc.id)!.lastComment).toEqual(excerpt);
    // A resolved thread no longer counts; the older open one is shown instead.
    const other = store.addComment(doc.id, { body: 'Newer thread' }, user);
    store.setCommentStatus(doc.id, other.id, 'resolved', user);
    expect(store.summary(doc.id).lastComment).toMatchObject({ body: 'x'.repeat(160) });
  });

  it('tolerates a non-numeric timestamp', () => {
    const { db, store } = makeSeededStore();
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const comment = store.addComment(doc.id, { body: 'hello' }, user);
    db.prepare("UPDATE doc_comments SET created_at = 'later' WHERE id = ?").run(comment.id);
    expect(store.summary(doc.id).lastComment).toMatchObject({ body: 'hello', author: user, createdAt: 0 });
  });
});
