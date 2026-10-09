import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mergeThreadRoster, pendingChildThreads, applyThreadEventSequence, applyThreadEventSequences, type ThreadListItem } from './thread-store.js';

function thread(over: Partial<ThreadListItem> & Pick<ThreadListItem, 'id'>): ThreadListItem {
  return {
    projectId: 'p1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    status: 'idle',
    title: over.id,
    createdAt: 1,
    cwd: null,
    branchName: null,
    isWorktree: false,
    ...over
  };
}

describe('mergeThreadRoster', () => {
  it('reuses the roster for unchanged metadata including equivalent runtime/activity snapshots', () => {
    const row = thread({ id: 'stable', lastReadSeq: null, maxSeq: 0, updatedAt: 1,
      runtime: { displayStatus: 'idle', hostReconnectGraceExpiresAt: null },
      activity: { activeWorkflowCount: 0, activeBackgroundAgentCount: 0, activeBackgroundCommandCount: 0, activePlanModeCount: 0, activeGoalCount: 0 } });
    const rows = [row];
    expect(mergeThreadRoster(rows, { ...row, runtime: { ...row.runtime! }, activity: { ...row.activity! } })).toBe(rows);
    expect(mergeThreadRoster(rows, { ...row, runtime: { ...row.runtime!, displayStatus: 'active' } })).not.toBe(rows);
    expect(mergeThreadRoster(rows, thread({ id: 'missing', archivedAt: 1 }))).toBe(rows);
  });
  it('keeps existing threads in place when an opened thread is refreshed', () => {
    const hello = thread({ id: 'hello', title: 'Hello' });
    const other = thread({ id: 'other', title: 'hello' });
    const fork = thread({ id: 'fork', title: 'hello (fork)' });
    const opened = thread({ id: 'hello', title: 'Hello', status: 'idle' });
    expect(mergeThreadRoster([hello, other, fork], opened).map((row) => row.id)).toEqual([
      'hello',
      'other',
      'fork'
    ]);
  });

  it('keeps lastReadSeq and maxSeq when an upsert omits them', () => {
    const existing = thread({ id: 'hello', lastReadSeq: 2, maxSeq: 5, updatedAt: 9 });
    const opened = thread({ id: 'hello', title: 'Hello', status: 'idle' });
    expect(mergeThreadRoster([existing], opened)[0]).toMatchObject({
      id: 'hello',
      title: 'Hello',
      lastReadSeq: 2,
      maxSeq: 5,
      updatedAt: 9
    });
  });

  it('keeps hidden threads off the roster and drops a thread once it is hidden', () => {
    const existing = thread({ id: 'a' });
    const rows = [existing];
    expect(mergeThreadRoster(rows, thread({ id: 'panel', visibility: 'hidden' }))).toBe(rows);
    expect(mergeThreadRoster(rows, { ...existing, visibility: 'hidden' })).toEqual([]);
    expect(mergeThreadRoster(rows, thread({ id: 'shown', visibility: 'visible' })).map((row) => row.id)).toEqual(['shown', 'a']);
  });

  it('keeps a hidden fork so its parent can surface the fork\'s pending question', () => {
    const parent = thread({ id: 'parent' });
    const fork = thread({ id: 'fork', parentThreadId: 'parent', visibility: 'hidden', hasPendingInteraction: true });
    const rows = mergeThreadRoster([parent], fork);
    expect(rows.map((row) => row.id)).toEqual(['fork', 'parent']);
    expect(pendingChildThreads(rows, 'parent').map((row) => row.id)).toEqual(['fork']);
  });

  it('prepends a thread that is not already on the roster', () => {
    const existing = thread({ id: 'a' });
    const created = thread({ id: 'b' });
    expect(mergeThreadRoster([existing], created).map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('drops an archived thread instead of moving it', () => {
    const keep = thread({ id: 'keep' });
    const gone = thread({ id: 'gone' });
    expect(
      mergeThreadRoster([keep, gone], thread({ id: 'gone', archivedAt: 9 })).map((row) => row.id)
    ).toEqual(['keep']);
  });
});

describe('pendingChildThreads', () => {
  it('keeps only children of the open thread that are awaiting interaction', () => {
    const parent = thread({ id: 'parent' });
    const waiting = thread({
      id: 'child-wait',
      parentThreadId: 'parent',
      hasPendingInteraction: true,
      title: 'Blocked'
    });
    const quiet = thread({ id: 'child-quiet', parentThreadId: 'parent', hasPendingInteraction: false });
    const other = thread({ id: 'other', parentThreadId: 'elsewhere', hasPendingInteraction: true });
    expect(pendingChildThreads([parent, waiting, quiet, other], 'parent')).toEqual([waiting]);
  });
});

describe('applyThreadEventSequence', () => {
  it('bumps maxSeq and recency for a known thread', () => {
    const rows = [thread({ id: 't1', maxSeq: 2, updatedAt: 1 })];
    expect(applyThreadEventSequence(rows, 't1', 4, 50)[0]).toMatchObject({
      id: 't1',
      maxSeq: 4,
      updatedAt: 50
    });
    expect(applyThreadEventSequence(rows, 't1', 2, 50)).toBe(rows);
    expect(applyThreadEventSequence(rows, 'missing', 9, 50)).toBe(rows);
  });

  it('listens for thread events so unread maxSeq can bump without a full reload', () => {
    const source = readFileSync(new URL('./thread-store.ts', import.meta.url), 'utf8');
    expect(source).toContain('product.threads.onEvent');
    expect(source).toContain('maxSeq: sequence');
  });

  it('merges a burst with one scan while preserving unaffected rows and newer metadata', () => {
    const unchanged = thread({ id: 'other', maxSeq: 5 });
    const rows = [thread({ id: 'live', maxSeq: 1, title: 'Latest title' }), unchanged];
    const merged = applyThreadEventSequences(rows, new Map([['live', 10], ['other', 4], ['missing', 99]]), 200);
    expect(merged[0]).toMatchObject({ title: 'Latest title', maxSeq: 10, updatedAt: 200 });
    expect(merged[1]).toBe(unchanged);
    expect(applyThreadEventSequences(merged, new Map([['live', 9]]))).toBe(merged);
  });
});
