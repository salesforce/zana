import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendConversationThreadEvent, archiveConversationThread, conversationTimelineHeadEvents, createConversationThread,
  CONVERSATION_PRUNING_POLICIES, maintainConversationEventHistory, nextConversationEventSequence, openDatabase, upsertHost,
  type ConversationPruningPolicy, type ZccDatabase
} from '../index.js';

let db: ZccDatabase, dir: string, threadId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conversation-pruning-'));
  db = openDatabase(join(dir, 'db.sqlite'));
  const host = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  threadId = createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'codex' }).id;
});
afterEach(() => { vi.restoreAllMocks(); db.close(); rmSync(dir, { recursive: true, force: true }); });
function add(type: string, fields: Record<string, unknown> = {}, wrapped = false, target = threadId) {
  const payload = { type, threadId: target, scope: { kind: 'turn', turnId: 'turn' }, ...fields };
  return appendConversationThreadEvent(db, { threadId: target, type, payload: wrapped ? { event: payload } : payload });
}
const ids = () => (db.sqlite.prepare('SELECT id FROM thread_events WHERE thread_id = ? ORDER BY sequence').all(threadId) as { id: string }[]).map(row => row.id);
const batch = (policy: ConversationPruningPolicy) => maintainConversationEventHistory(db, policy)[0]!;
function sweep(policy: ConversationPruningPolicy) {
  let removed = 0;
  for (let i = 0; i < 200; i++) {
    const result = batch(policy);
    expect(result.scanned).toBeLessThanOrEqual(32);
    expect(result.removed).toBeLessThanOrEqual(32);
    removed += result.removed;
    if (result.threadId === null) return removed;
  }
  throw new Error('Pruning cursor did not finish a cycle');
}

it('bounds rate-limit batches, rechecks archive status, and preserves the sequence anchor', () => {
  const rows = Array.from({ length: 45 }, () => add('provider/rateLimits/updated'));
  expect(batch('rate-limits').removed).toBe(32);
  db.close(); db = openDatabase(join(dir, 'db.sqlite'));
  expect(sweep('rate-limits')).toBe(12);
  expect(ids()).toEqual([rows.at(-1)!.id]);
  db.sqlite.prepare('UPDATE threads SET archived_at = 1 WHERE id = ?').run(threadId);
  expect(sweep('rate-limits')).toBe(0);
  const next = nextConversationEventSequence(db, threadId);
  const message = add('item/completed', { item: { type: 'agentMessage', id: 'answer', text: 'keep' } });
  expect(sweep('rate-limits')).toBe(1);
  expect(message.sequence).toBe(next);
  expect(ids()).toEqual([message.id]);
});

it.each([false, true])('keeps root usage and the last known capacity, including wrapped events (%s)', wrapped => {
  const capacity = add('thread/contextWindowUsage/updated', { contextWindowUsage: { usedTokens: 100, modelContextWindow: 200000, estimated: false } }, wrapped);
  add('thread/contextWindowUsage/updated', { contextWindowUsage: { usedTokens: 200, modelContextWindow: null, estimated: false } }, wrapped);
  const root = add('thread/contextWindowUsage/updated', { contextWindowUsage: { usedTokens: 300, modelContextWindow: null, estimated: false } }, wrapped);
  add('thread/tokenUsage/updated');
  const token = add('thread/tokenUsage/updated', {}, wrapped);
  const nested = add('turn/started', { scope: { kind: 'turn', turnId: 'nested' }, parentToolCallId: 'parent' }, wrapped);
  add('thread/contextWindowUsage/updated', { scope: { kind: 'turn', turnId: 'nested' }, contextWindowUsage: { usedTokens: 500, modelContextWindow: 999 } }, wrapped);
  add('thread/tokenUsage/updated', { scope: { kind: 'turn', turnId: 'nested' } }, wrapped);
  const end = add('turn/completed');
  expect(sweep('context-usage')).toBe(2);
  expect(sweep('token-usage')).toBe(2);
  expect(ids()).toEqual([capacity.id, root.id, token.id, nested.id, end.id]);
});

