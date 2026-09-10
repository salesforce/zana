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

export function createInboxReadStore(opts: InboxReadStoreOptions): IInboxReadStore {
  const filePath = opts.filePath ?? defaultInboxReadStateFile();
  const inbox = opts.inbox;

  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function load(): Promise<InboxReadState> {
    try {
      return parseState(await readFile(filePath, 'utf-8'));
    } catch {
      return emptyState();
    }
  }

  async function persist(state: InboxReadState): Promise<void> {
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

  async function liveInboxIds(): Promise<Set<string>> {
    return new Set(await inbox.listIds());
  }

  function intersect(readIds: Record<string, true>, live: Set<string>): Record<string, true> {
    const next: Record<string, true> = {};
    for (const id of Object.keys(readIds)) {
      if (live.has(id)) next[id] = true;
    }
    return next;
  }

  async function getReadState(): Promise<InboxReadState> {
    return runExclusive(async () => {
      const state = await load();
      const live = await liveInboxIds();
      const readIds = intersect(state.readIds, live);
      if (Object.keys(readIds).length !== Object.keys(state.readIds).length) {
        const next = { ...state, readIds };
        await persist(next);
        return next;
      }
      return { readIds, migratedFromLocalStorage: state.migratedFromLocalStorage };
    });
  }

  async function markRead(id: string): Promise<InboxReadState> {
    return markAllRead(typeof id === 'string' ? [id] : []);
  }

  async function markUnread(id: string): Promise<InboxReadState> {
    return runExclusive(async () => {
      const state = await load();
      const live = await liveInboxIds();
      const readIds = intersect(state.readIds, live);
      if (typeof id === 'string' && readIds[id]) delete readIds[id];
      const next = { ...state, readIds };
      await persist(next);
      return next;
    });
  }

  async function markAllRead(ids: string[]): Promise<InboxReadState> {
    return runExclusive(async () => {
      const wanted = normalizeIds(ids);
      const state = await load();
      const live = await liveInboxIds();
      const readIds = intersect(state.readIds, live);
      for (const id of wanted) {
        if (live.has(id)) readIds[id] = true;
      }
      const next = { ...state, readIds };
      await persist(next);
      return next;
    });
  }

  async function pruneRead(ids: string[]): Promise<InboxReadState> {
    return runExclusive(async () => {
      const wanted = normalizeIds(ids);
      const state = await load();
      const live = await liveInboxIds();
      const readIds = intersect(state.readIds, live);
      for (const id of wanted) delete readIds[id];
      const next = { ...state, readIds };
      await persist(next);
      return next;
    });
  }

  async function migrateCurrentOriginReadIds(ids: string[]): Promise<InboxReadState> {
    return runExclusive(async () => {
      const state = await load();
      const live = await liveInboxIds();
      const readIds = intersect(state.readIds, live);
      if (state.migratedFromLocalStorage) {
        return { readIds, migratedFromLocalStorage: true };
      }
      for (const id of normalizeIds(ids)) {
        if (live.has(id)) readIds[id] = true;
      }
      const next = { readIds, migratedFromLocalStorage: true };
      await persist(next);
      return next;
    });
  }

  const offRemoved = inbox.onRemoved((id) => {
    void pruneRead([id]);
  });
  const offPruned = inbox.onPruned((removedIds) => {
    void pruneRead(removedIds);
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
    }
  };
}
