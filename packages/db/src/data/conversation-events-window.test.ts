import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent, createConversationThread, listConversationThreadEventsWindow,
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
