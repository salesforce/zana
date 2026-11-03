import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi, type DocSyncStatus, type DocSyncState, type SyncSummary } from './api.js';

/** Plain words for sync state. "Computer" is the only device word: the app cannot know which is a laptop or desktop. */
export const SYNC_STATE_LABEL: Record<DocSyncState, string> = {
  'up-to-date': 'Synced',
  unsent: 'Not sent to other computers yet',
  waiting: 'Waiting for another computer',
  'needs-choice': 'Changed on two computers',
  failed: "Couldn't send"
};

export const SYNC_STATE_HELP: Record<DocSyncState, string> = {
  'up-to-date': 'Your other computers have the latest version.',
  unsent: 'This doc has changes your other computers have not received. Use Sync Now to send them.',
  waiting: 'Another computer is offline or still catching up. Changes send automatically when it is ready.',
  'needs-choice': 'This doc was edited on two computers. Open Peer conflicts and choose which version to keep.',
  failed: 'Sending failed. Try Sync Now again; if it keeps failing, check that the other computer is open and connected.'
};

/** States worth a mark in the doc list; "synced" and "not shared yet" stay quiet. */
export function needsAttention(state: DocSyncState | undefined): boolean {
  return state === 'waiting' || state === 'needs-choice' || state === 'failed';
}

/** One friendly sentence for the result of a Sync Now pass, never the word "blocked". */
export function syncResultMessage(result: SyncSummary): { text: string; kind: 'info' | 'error' } {
  const choice = result.needsChoice ?? 0, failed = result.failed ?? 0;
  // Older servers report only a total: treat it as "waiting", the common and harmless case.
  const waiting = result.waiting ?? (result.needsChoice === undefined && result.failed === undefined ? result.blocked : 0);
  if (!choice && !failed && !waiting) return { text: result.synced > 0 ? 'Synced with your other computers' : 'Already up to date', kind: 'info' };
  const lead = result.synced > 0 ? `Synced ${result.synced}. ` : '';
  const parts: string[] = [];
  if (choice) parts.push('A doc was changed on two computers. Open it and choose which version to keep.');
  if (failed) parts.push("Some changes couldn't be sent. Try Sync Now again.");
  if (waiting) parts.push('Some changes are waiting for another computer. They will send on their own.');
  return { text: lead + parts.join(' '), kind: failed ? 'error' : 'info' };
}

const POLL_MS = 15_000;

/** Per-doc sync state, refreshed on a timer and whenever `refreshKey` changes. Empty when sync is not set up. */
export function useDocSyncStatuses(refreshKey?: unknown, docId?: string): ReadonlyMap<string, DocSyncStatus> {
  const api = useApi();
  const [rows, setRows] = useState<DocSyncStatus[]>([]);
  const alive = useRef(true);
  const load = useCallback(() => {
    // A failed poll keeps the last good rows; the next tick retries.
    api.docSyncStatuses(docId).then((next) => { if (alive.current) setRows(next); }, (error) => console.warn('[design-docs] docSyncStatuses poll failed', error));
  }, [api, docId]);
  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load, refreshKey]);
  return useMemo(() => new Map(rows.map((row) => [row.docId, row])), [rows]);
}
