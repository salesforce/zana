/**
 * Durable inbox read-state store. Lives beside `entries.jsonl` as
 * `read-state.json`. Renderer localStorage is not the source of truth.
 *
 * Writes are atomic (tmp + uniquely-suffixed rename) and serialized with an
 * in-process mutex. IDs are validated against the authoritative inbox store
 * and never persisted if they are unknown. Missing/malformed files recover
 * to an empty map and never throw to the UI.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IInboxStore } from './inbox-store.js';
import { defaultInboxFile } from './inbox-store.js';

export const INBOX_READ_STATE_VERSION = 1;
export const MIGRATE_READ_IDS_CAP = 10_000;

export interface InboxReadState {
  readIds: Record<string, true>;
  migratedFromLocalStorage: boolean;
}

interface InboxReadStateFile {
  version: number;
  migratedFromLocalStorage: boolean;
  readIds: Record<string, true>;
}

export interface IInboxReadStore {
  getReadState(): Promise<InboxReadState>;
  markRead(id: string): Promise<InboxReadState>;
  markUnread(id: string): Promise<InboxReadState>;
  markAllRead(ids: string[]): Promise<InboxReadState>;
  pruneRead(ids: string[]): Promise<InboxReadState>;
  migrateCurrentOriginReadIds(ids: string[]): Promise<InboxReadState>;
  dispose(): void;
}

export interface InboxReadStoreOptions {
  /** Override the JSON path (defaults to sibling of `entries.jsonl`). */
  filePath?: string;
  inbox: IInboxStore;
  persist?: (filePath: string, state: InboxReadState) => Promise<void>;
}

export function defaultInboxReadStateFile(entriesFile = defaultInboxFile()): string {
  return join(dirname(entriesFile), 'read-state.json');
}

function emptyState(): InboxReadState {
  return { readIds: {}, migratedFromLocalStorage: false };
}

function normalizeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MIGRATE_READ_IDS_CAP) break;
  }
  return out;
}

function parseState(raw: string): InboxReadState {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
  const rec = parsed as Partial<InboxReadStateFile>;
  const readIds: Record<string, true> = {};
  if (rec.readIds && typeof rec.readIds === 'object' && !Array.isArray(rec.readIds)) {
    for (const [id, value] of Object.entries(rec.readIds)) {
      if (value === true && id.length > 0) readIds[id] = true;
    }
  }
  return {
    readIds,
    migratedFromLocalStorage: rec.migratedFromLocalStorage === true
  };
}

function createExclusiveQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

async function loadState(filePath: string): Promise<InboxReadState> {
  try {
    return parseState(await readFile(filePath, 'utf-8'));
  } catch {
    return emptyState();
  }
}

async function persistState(filePath: string, state: InboxReadState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const body: InboxReadStateFile = {
    version: INBOX_READ_STATE_VERSION,
    migratedFromLocalStorage: state.migratedFromLocalStorage,
    readIds: state.readIds
  };
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(body)}\n`, { encoding: 'utf-8', mode: 0o600 });
  await rename(tmp, filePath);
}

function intersect(readIds: Record<string, true>, live: Set<string>): Record<string, true> {
  const next: Record<string, true> = {};
  for (const id of Object.keys(readIds)) {
    if (live.has(id)) next[id] = true;
  }
  return next;
}

function createLiveIdCache(inbox: IInboxStore): {
  get(): Promise<Set<string>>;
  dispose(): void;
} {
  let cached: Set<string> | null = null;
  const offAppended = inbox.onAppended((entry) => {
    cached?.add(entry.id);
  });
  const offRemoved = inbox.onRemoved((id) => {
    cached?.delete(id);
  });
  const offPruned = inbox.onPruned((removedIds) => {
    if (!cached) return;
    for (const id of removedIds) cached.delete(id);
  });
  return {
    async get() {
      if (!cached) cached = new Set(await inbox.listIds());
      return cached;
    },
    dispose() {
      offAppended();
      offRemoved();
      offPruned();
    }
  };
}

function logBackgroundPruneFailure(ids: string[], err: unknown): void {
  console.error('[inbox-read] background prune failed', { ids, err });
}

export function createInboxReadStore(opts: InboxReadStoreOptions): IInboxReadStore {
  const filePath = opts.filePath ?? defaultInboxReadStateFile();
  const inbox = opts.inbox;
  const persist = opts.persist ?? persistState;
  const runExclusive = createExclusiveQueue();
  const liveIds = createLiveIdCache(inbox);

  async function mutate(
    apply: (state: InboxReadState, live: Set<string>) => InboxReadState
  ): Promise<InboxReadState> {
    return runExclusive(async () => {
      const state = await loadState(filePath);
      const live = await liveIds.get();
      const next = apply({ ...state, readIds: intersect(state.readIds, live) }, live);
        await persist(filePath, next);
      return next;
    });
  }

  async function getReadState(): Promise<InboxReadState> {
    return runExclusive(async () => {
      const state = await loadState(filePath);
      const live = await liveIds.get();
      const readIds = intersect(state.readIds, live);
      if (Object.keys(readIds).length !== Object.keys(state.readIds).length) {
        const next = { ...state, readIds };
      await persist(filePath, next);
        return next;
      }
      return { readIds, migratedFromLocalStorage: state.migratedFromLocalStorage };
    });
  }

  async function markAllRead(ids: string[]): Promise<InboxReadState> {
    const wanted = normalizeIds(ids);
    return mutate((state, live) => {
      for (const id of wanted) {
        if (live.has(id)) state.readIds[id] = true;
      }
      return state;
    });
  }

  function markRead(id: string): Promise<InboxReadState> {
    return markAllRead(typeof id === 'string' ? [id] : []);
  }

  function markUnread(id: string): Promise<InboxReadState> {
    return mutate((state) => {
      if (typeof id === 'string' && state.readIds[id]) delete state.readIds[id];
      return state;
    });
  }

  function pruneRead(ids: string[]): Promise<InboxReadState> {
    const wanted = normalizeIds(ids);
    return mutate((state) => {
      for (const id of wanted) delete state.readIds[id];
      return state;
    });
  }

  function migrateCurrentOriginReadIds(ids: string[]): Promise<InboxReadState> {
    const wanted = normalizeIds(ids);
    return mutate((state, live) => {
      if (state.migratedFromLocalStorage) {
        return { readIds: state.readIds, migratedFromLocalStorage: true };
      }
      for (const id of wanted) {
        if (live.has(id)) state.readIds[id] = true;
      }
      return { readIds: state.readIds, migratedFromLocalStorage: true };
    });
  }

  function pruneInBackground(ids: string[]): void {
    void pruneRead(ids).catch((err) => logBackgroundPruneFailure(ids, err));
  }

  const offRemoved = inbox.onRemoved((id) => {
    pruneInBackground([id]);
  });
  const offPruned = inbox.onPruned((removedIds) => {
    pruneInBackground(removedIds);
  });

  return {
    getReadState,
    markRead,
    markUnread,
    markAllRead,
    pruneRead,
    migrateCurrentOriginReadIds,
    dispose() {
      offRemoved();
      offPruned();
      liveIds.dispose();
    }
  };
}
