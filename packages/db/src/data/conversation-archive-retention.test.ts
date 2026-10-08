import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent, compactArchivedConversations, createConversationThread,
  openDatabase, reclaimFreeDatabasePages, upsertHost, type ZccDatabase
} from '../index.js';
import { createSqliteDatabase } from '../sqlite.js';

let db: ZccDatabase, dir: string, hostId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conversation-archive-retention-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const thread = (archivedAt: number | null) => {
  const id = createConversationThread(db, { projectId: 'p', hostId, providerId: 'codex' }).id;
  db.sqlite.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(archivedAt, id);
  return id;
};
function add(threadId: string, type: string, fields: Record<string, unknown> = {}, wrapped = false) {
  const payload = { type, threadId, scope: { kind: 'turn', turnId: 'turn' }, ...fields };
  return appendConversationThreadEvent(db, { threadId, type, payload: wrapped ? { event: payload } : payload }).id;
}
const item = (threadId: string, phase: 'started' | 'completed', type: string, wrapped = false) =>
  add(threadId, `item/${phase}`, { item: { type, id: `${type}-${phase}` } }, wrapped);
const types = (threadId: string) => (db.sqlite.prepare('SELECT type, payload FROM thread_events WHERE thread_id = ? ORDER BY sequence').all(threadId) as { type: string; payload: string }[])
  .map(({ type, payload }) => {
    const parsed = JSON.parse(payload) as { item?: { type: string }; event?: { item?: { type: string } } };
    const kind = parsed.item?.type ?? parsed.event?.item?.type;
    return kind ? `${type}:${kind}` : type;
  });
function sweep() {
  const results = [];
  for (let i = 0; i < 100; i++) {
    const result = compactArchivedConversations(db);
    results.push(result);
    if (result.threadId === null) return results;
  }
  throw new Error('Archive compaction did not finish a cycle');
}

function conversation(threadId: string) {
  add(threadId, 'client/turn/requested', { input: [{ type: 'text', text: 'fix the bug' }] });
  add(threadId, 'turn/started');
  add(threadId, 'item/reasoning/textDelta', { delta: 'hmm' });
  item(threadId, 'started', 'reasoning');
  item(threadId, 'completed', 'reasoning', true);
  item(threadId, 'started', 'commandExecution');
  add(threadId, 'item/commandExecution/outputDelta', { delta: 'x'.repeat(1_000) });
  const command = item(threadId, 'completed', 'commandExecution');
  item(threadId, 'started', 'toolCall', true);
  item(threadId, 'completed', 'toolCall');
  add(threadId, 'turn/diff/updated', { diff: '+x' });
  add(threadId, 'provider/unhandled', { raw: {} });
  add(threadId, 'thread/tokenUsage/updated');
  add(threadId, 'item/backgroundTask/progress');
  item(threadId, 'completed', 'userMessage');
  add(threadId, 'item/agentMessage/delta', { delta: 'Fixed' });
  item(threadId, 'completed', 'agentMessage', true);
  item(threadId, 'completed', 'delegation');
  add(threadId, 'item/completed', { item: { id: 'unknown-kind' } });
  add(threadId, 'provider/error', { message: 'rate limited' });
  add(threadId, 'system/userQuestion/lifecycle');
  add(threadId, 'turn/completed');
  return command;
}
const CONVERSATION = [
  'client/turn/requested', 'turn/started', 'item/completed:userMessage', 'item/agentMessage/delta', 'item/completed:agentMessage',
  'item/completed', 'provider/error', 'system/userQuestion/lifecycle', 'turn/completed'
];

it('keeps only the conversation of an archived thread, and drops its logs and stored outputs', () => {
  const archived = thread(Date.now());
  const command = conversation(archived);
  db.sqlite.prepare("INSERT INTO conversation_event_outputs (event_id, output_path, value, expires_at) VALUES (?, 'aggregatedOutput', 'big', ?)")
    .run(command, Date.now() * 2);
  const [first, done] = sweep();
  expect(first).toEqual({ threadId: archived, scanned: 21, removed: 13 });
  expect(done).toEqual({ threadId: null, scanned: 0, removed: 0 });
  expect(types(archived)).toEqual(CONVERSATION);
  expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM conversation_event_outputs').get()).toEqual({ n: 0 });
  expect(db.sqlite.prepare('SELECT compacted_through FROM conversation_archive_compactions WHERE thread_id = ?').get(archived))
    .toEqual({ compacted_through: 22 });
});

