import { describe, expect, it } from 'vitest';
import { mergeThreadRoster, type ThreadListItem } from './thread-store.js';

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
