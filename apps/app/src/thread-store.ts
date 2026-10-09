import { create } from 'zustand';
import { shallow } from 'zustand/vanilla/shallow';
import { subscribeProductReconnect } from './lib/product-ws.js';
import { product } from './lib/product-client.js';
import type { ThreadActivityState } from '@zana-ai/zcc-domain/thread-runtime';

export interface ThreadListItem {
  id: string;
  projectId: string;
  hostId: string;
  environmentId: string | null;
  providerId: string;
  status: string;
  title: string | null;
  createdAt: number;
  cwd: string | null;
  branchName: string | null;
  isWorktree: boolean;
  archivedAt?: number | null;
  /** Hidden threads (side-panel assistants, side-chat forks) never join the roster. */
  visibility?: 'visible' | 'hidden';
  parentThreadId?: string | null;
  hasPendingInteraction?: boolean;
  lastReadSeq?: number | null;
  maxSeq?: number;
  updatedAt?: number;
  pinnedAt?: number | null;
  pinOrder?: number | null;
  activity?: ThreadActivityState;
  runtime?: { displayStatus: string; hostReconnectGraceExpiresAt: number | null };
}

interface ThreadStore {
  threads: ThreadListItem[];
  loading: boolean;
  load(): Promise<void>;
  upsert(thread: ThreadListItem): void;
  remove(id: string): void;
}

function isThreadListItem(value: unknown): value is ThreadListItem {
  return Boolean(value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string');
}

let subscribed = false;
const pendingSequences = new Map<string, number>();
let sequenceTimer: ReturnType<typeof setTimeout> | undefined;

function ensureThreadUpdates(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeProductReconnect(() => useThreads.getState().load());
  product.threads.onUpdated((payload) => {
    if (isThreadListItem(payload)) {
      useThreads.getState().upsert(payload);
      return;
    }
    void useThreads.getState().load();
  });
  product.threads.onEvent((payload) => {
    if (!payload || typeof payload !== 'object') return;
    const threadId = 'threadId' in payload && typeof payload.threadId === 'string'
      ? payload.threadId
      : null;
    const sequence = 'sequence' in payload && typeof payload.sequence === 'number'
      ? payload.sequence
      : null;
    if (!threadId || sequence == null || !Number.isSafeInteger(sequence) || sequence <= 0) return;
    pendingSequences.set(threadId, Math.max(sequence, pendingSequences.get(threadId) ?? 0));
    sequenceTimer ??= setTimeout(() => {
      sequenceTimer = undefined;
      const state = useThreads.getState();
      const threads = applyThreadEventSequences(state.threads, pendingSequences);
      pendingSequences.clear();
      if (threads !== state.threads) useThreads.setState({ threads });
    }, 100);
  });
}

function withoutArchived(threads: ThreadListItem[]): ThreadListItem[] {
  return threads.filter((row) => !row.archivedAt);
}

function withUnreadFields(thread: ThreadListItem, previous?: ThreadListItem): ThreadListItem {
  return {
    ...previous,
    ...thread,
    lastReadSeq: thread.lastReadSeq !== undefined ? thread.lastReadSeq : previous?.lastReadSeq ?? null,
    maxSeq: typeof thread.maxSeq === 'number' ? thread.maxSeq : previous?.maxSeq ?? 0,
    updatedAt: thread.updatedAt ?? previous?.updatedAt ?? thread.createdAt
  };
}

/** Patch an existing row in place so opening a thread does not reshuffle the rail. */
export function mergeThreadRoster(
  threads: ThreadListItem[],
  thread: ThreadListItem
): ThreadListItem[] {
  // `threads:updated` is broadcast for every thread, so an update is the only
  // place a hidden thread could slip into the list the initial load excludes.
  // Hidden children (side-chat forks) stay: their parent shows their pending
  // questions as banners.
  if (thread.archivedAt || (thread.visibility === 'hidden' && !thread.parentThreadId)) {
    return threads.some(row => row.id === thread.id) ? threads.filter((row) => row.id !== thread.id) : threads;
  }
  const index = threads.findIndex((row) => row.id === thread.id);
  if (index < 0) return [withUnreadFields(thread), ...threads];
  const previous = threads[index]!;
  const merged = withUnreadFields(thread, previous);
  if (shallow({ ...previous, activity: undefined, runtime: undefined }, { ...merged, activity: undefined, runtime: undefined })
    && shallow(previous.activity, merged.activity) && shallow(previous.runtime, merged.runtime)) return threads;
  const next = threads.slice();
  next[index] = merged;
  return next;
}

/** Apply one event burst against the latest metadata with one roster scan/write. */
export function applyThreadEventSequences(
  threads: ThreadListItem[], sequences: ReadonlyMap<string, number>, now = Date.now()
): ThreadListItem[] {
  let changed = false;
  const next = threads.map(row => {
    const sequence = sequences.get(row.id);
    if (sequence === undefined || (row.maxSeq ?? 0) >= sequence) return row;
    changed = true;
    return { ...row, maxSeq: sequence, updatedAt: now };
  });
  return changed ? next : threads;
}

export function applyThreadEventSequence(
  threads: ThreadListItem[],
  threadId: string,
  sequence: number,
  now = Date.now()
): ThreadListItem[] {
  const current = threads.find((row) => row.id === threadId);
  if (!current || (current.maxSeq ?? 0) >= sequence) return threads;
  return mergeThreadRoster(threads, { ...current, maxSeq: sequence, updatedAt: now });
}

export function pendingChildThreads(
  threads: readonly ThreadListItem[],
  parentThreadId: string
): ThreadListItem[] {
  return threads.filter((row) => row.parentThreadId === parentThreadId && row.hasPendingInteraction);
}

export const useThreads = create<ThreadStore>((set, get) => ({
  threads: [],
  loading: false,
  async load() {
    ensureThreadUpdates();
    set({ loading: true });
    try {
      const threads = withoutArchived(await product.threads.list());
      set({ threads, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  upsert(thread) {
    ensureThreadUpdates();
    const current = get().threads;
    const threads = mergeThreadRoster(current, thread);
    if (threads !== current) set({ threads });
  },
  remove(id) {
    set({ threads: get().threads.filter((row) => row.id !== id) });
  }
}));
