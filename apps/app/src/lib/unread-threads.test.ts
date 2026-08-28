import { describe, expect, it } from 'vitest';
import type { ThreadListItem } from '../thread-store.js';
import {
  isUnreadThread,
  unreadCountLabel,
  unreadThreadCount,
  unreadThreads
} from './unread-threads.js';

function thread(over: Partial<ThreadListItem> & Pick<ThreadListItem, 'id'>): ThreadListItem {
  return {
    projectId: 'p1',
    hostId: 'h1',
    environmentId: null,
    providerId: 'claude-code',
    status: 'idle',
    title: over.id,
    createdAt: 1,
    updatedAt: over.updatedAt ?? 1,
    cwd: null,
    branchName: null,
    isWorktree: false,
    lastReadSeq: null,
    maxSeq: 0,
    ...over
  };
}

describe('isUnreadThread', () => {
  it('does not dump historical threads with no read record', () => {
    expect(isUnreadThread(thread({ id: 'old', maxSeq: 8 }))).toBe(false);
  });

  it('treats live or waiting threads without a read record as unread', () => {
    expect(isUnreadThread(thread({ id: 'live', status: 'active', maxSeq: 3 }))).toBe(true);
    expect(isUnreadThread(thread({ id: 'boot', status: 'starting' }))).toBe(true);
    expect(isUnreadThread(thread({ id: 'ask', hasPendingInteraction: true, maxSeq: 1 }))).toBe(true);
  });

  it('counts explicit unread and caught-up records', () => {
    expect(isUnreadThread(thread({ id: 'marked', lastReadSeq: 0, maxSeq: 4 }))).toBe(true);
    expect(isUnreadThread(thread({ id: 'caught', lastReadSeq: 4, maxSeq: 4 }))).toBe(false);
    expect(isUnreadThread(thread({ id: 'behind', lastReadSeq: 2, maxSeq: 5 }))).toBe(true);
  });
});

describe('unreadThreads', () => {
  it('scopes, sorts by recency, caps the popover, and reports the full count', () => {
    const rows = [
      thread({ id: 'a', projectId: 'p1', lastReadSeq: 0, maxSeq: 2, updatedAt: 10, title: 'A' }),
      thread({ id: 'b', projectId: 'p2', lastReadSeq: 0, maxSeq: 2, updatedAt: 30, title: 'B' }),
      thread({ id: 'c', projectId: 'p1', lastReadSeq: 0, maxSeq: 2, updatedAt: 20, title: 'C' }),
      thread({ id: 'd', projectId: 'p1', lastReadSeq: 1, maxSeq: 1, updatedAt: 40, title: 'D' })
    ];
    expect(unreadThreadCount(rows)).toBe(3);
    expect(unreadThreads(rows, { scopeProjectId: 'p1' }).map((row) => row.id)).toEqual(['c', 'a']);
    expect(unreadThreads(rows, { excludeThreadId: 'a', limit: 1 }).map((row) => row.id)).toEqual(['b']);
    expect(unreadThreads(rows, { limit: 1 }).map((row) => row.id)).toEqual(['b']);
  });

  it('caps the badge label at 99+', () => {
    expect(unreadCountLabel(3)).toBe('3');
    expect(unreadCountLabel(99)).toBe('99');
    expect(unreadCountLabel(100)).toBe('99+');
  });
});
