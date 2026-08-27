import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

export const THREAD_RECENT_ITEMS_STORAGE_PREFIX = 'zcc.thread.recentItems';
export const THREAD_RECENT_ITEMS_STORAGE_VERSION = 1;
export const THREAD_RECENT_ITEMS_MAX_STORED = 24;
export const THREAD_RECENT_ITEMS_VISIBLE_LIMIT = 6;

export type RecentItemSource = 'workspace' | 'thread-storage';

export type ThreadRecentItem =
  | { kind: 'file'; source: RecentItemSource; path: string; openedAt: number }
  | { kind: 'browser'; url: string; title: string | null; openedAt: number }
  | { kind: 'plugin'; moduleId: string; actionId?: string; title: string; openedAt: number };

export type ThreadRecentItemInput =
  | { kind: 'file'; source: RecentItemSource; path: string }
  | { kind: 'browser'; url: string; title: string | null }
  | { kind: 'plugin'; moduleId: string; actionId?: string; title: string };

export function getThreadRecentItemsStorageKey(threadId: string): string {
  return `${THREAD_RECENT_ITEMS_STORAGE_PREFIX}-${encodeURIComponent(threadId)}-${THREAD_RECENT_ITEMS_STORAGE_VERSION}`;
}

function isRecentItem(value: unknown): value is ThreadRecentItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.openedAt !== 'number' || !Number.isInteger(row.openedAt) || row.openedAt < 0) {
    return false;
  }
  if (row.kind === 'file') {
    return (row.source === 'workspace' || row.source === 'thread-storage') && typeof row.path === 'string' && row.path.length > 0;
  }
  if (row.kind === 'browser') {
    return typeof row.url === 'string' && row.url.length > 0 && (row.title === null || typeof row.title === 'string');
  }
  if (row.kind === 'plugin') {
    return typeof row.moduleId === 'string' && row.moduleId.length > 0 && typeof row.title === 'string';
  }
  return false;
}

export function parseThreadRecentItems(raw: unknown): ThreadRecentItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecentItem).slice(0, THREAD_RECENT_ITEMS_MAX_STORED);
}

function sameItem(a: ThreadRecentItem, b: ThreadRecentItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'file' && b.kind === 'file') return a.source === b.source && a.path === b.path;
  if (a.kind === 'browser' && b.kind === 'browser') return a.url === b.url;
  if (a.kind === 'plugin' && b.kind === 'plugin') {
    return a.moduleId === b.moduleId && (a.actionId ?? '') === (b.actionId ?? '');
  }
  return false;
}

export function recordRecentItem(
  items: readonly ThreadRecentItem[],
  item: ThreadRecentItem,
  limit = THREAD_RECENT_ITEMS_MAX_STORED
): ThreadRecentItem[] {
  return [item, ...items.filter((existing) => !sameItem(existing, item))].slice(0, limit);
}

export function readThreadRecentItems(threadId: string): ThreadRecentItem[] {
  if (typeof localStorage === 'undefined' || threadId.length === 0) return [];
  try {
    const raw = localStorage.getItem(getThreadRecentItemsStorageKey(threadId));
    if (!raw) return [];
    return parseThreadRecentItems(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeThreadRecentItems(threadId: string, items: readonly ThreadRecentItem[]): void {
  if (typeof localStorage === 'undefined' || threadId.length === 0) return;
  try {
    localStorage.setItem(getThreadRecentItemsStorageKey(threadId), JSON.stringify(items));
  } catch {
    /* quota */
  }
}

export function appendThreadRecentItem(threadId: string, item: ThreadRecentItemInput): ThreadRecentItem[] {
  const next = recordRecentItem(readThreadRecentItems(threadId), { ...item, openedAt: Date.now() } as ThreadRecentItem);
  writeThreadRecentItems(threadId, next);
  return next;
}

export function formatRecentRelativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function recentItemLabel(item: ThreadRecentItem): string {
  if (item.kind === 'file') {
    const parts = item.path.split(/[/\\]/);
    return parts[parts.length - 1] || item.path;
  }
  if (item.kind === 'browser') {
    const title = item.title?.trim();
    return title && title.length > 0 ? title : item.url;
  }
  return item.title;
}

export function tabInputFromRecentItem(item: ThreadRecentItem): Omit<ClosableSecondaryTab, 'id'> {
  if (item.kind === 'file') {
    return {
      kind: item.source === 'thread-storage' ? 'storage-preview' : 'file-preview',
      title: recentItemLabel(item),
      path: item.path
    };
  }
  if (item.kind === 'browser') {
    return { kind: 'browser', title: recentItemLabel(item), url: item.url };
  }
  return { kind: 'plugin', title: item.title, moduleId: item.moduleId, actionId: item.actionId };
}
