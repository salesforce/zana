import { useEffect, useRef } from 'react';
import { product } from '../../../lib/product-client.js';
import type { ClosableSecondaryTab } from './threadSecondaryPanelState.js';

export type ThreadOpenFileIntent = {
  source: 'workspace' | 'thread-storage';
  path: string;
  lineNumber: number | null;
};

const pendingByThread = new Map<string, ThreadOpenFileIntent[]>();

export function resetThreadOpenFileBuffer(): void {
  pendingByThread.clear();
}

export function bufferThreadOpenFile(threadId: string, file: ThreadOpenFileIntent): void {
  const queued = pendingByThread.get(threadId) ?? [];
  queued.push(file);
  pendingByThread.set(threadId, queued);
}

export function consumePendingOpenFile(threadId: string): ThreadOpenFileIntent | null {
  const queued = pendingByThread.get(threadId);
  if (!queued || queued.length === 0) return null;
  const next = queued.shift() ?? null;
  if (!queued.length) pendingByThread.delete(threadId);
  return next;
}

export function parseThreadOpenFilePayload(payload: unknown): {
  threadId: string;
  file: ThreadOpenFileIntent | null;
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.threadId !== 'string' || row.threadId.length === 0) return null;
  if (row.file === null) return { threadId: row.threadId, file: null };
  if (!row.file || typeof row.file !== 'object') return { threadId: row.threadId, file: null };
  const file = row.file as Record<string, unknown>;
  if (file.source !== 'workspace' && file.source !== 'thread-storage') return { threadId: row.threadId, file: null };
  if (typeof file.path !== 'string' || file.path.length === 0) return { threadId: row.threadId, file: null };
  return {
    threadId: row.threadId,
    file: {
      source: file.source,
      path: file.path,
      lineNumber: typeof file.lineNumber === 'number' && file.lineNumber > 0 ? file.lineNumber : null
    }
  };
}

export function tabFromOpenFile(file: ThreadOpenFileIntent): Omit<ClosableSecondaryTab, 'id'> {
  const parts = file.path.split(/[/\\]/);
  const title = parts[parts.length - 1] || file.path;
  if (file.source === 'thread-storage') {
    return { kind: 'storage-preview', title, path: file.path };
  }
  return { kind: 'file-preview', title, path: file.path };
}

export function useThreadOpenFileSignal({
  threadId,
  environmentId,
  openTab
}: {
  threadId: string | null | undefined;
  environmentId: string | null | undefined;
  openTab: (tab: Omit<ClosableSecondaryTab, 'id'>) => void;
}): void {
  const openTabRef = useRef(openTab);
  openTabRef.current = openTab;

  useEffect(() => {
    return product.threads.onOpen((payload) => {
      const parsed = parseThreadOpenFilePayload(payload);
      if (!parsed?.file) return;
      bufferThreadOpenFile(parsed.threadId, parsed.file);
    });
  }, []);

  useEffect(() => {
    if (threadId == null || environmentId === undefined) return;
    const drain = () => {
      const file = consumePendingOpenFile(threadId);
      if (file) openTabRef.current(tabFromOpenFile(file));
    };
    drain();
    return product.threads.onOpen((payload) => {
      const parsed = parseThreadOpenFilePayload(payload);
      if (parsed?.threadId === threadId) drain();
    });
  }, [environmentId, threadId]);
}