it('leaves live threads untouched, and never removes the newest event', () => {
  const live = thread(null);
  const anchored = thread(1);
  conversation(live);
  add(anchored, 'provider/unhandled');
  add(anchored, 'provider/unhandled');
  sweep();
  expect(types(live)).toHaveLength(22);
  expect(types(anchored)).toEqual(['provider/unhandled']);
});

it('advances in bounded batches that survive a restart, then skips finished threads', () => {
  const old = thread(1);
  const other = thread(1);
  for (let i = 0; i < 150; i++) add(old, 'item/commandExecution/outputDelta');
  add(old, 'turn/completed');
  add(other, 'provider/unhandled'); add(other, 'turn/completed');
  const ids = [old, other].sort();
  expect(compactArchivedConversations(db)).toMatchObject({ threadId: ids[0], scanned: ids[0] === old ? 64 : 1 });
  db.close(); db = openDatabase(join(dir, 'db.sqlite'));
  const results = [compactArchivedConversations(db), ...sweep()];
  expect(results.every(result => result.scanned <= 64)).toBe(true);
  expect(types(old)).toEqual(['turn/completed']);
  expect(types(other)).toEqual(['turn/completed']);
  expect(sweep()).toEqual([{ threadId: null, scanned: 0, removed: 0 }]);
});

it('stops a visit when the thread is unarchived, and resumes after the marker when new events arrive', () => {
  const old = thread(1);
  for (let i = 0; i < 70; i++) add(old, 'provider/unhandled');
  add(old, 'turn/completed');
  expect(compactArchivedConversations(db)).toMatchObject({ threadId: old, scanned: 64, removed: 64 });
  db.sqlite.prepare('UPDATE threads SET archived_at = NULL WHERE id = ?').run(old);
  expect(sweep()).toEqual([{ threadId: null, scanned: 0, removed: 0 }]);
  db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(old);
  sweep();
  expect(types(old)).toEqual(['turn/completed']);
  add(old, 'provider/unhandled');
  add(old, 'turn/completed');
  const [revisit] = sweep();
  expect(revisit).toEqual({ threadId: old, scanned: 1, removed: 1 });
  expect(types(old)).toEqual(['turn/completed', 'turn/completed']);
});

it('runs without waiting on a busy database and restores the busy timeout', () => {
  db.sqlite.pragma('busy_timeout = 25');
  compactArchivedConversations(db);
  expect(db.sqlite.pragma('busy_timeout', { simple: true })).toBe(25);
});

it('returns free pages on incremental databases, and is a no-op otherwise', () => {
  expect(db.sqlite.pragma('auto_vacuum', { simple: true })).toBe(2);
  expect(reclaimFreeDatabasePages(db)).toBe(0);
  const old = thread(1);
  for (let i = 0; i < 40; i++) add(old, 'provider/unhandled', { raw: 'x'.repeat(8_000) });
  add(old, 'turn/completed');
  sweep();
  db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  const free = db.sqlite.pragma('freelist_count', { simple: true }) as number;
  expect(free).toBeGreaterThan(10);
  expect(reclaimFreeDatabasePages(db, 4)).toBe(4);
  expect(reclaimFreeDatabasePages(db, 10_000)).toBe(free - 4);

  const legacyFile = join(dir, 'legacy.sqlite');
  const legacy = createSqliteDatabase(legacyFile);
  legacy.exec('CREATE TABLE early (id INTEGER)');
  legacy.close();
  const reopened = openDatabase(legacyFile);
  try {
    expect(reopened.sqlite.pragma('auto_vacuum', { simple: true })).toBe(0);
    expect(reclaimFreeDatabasePages(reopened)).toBe(0);
  } finally { reopened.close(); }
});
