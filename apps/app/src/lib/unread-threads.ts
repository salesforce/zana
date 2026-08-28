import type { ThreadListItem } from '../thread-store.js';

export const UNREAD_THREAD_POPOVER_LIMIT = 12;

export function isUnreadThread(thread: {
  status: string;
  hasPendingInteraction?: boolean;
  lastReadSeq?: number | null;
  maxSeq?: number;
}): boolean {
  const maxSeq = thread.maxSeq ?? 0;
  const lastRead = thread.lastReadSeq;
  if (lastRead == null) {
    return thread.status === 'active'
      || thread.status === 'starting'
      || Boolean(thread.hasPendingInteraction);
  }
  return maxSeq > lastRead;
}

export function unreadThreadCount(
  threads: readonly ThreadListItem[],
  opts?: { scopeProjectId?: string | null; excludeThreadId?: string | null }
): number {
  let n = 0;
  for (const thread of threads) {
    if (opts?.scopeProjectId && thread.projectId !== opts.scopeProjectId) continue;
    if (opts?.excludeThreadId && thread.id === opts.excludeThreadId) continue;
    if (isUnreadThread(thread)) n += 1;
  }
  return n;
}

export function unreadThreads(
  threads: readonly ThreadListItem[],
  opts?: { scopeProjectId?: string | null; excludeThreadId?: string | null; limit?: number }
): ThreadListItem[] {
  const limit = opts?.limit ?? UNREAD_THREAD_POPOVER_LIMIT;
  return threads
    .filter((thread) => {
      if (opts?.scopeProjectId && thread.projectId !== opts.scopeProjectId) return false;
      if (opts?.excludeThreadId && thread.id === opts.excludeThreadId) return false;
      return isUnreadThread(thread);
    })
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, Math.max(0, limit));
}

export function unreadCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
