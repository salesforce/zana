import { useCallback, useEffect, useState } from 'react';

const BROWSER_HISTORY_STORAGE_PREFIX = 'zcc.thread.browserHistory';
const BROWSER_HISTORY_STORAGE_VERSION = '1';
const BROWSER_HISTORY_MAX_ENTRIES = 24;

export interface BrowserHistoryEntry {
  url: string;
  title: string | null;
  visitedAt: number;
}

export function getBrowserHistoryStorageKey(threadId: string): string {
  return `${BROWSER_HISTORY_STORAGE_PREFIX}-${encodeURIComponent(threadId.trim())}-${BROWSER_HISTORY_STORAGE_VERSION}`;
}

function isHistoryEntry(value: unknown): value is BrowserHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.url === 'string'
    && row.url.length > 0
    && (row.title === null || typeof row.title === 'string')
    && typeof row.visitedAt === 'number'
    && Number.isInteger(row.visitedAt)
    && row.visitedAt >= 0;
}

export function parseBrowserHistory(raw: unknown): BrowserHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isHistoryEntry).slice(0, BROWSER_HISTORY_MAX_ENTRIES);
}

export function recordBrowserVisit(
  entries: readonly BrowserHistoryEntry[],
  args: { url: string; title: string | null }
): BrowserHistoryEntry[] {
  if (args.url.length === 0) return [...entries];
  const next: BrowserHistoryEntry = {
    url: args.url,
    title: args.title,
    visitedAt: Date.now()
  };
  return [next, ...entries.filter((entry) => entry.url !== args.url)].slice(0, BROWSER_HISTORY_MAX_ENTRIES);
}

export function readBrowserHistory(threadId: string): BrowserHistoryEntry[] {
  if (typeof localStorage === 'undefined' || threadId.trim().length === 0) return [];
  try {
    const raw = localStorage.getItem(getBrowserHistoryStorageKey(threadId));
    if (!raw) return [];
    return parseBrowserHistory(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writeBrowserHistory(threadId: string, entries: readonly BrowserHistoryEntry[]): void {
  if (typeof localStorage === 'undefined' || threadId.trim().length === 0) return;
  try {
    localStorage.setItem(getBrowserHistoryStorageKey(threadId), JSON.stringify(entries));
  } catch {
    /* quota / private mode */
  }
}

export function useBrowserHistory(threadId: string | null | undefined): {
  entries: readonly BrowserHistoryEntry[];
  recordVisit: (args: { url: string; title: string | null }) => void;
  clear: () => void;
} {
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>(() => (
    threadId ? readBrowserHistory(threadId) : []
  ));

  useEffect(() => {
    setEntries(threadId ? readBrowserHistory(threadId) : []);
  }, [threadId]);

  const recordVisit = useCallback((args: { url: string; title: string | null }) => {
    if (!threadId) return;
    setEntries((current) => {
      const next = recordBrowserVisit(current, args);
      writeBrowserHistory(threadId, next);
      return next;
    });
  }, [threadId]);

  const clear = useCallback(() => {
    if (!threadId) return;
    setEntries([]);
    writeBrowserHistory(threadId, []);
  }, [threadId]);

  return { entries, recordVisit, clear };
}