it('resumes two-pass discovery across reopen and restarts if a keeper was rewound', () => {
  const rows = Array.from({ length: 70 }, (_, i) => add('thread/contextWindowUsage/updated', {
    contextWindowUsage: { usedTokens: i, modelContextWindow: i === 2 ? 200000 : null }
  }));
  const end = add('turn/completed');
  expect(batch('context-usage').removed).toBe(0);
  db.close(); db = openDatabase(join(dir, 'db.sqlite'));
  expect(batch('context-usage').removed).toBe(0);
  expect(batch('context-usage').removed).toBe(0);
  db.sqlite.prepare('DELETE FROM thread_events WHERE id = ?').run(rows.at(-1)!.id);
  expect(batch('context-usage')).toMatchObject({ scanned: 0, removed: 0 });
  sweep('context-usage');
  expect(ids()).toEqual([rows[2]!.id, rows.at(-2)!.id, end.id]);
});

it.each([
  ['item/agentMessage/delta', { type: 'agentMessage', text: 'full answer' }],
  ['item/commandExecution/outputDelta', { type: 'commandExecution', aggregatedOutput: '' }],
  ['item/reasoning/summaryTextDelta', { type: 'reasoning', summary: ['summary'], content: [] }],
  ['item/reasoning/textDelta', { type: 'reasoning', summary: [], content: ['full reasoning'] }]
])('prunes resolved %s fragments but retains the first fragment and final item', (type, item) => {
  const rows = Array.from({ length: 70 }, (_, i) => add(type as string, { itemId: 'item', delta: 'fragment' }, i % 2 === 0));
  const completed = add('item/completed', { item: { ...item as object, id: 'item' } }, true);
  const next = nextConversationEventSequence(db, threadId);
  expect(batch('deltas').removed).toBe(31);
  db.close(); db = openDatabase(join(dir, 'db.sqlite'));
  expect(sweep('deltas')).toBe(38);
  expect(ids()).toEqual([rows[0]!.id, completed.id]);
  expect(nextConversationEventSequence(db, threadId)).toBe(next);
});

it('does not prune open fragments, missing/empty final content, or different turn/parent/kind identities', () => {
  const type = 'item/commandExecution/outputDelta';
  for (const id of ['open', 'missing', 'null', 'wrong-kind', 'nested', 'other-turn', 'after-final']) {
    add(type, { itemId: id, delta: 'one' }); add(type, { itemId: id, delta: 'two' });
  }
  add('item/completed', { item: { type: 'commandExecution', id: 'missing' } });
  add('item/completed', { item: { type: 'commandExecution', id: 'null', aggregatedOutput: null } });
  add('item/completed', { item: { type: 'agentMessage', id: 'wrong-kind', text: 'answer' } });
  add('item/completed', { item: { type: 'commandExecution', id: 'nested', parentToolCallId: 'parent', aggregatedOutput: 'out' } });
  add('item/completed', { scope: { kind: 'turn', turnId: 'another' }, item: { type: 'commandExecution', id: 'other-turn', aggregatedOutput: 'out' } });
  add('item/agentMessage/delta', { itemId: 'empty', delta: 'one' }); add('item/agentMessage/delta', { itemId: 'empty', delta: 'two' });
  add('item/completed', { item: { type: 'agentMessage', id: 'empty', text: '' } });
  add('item/reasoning/textDelta', { itemId: 'malformed', delta: 'one' }); add('item/reasoning/textDelta', { itemId: 'malformed', delta: 'two' });
  add('item/completed', { item: { type: 'reasoning', id: 'malformed', summary: 'not an array', content: 'not json' } });
  add('item/reasoning/textDelta', { itemId: 'empty-reasoning', delta: 'one' }); add('item/reasoning/textDelta', { itemId: 'empty-reasoning', delta: 'two' });
  add('item/completed', { item: { type: 'reasoning', id: 'empty-reasoning', summary: [''], content: [] } });
  add(type, { itemId: 'no-turn', scope: { kind: 'thread' }, delta: 'one' }); add(type, { itemId: 'no-turn', scope: { kind: 'thread' }, delta: 'two' });
  add('item/completed', { scope: { kind: 'thread' }, item: { type: 'commandExecution', id: 'no-turn', aggregatedOutput: 'out' } });
  add(type, { delta: 'without item identity' });
  const before = ids();
  expect(sweep('deltas')).toBe(0);
  expect(ids()).toEqual(before);
  const final = add('item/completed', { item: { type: 'commandExecution', id: 'after-final', aggregatedOutput: 'out' } });
  const late = add(type, { itemId: 'after-final', delta: 'late update' });
  expect(sweep('deltas')).toBe(1);
  expect(ids()).toEqual(expect.arrayContaining([final.id, late.id]));
});

