import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, upsertHost, setConversationProviderThreadId, createEnvironment, createConversationThread, archiveConversationThread, appendConversationThreadEvent, type ZccDatabase } from '@zana-ai/zcc-db';
import { conversationHistory, THREAD_HISTORY_PAGE_SIZE } from './conversation-history.js';

let db: ZccDatabase;
let dir: string;
let hostId: string;
let environmentId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'history-db-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  environmentId = createEnvironment(db, { projectId: 'p', hostId, path: dir, workspaceProvisionType: 'unmanaged', status: 'ready' }).id;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const create = (title = 'A conversation', projectId = 'p', visibility: 'visible' | 'hidden' = 'visible') => {
  const thread = createConversationThread(db, { projectId, hostId, environmentId, providerId: 'codex', title, visibility });
  setConversationProviderThreadId(db, thread.id, 'native');
  return thread;
};

it('lists archived and active conversations, preserves project scope and excludes hidden runs', () => {
  const one = create(); const two = create('archived'); archiveConversationThread(db, two.id);
  create('other', 'other'); create('secret', 'p', 'hidden');
  expect(conversationHistory(db, { projectId: 'p' }).rows.map((r) => r.id).sort()).toEqual([one.id, two.id].sort());
  expect(conversationHistory(db, { archived: 'archived' }).rows.map((r) => r.id)).toEqual([two.id]);
  expect(conversationHistory(db, { archived: 'active', projectId: 'p' }).rows.map((r) => r.id)).toEqual([one.id]);
  expect(conversationHistory(db, { projectId: 'unknown' }).rows).toEqual([]);
});

it('searches titles and conversation messages, with literal SQL wildcard characters', () => {
  const thread = create('100%_complete');
  appendConversationThreadEvent(db, { threadId: thread.id, type: 'client/turn/requested', payload: { prompt: ['remember the orange bird'] } });
  appendConversationThreadEvent(db, { threadId: thread.id, type: 'item/completed', payload: { event: { item: { type: 'agentMessage', text: 'violet elephant' } } } });
  const other = create('other');
  appendConversationThreadEvent(db, { threadId: other.id, type: 'item/completed', payload: { event: { item: { type: 'commandExecution', command: 'orange bird' } } } });
  for (const query of ['%_', 'ORANGE bird', 'violet elephant']) expect(conversationHistory(db, { query }).rows.map((r) => r.id)).toEqual([thread.id]);
  expect(conversationHistory(db, { query: "' OR 1=1 --" }).rows).toEqual([]);
  expect(conversationHistory(db, { query: '   ' }).rows).toHaveLength(2);
});

it('paginates all saved threads instead of stopping at the live roster cap', () => {
  for (let i = 0; i < THREAD_HISTORY_PAGE_SIZE + 3; i++) create(String(i));
  const first = conversationHistory(db, {});
  expect(first.rows).toHaveLength(THREAD_HISTORY_PAGE_SIZE);
  const next = conversationHistory(db, { offset: first.nextOffset });
  expect(next.rows).toHaveLength(3); expect(next.nextOffset).toBeUndefined();
  expect(new Set([...first.rows, ...next.rows].map((r) => r.id)).size).toBe(THREAD_HISTORY_PAGE_SIZE + 3);
  expect(conversationHistory(db, { offset: -4 })).toEqual(first);
  expect(conversationHistory(db, { offset: NaN })).toEqual(first);
});

it('keeps unavailable conversations readable and explains why they cannot continue', () => {
  const thread = create();
  expect(conversationHistory(db, {}).rows[0].unavailableReason).toBeUndefined();
  db.sqlite.prepare('UPDATE environments SET status = ? WHERE id = ?').run('destroyed', environmentId);
  expect(conversationHistory(db, {}).rows[0].unavailableReason).toContain('environment');
  db.sqlite.prepare('UPDATE environments SET status = ? WHERE id = ?').run('ready', environmentId);
  db.sqlite.prepare('UPDATE threads SET provider_thread_id = NULL WHERE id = ?').run(thread.id);
  // Legacy provider identities can be recovered from events during restore.
  expect(conversationHistory(db, {}).rows[0].unavailableReason).toBeUndefined();
});
