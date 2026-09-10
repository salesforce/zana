/**
 * Durable per-entry inbox flags (read / answered / keep).
 *
 * Inbox *content* lives in the append-only JSONL store. These maps are a small
 * side file so marking an entry read does not rewrite history. Renderer-supplied
 * ids are advisory: writes only persist ids that currently exist in the inbox.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InboxMarkersSnapshot } from '@zana-ai/zcc-domain/product';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue
} from '../../durable-store.js';
import {
  DEFAULT_MAX_INBOX_ENTRIES,
  DEFAULT_MAX_QUIET_INBOX_ENTRIES,
  type IInboxStore
} from './inbox-store.js';

export type { InboxMarkersSnapshot };

const MARKERS_VERSION = 1 as const;

export function emptyInboxMarkers(): InboxMarkersSnapshot {
  return { version: MARKERS_VERSION, readIds: {}, answeredIds: {}, keptIds: {} };
}

export function markersPath(dataDir: string): string {
  return join(dataDir, 'inbox-markers.json');
}

function isIdMap(value: unknown): value is Record<string, true> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0 || flag !== true) return false;
  }
  return true;
}

function cloneMap(map: Record<string, true>): Record<string, true> {
  return { ...map };
}

function parseMarkers(raw: unknown): InboxMarkersSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyInboxMarkers();
  const rec = raw as Record<string, unknown>;
  return {
    version: MARKERS_VERSION,
    readIds: isIdMap(rec.readIds) ? rec.readIds : {},
    answeredIds: isIdMap(rec.answeredIds) ? rec.answeredIds : {},
    keptIds: isIdMap(rec.keptIds) ? rec.keptIds : {}
  };
}

function snapshotOf(state: InboxMarkersSnapshot): InboxMarkersSnapshot {
  return {
    version: MARKERS_VERSION,
    readIds: cloneMap(state.readIds),
    answeredIds: cloneMap(state.answeredIds),
    keptIds: cloneMap(state.keptIds)
  };
}

function mapsEqual(a: Record<string, true>, b: Record<string, true>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (b[key] !== true) return false;
  }
  return true;
}

function sameSnapshot(a: InboxMarkersSnapshot, b: InboxMarkersSnapshot): boolean {
  return mapsEqual(a.readIds, b.readIds)
    && mapsEqual(a.answeredIds, b.answeredIds)
    && mapsEqual(a.keptIds, b.keptIds);
}

const ID_SCAN_LIMIT = DEFAULT_MAX_INBOX_ENTRIES + DEFAULT_MAX_QUIET_INBOX_ENTRIES;

/** Filter renderer-supplied ids down to entries that currently exist. */
export async function knownInboxEntryIds(
  inbox: Pick<IInboxStore, 'read'>,
  ids: string[]
): Promise<Set<string>> {
  const want = new Set(ids.filter((id) => typeof id === 'string' && id.length > 0));
  if (want.size === 0) return new Set();
  const { entries } = await inbox.read({ limit: ID_SCAN_LIMIT });
  const known = new Set<string>();
  for (const entry of entries) {
    if (want.has(entry.id)) known.add(entry.id);
  }
  return known;
}

export interface InboxMarkersStore {
  snapshot(): InboxMarkersSnapshot;
  markRead(ids: string[]): Promise<InboxMarkersSnapshot>;
  markUnread(ids: string[]): Promise<InboxMarkersSnapshot>;
  markAnswered(id: string): Promise<InboxMarkersSnapshot>;
  toggleKeep(id: string): Promise<InboxMarkersSnapshot>;
  prune(ids: string[]): Promise<InboxMarkersSnapshot>;
}

export function createInboxMarkersStore(opts: {
  dataDir: string;
  knownIds: (ids: string[]) => Promise<Iterable<string>>;
}): InboxMarkersStore {
  const file = markersPath(opts.dataDir);
  const queue = createSerializedTransactionQueue();
  let state = loadFromDisk(file);

  function persist(next: InboxMarkersSnapshot): InboxMarkersSnapshot {
    if (sameSnapshot(state, next)) return snapshotOf(state);
    mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
    atomicDurableWrite(file, Buffer.from(`${JSON.stringify(next)}\n`, 'utf8'));
    state = snapshotOf(next);
    return snapshotOf(state);
  }

  function dropIds(map: Record<string, true>, ids: Iterable<string>): Record<string, true> {
    let changed = false;
    const next = cloneMap(map);
    for (const id of ids) {
      if (next[id]) {
        delete next[id];
        changed = true;
      }
    }
    return changed ? next : map;
  }

  return {
    snapshot() {
      return snapshotOf(state);
    },
    markRead(ids) {
      return queue.run(async () => {
        const known = new Set(await opts.knownIds(ids));
        if (known.size === 0) return snapshotOf(state);
        const readIds = cloneMap(state.readIds);
        let changed = false;
        for (const id of known) {
          if (!readIds[id]) {
            readIds[id] = true;
            changed = true;
          }
        }
        if (!changed) return snapshotOf(state);
        return persist({ ...state, readIds });
      });
    },
    markUnread(ids) {
      return queue.run(async () => {
        const known = new Set(await opts.knownIds(ids));
        if (known.size === 0) return snapshotOf(state);
        const readIds = dropIds(state.readIds, known);
        if (readIds === state.readIds) return snapshotOf(state);
        return persist({ ...state, readIds });
      });
    },
    markAnswered(id) {
      return queue.run(async () => {
        const known = new Set(await opts.knownIds([id]));
        if (!known.has(id) || state.answeredIds[id]) return snapshotOf(state);
        return persist({
          ...state,
          answeredIds: { ...state.answeredIds, [id]: true }
        });
      });
    },
    toggleKeep(id) {
      return queue.run(async () => {
        const known = new Set(await opts.knownIds([id]));
        if (!known.has(id)) return snapshotOf(state);
        const keptIds = cloneMap(state.keptIds);
        if (keptIds[id]) delete keptIds[id];
        else keptIds[id] = true;
        return persist({ ...state, keptIds });
      });
    },
    prune(ids) {
      return queue.run(async () => {
        if (ids.length === 0) return snapshotOf(state);
        const next: InboxMarkersSnapshot = {
          version: MARKERS_VERSION,
          readIds: dropIds(state.readIds, ids),
          answeredIds: dropIds(state.answeredIds, ids),
          keptIds: dropIds(state.keptIds, ids)
        };
        if (
          next.readIds === state.readIds
          && next.answeredIds === state.answeredIds
          && next.keptIds === state.keptIds
        ) {
          return snapshotOf(state);
        }
        return persist(next);
      });
    }
  };
}

function loadFromDisk(file: string): InboxMarkersSnapshot {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return parseMarkers(raw);
  } catch {
    return emptyInboxMarkers();
  }
}
