import { create } from 'zustand';
import { product } from './lib/product-client.js';

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
  parentThreadId?: string | null;
  hasPendingInteraction?: boolean;
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

function ensureThreadUpdates(): void {
  if (subscribed) return;
  subscribed = true;
  product.threads.onUpdated((payload) => {
    if (isThreadListItem(payload)) {
      useThreads.getState().upsert(payload);
      return;
    }
    void useThreads.getState().load();
  });
}

function withoutArchived(threads: ThreadListItem[]): ThreadListItem[] {
  return threads.filter((row) => !row.archivedAt);
}

/** Patch an existing row in place so opening a thread does not reshuffle the rail. */
export function mergeThreadRoster(
  threads: ThreadListItem[],
  thread: ThreadListItem
): ThreadListItem[] {
  if (thread.archivedAt) {
    return threads.filter((row) => row.id !== thread.id);
  }
  const index = threads.findIndex((row) => row.id === thread.id);
  if (index < 0) return [thread, ...threads];
  const next = threads.slice();
  next[index] = thread;
  return next;
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
    set({ threads: mergeThreadRoster(get().threads, thread) });
  },
  remove(id) {
    set({ threads: get().threads.filter((row) => row.id !== id) });
  }
}));
