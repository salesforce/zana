import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, upsertHost, setConversationProviderThreadId, createEnvironment, createConversationThread, archiveConversationThread, appendConversationThreadEvent, type ZccDatabase } from '@zana-ai/zcc-db';
import { conversationHistory, conversationHistoryAsync, THREAD_HISTORY_PAGE_SIZE } from './conversation-history.js';

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


it('worker search preserves filtering, labels, pagination and literal wildcard behavior', async () => {
  for (let i = 0; i < 43; i++) create('search %_ ' + i);
  const hidden = create('search %_ hidden', 'p', 'hidden');
  const providers = [{ id: 'codex', displayName: 'Codex' }];
  for (const query of [{ query: '%_', projectId: 'p' }, { query: '%_', offset: 40 }, { query: 'no-such-result' }, {}]) {
    expect(await conversationHistoryAsync(db, query, providers)).toEqual(conversationHistory(db, query, providers));
  }
  expect((await conversationHistoryAsync(db, { query: '%_' })).rows.map(row => row.id)).not.toContain(hidden.id);
});
it('a full-text miss over growing history runs without blocking other timers', async () => {
  const thread = create('history volume');
  const payload = { event: { item: { type: 'assistantMessage', text: 'existing '.repeat(500) } } };
  db.transaction(() => { for (let i = 0; i < 5000; i++) appendConversationThreadEvent(db, { threadId: thread.id, type: 'item/completed', payload }); });
  let ticks = 0; const timer = setInterval(() => ticks++, 1);
  try { expect((await conversationHistoryAsync(db, { query: 'absent-search-needle' })).rows).toEqual([]); expect(ticks).toBeGreaterThan(5); }
  finally { clearInterval(timer); }
});

it('ranks title matches first and returns bounded human message context with a sequence link', async () => {
 const title=create('violet title'); const body=create('more recent');
 const event=appendConversationThreadEvent(db,{threadId:body.id,type:'item/completed',payload:{event:{item:{type:'assistantMessage',text:'x'.repeat(400)+'violet '+ 'y'.repeat(400)}}}});
 const page=await conversationHistoryAsync(db,{query:'violet'});
 expect(page.rows.map(row=>row.id)).toEqual([title.id,body.id]); expect(page.rows[1].matchingMessage?.sequence).toBe(event.sequence);
 expect(page.rows[1].matchingMessage?.text).toContain('violet'); expect(page.rows[1].matchingMessage!.text.length).toBeLessThan(250);
});
