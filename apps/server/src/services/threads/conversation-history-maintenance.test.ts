import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startConversationHistoryMaintenance } from './conversation-history-maintenance.js';
import { compactArchivedConversations, maintainConversationHistory, maintainConversationEventHistory, reclaimFreeDatabasePages, type ZccDatabase } from '@zana-ai/zcc-db';
vi.mock('@zana-ai/zcc-db', () => ({
  CONVERSATION_PRUNING_POLICIES: ['rate-limits', 'context-usage', 'token-usage', 'deltas', 'background'],
  maintainConversationHistory: vi.fn(), maintainConversationEventHistory: vi.fn(),
  compactArchivedConversations: vi.fn(), reclaimFreeDatabasePages: vi.fn()
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(maintainConversationHistory).mockReset().mockReturnValue({ snapshots: 0, outputs: 0, scannedSnapshots: 0 });
  vi.mocked(maintainConversationEventHistory).mockReset().mockImplementation((_db, policy) => [{ policy: policy!, threadId: null, scanned: 0, removed: 0 }]);
  vi.mocked(compactArchivedConversations).mockReset().mockReturnValue({ threadId: null, scanned: 0, removed: 0 });
  vi.mocked(reclaimFreeDatabasePages).mockReset().mockReturnValue(0);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('survives a transient failure and disposes its single timer', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(maintainConversationHistory).mockImplementationOnce(() => { throw new Error('busy'); })
    .mockImplementationOnce(() => { throw 'busy'; });
  const stop = startConversationHistoryMaintenance({} as ZccDatabase);
  expect(maintainConversationHistory).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_000);
  expect(warn).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(30_000);
  expect(maintainConversationHistory).toHaveBeenCalledTimes(2);
  expect(maintainConversationEventHistory).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30_005);
  expect(maintainConversationEventHistory).toHaveBeenCalledTimes(5);
  stop();
  vi.advanceTimersByTime(60_000);
  expect(maintainConversationHistory).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it('yields between batches and finishes idle policies without rescanning them', () => {
  vi.mocked(maintainConversationHistory).mockReturnValueOnce({ outputs: 32, snapshots: 0, scannedSnapshots: 0 });
  vi.mocked(maintainConversationEventHistory).mockImplementation((_db, policy) => [{ policy: policy!, threadId: policy === 'deltas' ? 'busy-thread' : null, scanned: 32, removed: 31 }]);
  const stop = startConversationHistoryMaintenance({} as ZccDatabase);
  vi.advanceTimersByTime(30_000);
  expect(maintainConversationHistory).toHaveBeenCalledOnce();
  expect(maintainConversationEventHistory).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  const policies = vi.mocked(maintainConversationEventHistory).mock.calls.map(([, policy]) => policy);
  expect(policies.filter(policy => policy === 'deltas').length).toBeGreaterThan(10);
  expect(policies.filter(policy => policy === 'background')).toHaveLength(1);
  expect(maintainConversationHistory).toHaveBeenCalledTimes(2);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not reschedule when disposed inside a database callback', () => {
  let stop!: () => void;
  vi.mocked(maintainConversationHistory).mockImplementation(() => { stop(); return { outputs: 0, snapshots: 0, scannedSnapshots: 0 }; });
  stop = startConversationHistoryMaintenance({} as ZccDatabase);
  vi.advanceTimersByTime(60_000);
  expect(maintainConversationHistory).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('drains 10,000 completed deltas in yielded batches while retaining the final message', async () => {
  const actual = await vi.importActual<typeof import('@zana-ai/zcc-db')>('@zana-ai/zcc-db');
  vi.mocked(maintainConversationHistory).mockImplementation(actual.maintainConversationHistory);
  vi.mocked(maintainConversationEventHistory).mockImplementation(actual.maintainConversationEventHistory);
  const dir = mkdtempSync(join(tmpdir(), 'zcc-maintenance-catch-up-'));
  const db = actual.openDatabase(join(dir, 'audit.sqlite'));
  let stop = () => {};
  try {
    const host = actual.upsertHost(db, { name: 'audit', hostKeyHash: 'unused' });
    const thread = actual.createConversationThread(db, { hostId: host.id, projectId: 'p', providerId: 'fake', status: 'idle' });
    const insert = db.sqlite.prepare('INSERT INTO thread_events(id,thread_id,sequence,type,payload,created_at) VALUES(?,?,?,?,?,?)');
    const delta = JSON.stringify({ scope: { turnId: 't' }, itemId: 'message', delta: 'x' });
    db.transaction(() => {
      for (let sequence = 1; sequence <= 10_000; sequence++) insert.run(String(sequence), thread.id, sequence, 'item/agentMessage/delta', delta, 0);
      insert.run('completed', thread.id, 10_001, 'item/completed', JSON.stringify({ scope: { turnId: 't' }, item: { id: 'message', type: 'agentMessage', text: 'complete reply' } }), 0);
    });
    stop = startConversationHistoryMaintenance(db);
    vi.advanceTimersByTime(30_000);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM thread_events').get()).toMatchObject({ count: 10_001 });
    vi.advanceTimersByTime(2_000);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM thread_events').get()).toMatchObject({ count: 2 });
    expect(db.sqlite.prepare('SELECT id FROM thread_events ORDER BY sequence').all()).toEqual([{ id: '1' }, { id: 'completed' }]);
    expect(vi.mocked(maintainConversationEventHistory).mock.calls.length).toBeGreaterThan(300);
  } finally { stop(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});


it('keeps an idle sweep at one call per policy however many threads exist, and visits only changed ones', async () => {
  const actual = await vi.importActual<typeof import('@zana-ai/zcc-db')>('@zana-ai/zcc-db');
  vi.mocked(maintainConversationHistory).mockImplementation(actual.maintainConversationHistory);
  vi.mocked(maintainConversationEventHistory).mockImplementation(actual.maintainConversationEventHistory);
  const dir = mkdtempSync(join(tmpdir(), 'zcc-maintenance-idle-'));
  const db = actual.openDatabase(join(dir, 'audit.sqlite'));
  let stop = () => {};
  try {
    const host = actual.upsertHost(db, { name: 'audit', hostKeyHash: 'unused' });
    const threads = Array.from({ length: 25 }, () => actual.createConversationThread(db, { hostId: host.id, projectId: 'p', providerId: 'fake', status: 'idle' }).id);
    const limits = (threadId: string, count: number) => {
      for (let i = 0; i < count; i++) actual.appendConversationThreadEvent(db, { threadId, type: 'provider/rateLimits/updated', payload: { scope: { kind: 'thread' } } });
    };
    const remaining = (threadId: string) => (db.sqlite.prepare('SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = ?').get(threadId) as { count: number }).count;
    for (const threadId of threads) limits(threadId, 3);
    stop = startConversationHistoryMaintenance(db);
    vi.advanceTimersByTime(40_000);
    expect(threads.map(remaining)).toEqual(threads.map(() => 1));
    expect(db.sqlite.prepare('SELECT COUNT(*) AS count FROM conversation_pruning_work').get()).toEqual({ count: 0 });

    const cursors = () => db.sqlite.prepare('SELECT * FROM conversation_event_pruning_cursors ORDER BY policy').all();
    const settled = cursors();
    vi.mocked(maintainConversationEventHistory).mockClear();
    vi.advanceTimersByTime(30_000);
    const idle = vi.mocked(maintainConversationEventHistory).mock.calls.map(([, policy]) => policy);
    expect(idle).toEqual(['rate-limits', 'context-usage', 'token-usage', 'deltas', 'background']);
    expect(cursors()).toEqual(settled);

    limits(threads[7]!, 3);
    vi.mocked(maintainConversationEventHistory).mockClear();
    vi.advanceTimersByTime(30_000);
    expect(vi.mocked(maintainConversationEventHistory).mock.calls.length).toBeLessThanOrEqual(15);
    expect(remaining(threads[7]!)).toBe(1);
    expect(threads.filter(id => id !== threads[7]).map(remaining)).toEqual(Array(24).fill(1));
  } finally { stop(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('continues a full scanned snapshot batch even when every row is a protected keeper', () => {
  vi.mocked(maintainConversationHistory).mockReturnValueOnce({ outputs: 0, snapshots: 0, scannedSnapshots: 32 });
  const stop = startConversationHistoryMaintenance({} as ZccDatabase);
  vi.advanceTimersByTime(30_008);
  expect(maintainConversationHistory).toHaveBeenCalledTimes(2);
  stop();
});

it('compacts archived threads, then reclaims free pages, each until it reports no more work', () => {
  vi.mocked(compactArchivedConversations)
    .mockReturnValueOnce({ threadId: 'old', scanned: 64, removed: 60 })
    .mockReturnValueOnce({ threadId: 'old', scanned: 3, removed: 1 });
  vi.mocked(reclaimFreeDatabasePages).mockReturnValueOnce(64).mockReturnValueOnce(64).mockReturnValueOnce(12);
  const stop = startConversationHistoryMaintenance({} as ZccDatabase);
  vi.advanceTimersByTime(30_020);
  expect(compactArchivedConversations).toHaveBeenCalledTimes(3);
  expect(reclaimFreeDatabasePages).toHaveBeenCalledTimes(4);
  const order = [
    ...vi.mocked(compactArchivedConversations).mock.invocationCallOrder.map(at => ({ at, job: 'archive' })),
    ...vi.mocked(reclaimFreeDatabasePages).mock.invocationCallOrder.map(at => ({ at, job: 'vacuum' }))
  ].sort((a, b) => a.at - b.at).map(({ job }) => job);
  expect(order).toEqual(['archive', 'vacuum', 'archive', 'vacuum', 'archive', 'vacuum', 'vacuum']);
  expect(vi.mocked(maintainConversationEventHistory).mock.invocationCallOrder.at(-1)!)
    .toBeLessThan(vi.mocked(compactArchivedConversations).mock.invocationCallOrder[0]!);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