it('keeps active task state, removes superseded progress, and retains starts and final results', () => {
  const task = { type: 'backgroundTask', id: 'task', status: 'pending' };
  const start = add('item/started', { item: task });
  add('item/backgroundTask/progress', { item: task, scope: { kind: 'thread' } });
  const latest = add('item/backgroundTask/progress', { item: task, scope: { kind: 'thread' } }, true);
  const nested = add('item/backgroundTask/progress', { item: { ...task, parentToolCallId: 'nested' }, scope: { kind: 'thread' } });
  const wrong = add('item/backgroundTask/progress', { item: { ...task, type: 'agentMessage' }, scope: { kind: 'thread' } });
  const end = add('turn/completed');
  expect(sweep('background')).toBe(1);
  expect(ids()).toEqual([start.id, latest.id, nested.id, wrong.id, end.id]);
  const completed = add('item/backgroundTask/completed', { item: { ...task, status: 'completed' }, scope: { kind: 'thread' } });
  expect(sweep('background')).toBe(1);
  expect(ids()).toEqual([start.id, nested.id, wrong.id, end.id, completed.id]);
});

it('revisits old candidates after a late completion, without touching another thread', () => {
  const first = add('item/agentMessage/delta', { itemId: 'same', delta: 'first' });
  add('item/agentMessage/delta', { itemId: 'same', delta: 'second' });
  const hostId = (db.sqlite.prepare('SELECT host_id FROM threads WHERE id = ?').get(threadId) as { host_id: string }).host_id;
  const other = createConversationThread(db, { projectId: 'p', hostId, providerId: 'codex' }).id;
  const otherFinal = add('item/completed', { item: { type: 'agentMessage', id: 'same', text: 'other answer' } }, false, other);
  expect(sweep('deltas')).toBe(0);
  const completed = add('item/completed', { item: { type: 'agentMessage', id: 'same', text: 'our answer' } });
  expect(sweep('deltas')).toBe(1);
  expect(ids()).toEqual([first.id, completed.id]);
  expect(db.sqlite.prepare('SELECT id FROM thread_events WHERE thread_id = ?').all(other)).toEqual([{ id: otherFinal.id }]);
});

