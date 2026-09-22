import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent, createConversationThread, listConversationThreadEventsWindow,
  getConversationTurnStart, deleteConversationThreadEventsAfter,
  openDatabase, upsertHost, type ZccDatabase
} from '../index.js';
import { migrate } from '../migrate.js';

let db: ZccDatabase;
let dir: string;
afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

it('reads bounded turn requests through the type index after a long streamed answer, with pagination and thread isolation', () => {
  dir = mkdtempSync(join(tmpdir(), 'thread-permissions-db-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const create = () => createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex' });
  const one = create();
  const two = create();
  const type = 'client/turn/requested';
  const first = appendConversationThreadEvent(db, { threadId: one.id, type, payload: { execution: { permissionMode: 'full' } } });
  for (let i = 0; i < 100; i++) appendConversationThreadEvent(db, { threadId: one.id, type: 'item/updated' });
  const second = appendConversationThreadEvent(db, { threadId: one.id, type });
  appendConversationThreadEvent(db, { threadId: two.id, type });
  expect(listConversationThreadEventsWindow(db, one.id, { limit: 80, type })).toEqual([first, second]);
  expect(listConversationThreadEventsWindow(db, one.id, { limit: 1, type })).toEqual([second]);
  expect(listConversationThreadEventsWindow(db, one.id, { limit: 1, type, beforeSeq: second.sequence })).toEqual([first]);
  expect(listConversationThreadEventsWindow(db, two.id, { limit: 1, type, beforeSeq: 1 })).toEqual([]);
  expect(listConversationThreadEventsWindow(db, one.id, { limit: 1 })).toEqual([second]);
  expect(listConversationThreadEventsWindow(db, one.id, { limit: 1, beforeSeq: second.sequence })[0]?.type).toBe('item/updated');
  const plan = db.sqlite.prepare('EXPLAIN QUERY PLAN SELECT * FROM thread_events WHERE thread_id = ? AND type = ? ORDER BY sequence DESC LIMIT ?').all(one.id, type, 80);
  expect(JSON.stringify(plan)).toContain('thread_events_thread_type_seq_idx');
  migrate(db.sqlite); // reopening an already-migrated DB is idempotent
});


it('looks up turn ancestry by ID across long histories, reopen, migration and rewind', () => {
  dir = mkdtempSync(join(tmpdir(), 'thread-ancestry-db-'));
  const path = join(dir, 'test.sqlite');
  db = openDatabase(path);
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const create = () => createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex' });
  const one = create();
  const two = create();
  const start = (threadId: string, turnId: string, parentToolCallId?: string, wrapped = false) => {
    const event = { type: 'turn/started', scope: { kind: 'turn', turnId }, parentToolCallId };
    return appendConversationThreadEvent(db, {
      threadId, type: 'turn/started', payload: wrapped ? { event } : event
    });
  };
  const child = start(one.id, 'child', 'tool-1');
  const root = start(one.id, 'root');
  const wrapped = start(one.id, 'wrapped', 'tool-2', true);
  start(two.id, 'child', 'other-thread-tool');
  for (let i = 0; i < 350; i++) {
    appendConversationThreadEvent(db, { threadId: one.id, type: 'item/updated' });
    start(one.id, `other-${i}`);
  }
  // Upgrade an existing event history, then reopen: no in-memory ancestry cache.
  db.sqlite.exec('DROP INDEX thread_events_turn_start_idx; DELETE FROM runtime_schema_migrations WHERE version = 18');
  db.close();
  db = openDatabase(path);
  expect(getConversationTurnStart(db, one.id, 'child')).toEqual(child);
  expect(getConversationTurnStart(db, one.id, 'root')).toEqual(root);
  expect(getConversationTurnStart(db, one.id, 'wrapped')).toEqual(wrapped);
  expect(getConversationTurnStart(db, two.id, 'root')).toBeNull();
  expect(getConversationTurnStart(db, one.id, 'missing')).toBeNull();
  const duplicate = start(one.id, 'child', 'latest-tool');
  expect(getConversationTurnStart(db, one.id, 'child')).toEqual(duplicate);
  const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT * FROM thread_events
    WHERE thread_id = ? AND type = 'turn/started'
      AND COALESCE(json_extract(payload, '$.event.scope.turnId'), json_extract(payload, '$.scope.turnId')) = ?
    ORDER BY sequence DESC LIMIT 1`).all(one.id, 'child');
  expect(JSON.stringify(plan)).toContain('thread_events_turn_start_idx');
  expect(JSON.stringify(plan)).not.toContain('SCAN');
  deleteConversationThreadEventsAfter(db, one.id, child.sequence);
  expect(getConversationTurnStart(db, one.id, 'child')).toEqual(child);
  expect(getConversationTurnStart(db, one.id, 'wrapped')).toBeNull();
  migrate(db.sqlite);
});
