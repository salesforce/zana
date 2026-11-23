import { useEffect, useState } from 'react';
import type { ThreadHistoryRow } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { onThreadArchived, type ThreadListItem } from '../../thread-store.js';

/** Bound for the sidebar: archived conversations come from history, a few pages at most. */
export const ARCHIVED_SIDEBAR_PAGES = 3;

/** History rows carry enough to share the roster's grouping and filters. */
export function archivedHistoryItem(row: ThreadHistoryRow, fallbackHostId: string): ThreadListItem {
  return {
    id: row.id, projectId: row.projectId, hostId: row.hostId ?? fallbackHostId, environmentId: null,
    providerId: row.providerId, status: 'idle', title: row.title, createdAt: row.createdAt ?? row.updatedAt,
    updatedAt: row.updatedAt, archivedAt: row.archivedAt ?? row.updatedAt, originPluginId: row.originPluginId ?? null,
    cwd: null, branchName: null, isWorktree: false
  };
}

/**
 * Archived conversations for the Basic sidebar, loaded only while the Status
 * filter includes them. Reloads when a roster thread is archived.
 */
export function useArchivedConversations(enabled: boolean, scopedProjectId: string | null, primaryHostId: string | undefined) {
  const [rows, setRows] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    return onThreadArchived(() => setRevision(value => value + 1));
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !primaryHostId) { setRows([]); setLoading(false); setError(false); return; }
    let cancelled = false;
    setLoading(true); setError(false);
    void (async () => {
      const collected: ThreadHistoryRow[] = [];
      let offset: number | undefined = 0;
      try {
        for (let page = 0; page < ARCHIVED_SIDEBAR_PAGES && offset !== undefined; page++) {
          const next = await product.threads.history({ archived: 'archived', offset, ...(scopedProjectId ? { projectId: scopedProjectId } : {}) });
          if (cancelled) return;
          collected.push(...next.rows);
          offset = next.nextOffset;
        }
        setRows(collected.map(row => archivedHistoryItem(row, primaryHostId)));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [enabled, scopedProjectId, primaryHostId, revision]);
  return { rows, loading, error };
}
