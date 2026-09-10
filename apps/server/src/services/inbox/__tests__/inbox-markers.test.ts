import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createInboxMarkersStore,
  emptyInboxMarkers,
  knownInboxEntryIds,
  markersPath
} from '../inbox-markers.js';
import { createInboxStore, createMemoryInboxStore } from '../inbox-store.js';

describe('inbox markers store', () => {
  it('persists read/answered/keep flags and reloads them from a fresh instance', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-'));
    const known = new Set(['a', 'b', 'c']);
    const store = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids.filter((id) => known.has(id))
    });

    await store.markRead(['a', 'ghost']);
    await store.markAnswered('b');
    await store.toggleKeep('c');
    await store.toggleKeep('ghost');

    expect(store.snapshot()).toEqual({
      version: 1,
      readIds: { a: true },
      answeredIds: { b: true },
      keptIds: { c: true }
    });

    const onDisk = JSON.parse(readFileSync(markersPath(dataDir), 'utf8')) as unknown;
    expect(onDisk).toEqual({
      version: 1,
      readIds: { a: true },
      answeredIds: { b: true },
      keptIds: { c: true }
    });

    const reopened = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids.filter((id) => known.has(id))
    });
    expect(reopened.snapshot()).toEqual(store.snapshot());
  });

  it('treats unknown ids as a no-op and does not write the file', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-'));
    const store = createInboxMarkersStore({
      dataDir,
      knownIds: async () => []
    });
    await expect(store.markRead(['missing'])).resolves.toEqual(emptyInboxMarkers());
    await expect(store.markUnread(['missing'])).resolves.toEqual(emptyInboxMarkers());
    await expect(store.markAnswered('missing')).resolves.toEqual(emptyInboxMarkers());
    await expect(store.toggleKeep('missing')).resolves.toEqual(emptyInboxMarkers());
    expect(() => readFileSync(markersPath(dataDir))).toThrow();
  });

  it('prunes markers for deleted ids without touching others', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-'));
    const known = new Set(['keep', 'gone']);
    const store = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids.filter((id) => known.has(id))
    });
    await store.markRead(['keep', 'gone']);
    await store.markAnswered('gone');
    await store.toggleKeep('keep');

    await store.prune(['gone', 'never-existed']);
    expect(store.snapshot()).toEqual({
      version: 1,
      readIds: { keep: true },
      answeredIds: {},
      keptIds: { keep: true }
    });

    const reopened = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids
    });
    expect(reopened.snapshot().readIds).toEqual({ keep: true });
    expect(reopened.snapshot().keptIds).toEqual({ keep: true });
    expect(reopened.snapshot().answeredIds).toEqual({});
  });

  it('unreads only known ids that were previously read', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-'));
    const store = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids
    });
    await store.markRead(['a', 'b']);
    await store.markUnread(['a', 'ghost']);
    expect(store.snapshot().readIds).toEqual({ b: true });
  });

  it('filters ids against the live inbox store', async () => {
    const inbox = createMemoryInboxStore();
    const live = await inbox.append({ projectId: 'p1', comments: 'hello' });
    const known = await knownInboxEntryIds(inbox, [live.id, 'ghost']);
    expect([...known]).toEqual([live.id]);
  });

  it('knownInboxEntryIds sees JSONL entries after a relaunch-style reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-jsonl-'));
    mkdirSync(join(dir, 'inbox'), { recursive: true });
    const filePath = join(dir, 'inbox', 'entries.jsonl');
    const store = createInboxStore({ filePath, maxEntries: 0 });
    const entry = await store.append({ projectId: 'p1', comments: 'hello' });
    const fresh = createInboxStore({ filePath });
    const known = await knownInboxEntryIds(fresh, [entry.id, 'nope']);
    expect(known.has(entry.id)).toBe(true);
    expect(known.has('nope')).toBe(false);
  });

  it('loads a missing or corrupt file as empty markers', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-inbox-markers-'));
    writeFileSync(markersPath(dataDir), '{not json', 'utf8');
    const store = createInboxMarkersStore({
      dataDir,
      knownIds: async (ids) => ids
    });
    expect(store.snapshot()).toEqual(emptyInboxMarkers());
  });
});
