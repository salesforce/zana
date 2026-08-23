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
    const threads = get().threads.filter((row) => row.id !== thread.id);
    if (thread.archivedAt) {
      set({ threads });
      return;
    }
    set({ threads: [thread, ...threads] });
  },
  remove(id) {
    set({ threads: get().threads.filter((row) => row.id !== id) });
  }
}));
