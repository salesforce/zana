import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInboxStore, type IInboxStore } from '@zana-ai/zcc-server';
import {
  createInboxReadStore,
  defaultInboxReadStateFile,
  type IInboxReadStore
} from '../inbox-read-store.js';

describe('InboxReadStore', () => {
  let dir: string;
  let entriesPath: string;
  let readPath: string;
  let inbox: IInboxStore;
  let store: IInboxReadStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zcc-inbox-read-'));
    await mkdir(join(dir, 'inbox'), { recursive: true });
    entriesPath = join(dir, 'inbox', 'entries.jsonl');
    readPath = defaultInboxReadStateFile(entriesPath);
    inbox = createInboxStore({ filePath: entriesPath, maxEntries: 50, quietMaxEntries: 0 });
    store = createInboxReadStore({ filePath: readPath, inbox });
  });

  afterEach(async () => {
    store.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(n = 2): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const entry = await inbox.append({ projectId: 'p1', comments: `c${i}` });
      ids.push(entry.id);
    }
    return ids;
  }

  it('colocates read-state.json with entries.jsonl', () => {
    expect(readPath).toBe(join(dir, 'inbox', 'read-state.json'));
  });

  it('missing file recovers empty', async () => {
    await expect(store.getReadState()).resolves.toEqual({
      readIds: {},
      migratedFromLocalStorage: false
    });
  });

  it('malformed file recovers empty', async () => {
    await writeFile(readPath, '{not-json', 'utf-8');
    await expect(store.getReadState()).resolves.toEqual({
      readIds: {},
      migratedFromLocalStorage: false
    });
  });

  it('markRead persists and survives a new store instance', async () => {
    const [a] = await seed(1);
    await store.markRead(a);
    store.dispose();
    const fresh = createInboxReadStore({ filePath: readPath, inbox });
    const state = await fresh.getReadState();
    expect(state.readIds[a]).toBe(true);
    fresh.dispose();
  });

  it('markUnread drops only that id', async () => {
    const [a, b] = await seed(2);
    await store.markAllRead([a, b]);
    const next = await store.markUnread(a);
    expect(next.readIds[a]).toBeUndefined();
    expect(next.readIds[b]).toBe(true);
  });

  it('drops unknown ids and never persists them', async () => {
    const [a] = await seed(1);
    const next = await store.markAllRead([a, 'ghost-id']);
    expect(next.readIds[a]).toBe(true);
    expect(next.readIds['ghost-id']).toBeUndefined();
    const raw = JSON.parse(await readFile(readPath, 'utf-8')) as { readIds: Record<string, true> };
    expect(raw.readIds['ghost-id']).toBeUndefined();
  });

  it('prune removes named ids', async () => {
    const [a, b] = await seed(2);
    await store.markAllRead([a, b]);
    const next = await store.pruneRead([a]);
    expect(next.readIds[a]).toBeUndefined();
    expect(next.readIds[b]).toBe(true);
  });

  it('inbox delete prunes the durable marker', async () => {
    const [a, b] = await seed(2);
    await store.markAllRead([a, b]);
    await inbox.delete(a);
    await expect.poll(async () => (await store.getReadState()).readIds[a]).toBeUndefined();
    expect((await store.getReadState()).readIds[b]).toBe(true);
  });

  it('retention prune drops evicted markers', async () => {
    store.dispose();
    await rm(entriesPath, { force: true });
    const tight = createInboxStore({ filePath: entriesPath, maxEntries: 1, quietMaxEntries: 0 });
    store = createInboxReadStore({ filePath: readPath, inbox: tight });
    const first = await tight.append({ projectId: 'p1', comments: 'old' });
    await store.markRead(first.id);
    await tight.append({ projectId: 'p1', comments: 'new' });
    await tight.append({ projectId: 'p1', comments: 'newer' });
    await expect.poll(async () => (await store.getReadState()).readIds[first.id]).toBeUndefined();
    const live = await tight.listIds();
    expect(live).toHaveLength(1);
    await store.markRead(live[0]!);
    expect((await store.getReadState()).readIds[live[0]!]).toBe(true);
  });

  it('migrate writes once and is idempotent', async () => {
    const [a, b] = await seed(2);
    const first = await store.migrateCurrentOriginReadIds([a]);
    expect(first.migratedFromLocalStorage).toBe(true);
    expect(first.readIds[a]).toBe(true);
    const second = await store.migrateCurrentOriginReadIds([b]);
    expect(second.migratedFromLocalStorage).toBe(true);
    expect(second.readIds[a]).toBe(true);
    expect(second.readIds[b]).toBeUndefined();
  });

  it('migrate drops unknown ids and still sets the flag', async () => {
    const next = await store.migrateCurrentOriginReadIds(['nope']);
    expect(next.migratedFromLocalStorage).toBe(true);
    expect(next.readIds).toEqual({});
  });

  it('serializes concurrent RMW', async () => {
    const [a, b, c] = await seed(3);
    await Promise.all([store.markRead(a), store.markRead(b), store.markRead(c)]);
    const state = await store.getReadState();
    expect(state.readIds[a]).toBe(true);
    expect(state.readIds[b]).toBe(true);
    expect(state.readIds[c]).toBe(true);
  });

  it('getReadState intersects leftover orphans', async () => {
    const [a] = await seed(1);
    await writeFile(
      readPath,
      JSON.stringify({
        version: 1,
        migratedFromLocalStorage: false,
        readIds: { [a]: true, orphan: true }
      }),
      'utf-8'
    );
    const state = await store.getReadState();
    expect(state.readIds[a]).toBe(true);
    expect(state.readIds.orphan).toBeUndefined();
    const raw = JSON.parse(await readFile(readPath, 'utf-8')) as { readIds: Record<string, true> };
    expect(raw.readIds.orphan).toBeUndefined();
  });
});