it('rolls back cursor and deletes on failure, restores busy timeout, and advances after thread deletion', () => {
  const first = add('provider/rateLimits/updated'); add('provider/rateLimits/updated');
  db.sqlite.exec(`CREATE TRIGGER reject_prune BEFORE DELETE ON thread_events BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  expect(() => batch('rate-limits')).toThrow('test failure');
  expect(db.sqlite.pragma('busy_timeout', { simple: true })).toBe(25);
  expect(ids()).toContain(first.id);
  expect(db.sqlite.prepare('SELECT * FROM conversation_event_pruning_cursors').all()).toEqual([]);
  db.sqlite.exec('DROP TRIGGER reject_prune');
  expect(batch('rate-limits').removed).toBe(1);
  db.sqlite.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
  expect(sweep('rate-limits')).toBe(0);
  expect(maintainConversationEventHistory(db)).toHaveLength(5);
});

it('uses indexed support probes and never selects payloads into JavaScript', () => {
  add('item/agentMessage/delta', { itemId: 'item', delta: 'one' });
  const candidate = add('item/agentMessage/delta', { itemId: 'item', delta: 'two' });
  add('item/completed', { item: { type: 'agentMessage', id: 'item', text: 'complete' } });
  const prepare = vi.spyOn(db.sqlite, 'prepare');
  expect(batch('deltas').removed).toBe(1);
  const statement = prepare.mock.calls.map(([sql]) => sql).find(sql => sql.startsWith('DELETE FROM thread_events AS candidate'))!;
  const plan = JSON.stringify(db.sqlite.prepare('EXPLAIN QUERY PLAN ' + statement).all(candidate.id));
  expect(plan).toContain('thread_events_delta_identity_idx');
  expect(plan).toContain('thread_events_completed_identity_idx');
  expect(plan).not.toMatch(/SCAN (?:earlier|final|candidate)/);
  expect(prepare.mock.calls.every(([sql]) => !/SELECT\s+(?:candidate\.)?payload\b/i.test(sql))).toBe(true);
});

it('retains old capacity in the bounded header even after hundreds of updates without capacity', () => {
  const capacity = add('thread/contextWindowUsage/updated', { contextWindowUsage: { modelContextWindow: 200000, usedTokens: 1 } }, true);
  let root = capacity;
  for (let i = 0; i < 100; i++) root = add('thread/contextWindowUsage/updated', { contextWindowUsage: { modelContextWindow: null, usedTokens: i } });
  add('turn/started', { scope: { kind: 'turn', turnId: 'child' }, parentToolCallId: 'parent' });
  add('thread/contextWindowUsage/updated', { scope: { kind: 'turn', turnId: 'child' }, contextWindowUsage: { modelContextWindow: 900, usedTokens: 1 } });
  expect(conversationTimelineHeadEvents(db, threadId).map(row => row.id)).toEqual([capacity.id, root.id]);
  sweep('context-usage');
  expect(conversationTimelineHeadEvents(db, threadId).map(row => row.id)).toEqual([capacity.id, root.id]);
});

it('defers immediately on a competing writer and restores the normal timeout', () => {
  add('provider/rateLimits/updated'); add('provider/rateLimits/updated');
  const writer = openDatabase(join(dir, 'db.sqlite'));
  try {
    writer.sqlite.exec('BEGIN IMMEDIATE');
    expect(() => batch('rate-limits')).toThrow(/locked/);
    expect(db.sqlite.pragma('busy_timeout', { simple: true })).toBe(25);
  } finally { writer.sqlite.exec('ROLLBACK'); writer.close(); }
  expect(batch('rate-limits').removed).toBe(1);
});

it('migrates legacy malformed completed items safely and does not treat them as completion witnesses', () => {
  const indexes = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('thread_events_type_thread_seq_idx', 'thread_events_delta_candidates_idx', 'thread_events_delta_identity_idx', 'thread_events_completed_identity_idx', 'thread_events_background_identity_idx', 'thread_events_nested_turn_idx', 'thread_events_context_capacity_idx')").all() as { name: string }[];
  for (const { name } of indexes) db.sqlite.exec(`DROP INDEX ${name}`);
  db.sqlite.exec('DROP TABLE conversation_event_pruning_cursors; DELETE FROM runtime_schema_migrations WHERE version=24');
  add('item/agentMessage/delta', { itemId: 'legacy', delta: 'one' });
  add('item/agentMessage/delta', { itemId: 'legacy', delta: 'two' });
  db.sqlite.prepare("INSERT INTO thread_events (id,thread_id,sequence,type,payload,created_at) VALUES ('bad',?,3,'item/completed','not json',0)").run(threadId);
  db.close(); db = openDatabase(join(dir, 'db.sqlite'));
  expect(sweep('deltas')).toBe(0);
  expect(ids()).toHaveLength(3);
  expect(db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version=24').get()).toEqual({ version: 24 });
});

describe('change-driven work queue', () => {
  const POLICIES = [...CONVERSATION_PRUNING_POLICIES];
  const hostId = () => (db.sqlite.prepare('SELECT host_id FROM threads WHERE id = ?').get(threadId) as { host_id: string }).host_id;
  const thread = () => createConversationThread(db, { projectId: 'p', hostId: hostId(), providerId: 'codex' }).id;
  const work = (policy?: string) => (db.sqlite.prepare(
    `SELECT policy, thread_id AS threadId FROM conversation_pruning_work ${policy ? 'WHERE policy = ?' : ''} ORDER BY policy, thread_id`
  ).all(...(policy ? [policy] : [])) as { policy: string; threadId: string }[]);
  const settle = () => { for (const policy of POLICIES) sweep(policy); };
  const changes = () => (db.sqlite.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  function visited(policy: ConversationPruningPolicy) {
    const seen: string[] = [];
    for (let i = 0; i < 200; i++) {
      const { threadId: visit } = batch(policy);
      if (visit === null) return [...new Set(seen)];
      seen.push(visit);
    }
    throw new Error('Pruning cursor did not finish a cycle');
  }

  it('coalesces one pending marker per changed thread and fans it out to every policy', () => {
    add('provider/rateLimits/updated'); add('provider/rateLimits/updated');
    expect(work()).toEqual([{ policy: 'pending', threadId }]);
    batch('rate-limits');
    expect(work('pending')).toEqual([]);
    // The rate-limit visit claimed its own row; the other policies still hold theirs.
    expect(work().map(row => row.policy)).toEqual(POLICIES.filter(policy => policy !== 'rate-limits').sort());
  });

  it('does not touch event history or write at all when nothing changed', () => {
    const others = [thread(), thread(), thread()];
    for (const id of [threadId, ...others]) { add('provider/rateLimits/updated', {}, false, id); add('provider/rateLimits/updated', {}, false, id); }
    settle();
    expect(work()).toEqual([]);
    const before = changes();
    const prepare = vi.spyOn(db.sqlite, 'prepare');
    for (const policy of POLICIES) expect(maintainConversationEventHistory(db, policy)[0]).toMatchObject({ threadId: null, scanned: 0, removed: 0 });
    expect(changes()).toBe(before);
    expect(prepare.mock.calls.every(([sql]) => !/\bthread_events\b/.test(sql))).toBe(true);
  });

  it('visits only threads whose events changed since their last clean visit', () => {
    const [a, b, c] = [thread(), thread(), thread()];
    for (const id of [threadId, a, b, c]) add('item/backgroundTask/progress', { item: { type: 'backgroundTask', id: 't' } }, false, id);
    settle();
    add('provider/rateLimits/updated', {}, false, b);
    add('provider/rateLimits/updated', {}, false, b);
    expect(visited('rate-limits')).toEqual([b]);
    expect(visited('rate-limits')).toEqual([]);
    expect(visited('token-usage')).toEqual([b]);
  });

  it('revisits a thread that changes while its visit is in progress, in the next cycle', () => {
    for (let i = 0; i < 45; i++) add('provider/rateLimits/updated');
    expect(batch('rate-limits')).toMatchObject({ threadId, removed: 32 });
    const [late1, late2] = [add('provider/rateLimits/updated'), add('provider/rateLimits/updated')];
    // The in-flight snapshot ends before the late events; finishing it must not lose their marker.
    expect(sweep('rate-limits')).toBe(13);
    expect(ids()).toEqual([late1.id, late2.id]);
    expect(work('rate-limits')).toEqual([{ policy: 'rate-limits', threadId }]);
    expect(sweep('rate-limits')).toBe(1);
    expect(ids()).toEqual([late2.id]);
    expect(work('rate-limits')).toEqual([]);
  });

  it('revisits old deltas when a final item arrives after the thread was settled', () => {
    const first = add('item/agentMessage/delta', { itemId: 'm', delta: 'a' });
    add('item/agentMessage/delta', { itemId: 'm', delta: 'b' });
    settle();
    expect(ids()).toHaveLength(2);
    const final = add('item/completed', { item: { type: 'agentMessage', id: 'm', text: 'done' } });
    expect(visited('deltas')).toEqual([threadId]);
    expect(ids()).toEqual([first.id, final.id]);
  });

  it('queues rate-limit work when a thread is archived, without needing a new event', () => {
    const limit = add('provider/rateLimits/updated');
    const message = add('item/completed', { item: { type: 'agentMessage', id: 'a', text: 'answer' } });
    settle();
    expect(ids()).toEqual([limit.id, message.id]);
    archiveConversationThread(db, threadId);
    expect(work()).toEqual([{ policy: 'rate-limits', threadId }]);
    expect(sweep('rate-limits')).toBe(1);
    expect(ids()).toEqual([message.id]);
    // Raw writers are covered too, and unarchiving removes nothing.
    db.sqlite.prepare('UPDATE threads SET archived_at = NULL WHERE id = ?').run(threadId);
    expect(work()).toEqual([]);
    db.sqlite.prepare('UPDATE threads SET archived_at = 5 WHERE id = ?').run(threadId);
    expect(work()).toEqual([{ policy: 'rate-limits', threadId }]);
  });

  it('does not queue work for unrelated thread updates', () => {
    settle();
    db.sqlite.prepare('UPDATE threads SET title = ?, updated_at = 9 WHERE id = ?').run('renamed', threadId);
    db.sqlite.prepare('UPDATE threads SET archived_at = 5 WHERE id = ?').run(threadId);
    db.sqlite.prepare('DELETE FROM conversation_pruning_work').run();
    db.sqlite.prepare('UPDATE threads SET archived_at = 6 WHERE id = ?').run(threadId);
    expect(work()).toEqual([]);
  });

  it('drops queued work with its thread and tolerates a claimed thread without events', () => {
    const doomed = thread();
    add('provider/rateLimits/updated', {}, false, doomed);
    db.sqlite.prepare('DELETE FROM threads WHERE id = ?').run(doomed);
    expect(work()).toEqual([]);
    add('provider/rateLimits/updated');
    db.sqlite.prepare('DELETE FROM thread_events WHERE thread_id = ?').run(threadId);
    expect(batch('rate-limits')).toEqual({ policy: 'rate-limits', threadId, scanned: 0, removed: 0 });
    expect(batch('rate-limits').threadId).toBeNull();
    expect(db.sqlite.prepare("SELECT thread_id, upper_sequence FROM conversation_event_pruning_cursors WHERE policy = 'rate-limits'").get())
      .toEqual({ thread_id: '', upper_sequence: 0 });
  });

  it('drains at most one bounded batch of pending threads per advance', () => {
    const many = Array.from({ length: 40 }, () => thread());
    for (const id of many) add('provider/rateLimits/updated', {}, false, id);
    expect(work('pending')).toHaveLength(40);
    batch('rate-limits');
    expect(work('pending')).toHaveLength(8);
    expect(work('token-usage')).toHaveLength(32);
    expect(visited('rate-limits').length).toBeGreaterThan(0);
  });

  it('visits changed threads in id order and leaves a re-marked thread for the next cycle', () => {
    const [a, b] = [thread(), thread()].sort();
    for (const id of [a!, b!]) { add('provider/rateLimits/updated', {}, false, id); add('provider/rateLimits/updated', {}, false, id); }
    expect(batch('rate-limits').threadId).toBe(a);
    add('provider/rateLimits/updated', {}, false, a);
    expect(batch('rate-limits').threadId).toBe(b);
    expect(batch('rate-limits').threadId).toBeNull();
    expect(work('rate-limits')).toEqual([{ policy: 'rate-limits', threadId: a }]);
    expect(visited('rate-limits')).toEqual([a]);
  });

  it('finishes a usage visit in one batch when the thread has no usage events', () => {
    add('turn/started');
    expect(batch('context-usage')).toMatchObject({ threadId, scanned: 0, removed: 0 });
    expect(db.sqlite.prepare("SELECT upper_sequence, phase FROM conversation_event_pruning_cursors WHERE policy = 'context-usage'").get())
      .toEqual({ upper_sequence: 0, phase: 0 });
    // A usage thread still needs its second (deletion) phase.
    add('thread/tokenUsage/updated'); add('thread/tokenUsage/updated'); add('turn/completed');
    expect(visited('token-usage')).toEqual([threadId]);
    expect(ids()).toHaveLength(3);
  });

  it('upgrades a database made before the queue existed and prunes its existing history', () => {
    const first = add('provider/rateLimits/updated'); const last = add('provider/rateLimits/updated');
    const empty = thread();
    sweepAll();
    db.sqlite.exec(`DROP TRIGGER conversation_pruning_event_inserted; DROP TRIGGER conversation_pruning_thread_archived;
      DROP TABLE conversation_pruning_work; DELETE FROM runtime_schema_migrations WHERE version = 31`);
    db.sqlite.prepare("INSERT INTO thread_events (id,thread_id,sequence,type,payload,created_at) VALUES ('legacy-1',?,100,'provider/rateLimits/updated','{}',0), ('legacy-2',?,101,'provider/rateLimits/updated','{}',0)").run(threadId, threadId);
    db.close(); db = openDatabase(join(dir, 'db.sqlite'));
    expect(work().filter(row => row.threadId === threadId).map(row => row.policy)).toEqual([...POLICIES].sort());
    expect(work().some(row => row.threadId === empty)).toBe(false);
    // `last` and legacy-1 are both superseded by the newer legacy-2.
    expect(sweep('rate-limits')).toBe(2);
    expect(ids()).toEqual(['legacy-2']);
    expect(first.id).not.toBe(last.id);
  });

  function sweepAll() { for (const policy of POLICIES) sweep(policy); }
});

it('reaches the change queue only through its primary key', () => {
  add('provider/rateLimits/updated'); add('provider/rateLimits/updated');
  const prepare = vi.spyOn(db.sqlite, 'prepare');
  batch('rate-limits'); batch('rate-limits'); batch('rate-limits');
  const statements = [...new Set(prepare.mock.calls.map(([sql]) => sql).filter(sql => /\bconversation_pruning_work\b/.test(sql)))];
  expect(statements.length).toBeGreaterThanOrEqual(4);
  for (const sql of statements) {
    const parameters = (sql.match(/\?/g) ?? []).length;
    const plan = (db.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...Array.from({ length: parameters }, (_, i) => i === 0 ? '["rate-limits"]' : 'x')) as { detail: string }[]).map(row => row.detail);
    expect(plan.filter(detail => /conversation_pruning_work/.test(detail) && !/SEARCH/.test(detail))).toEqual([]);
  }
});
