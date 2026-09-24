import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendConversationThreadEvent, archiveConversationThread, createConversationThread, createEnvironment, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { createPluginApi } from './plugin-api.js';

let dir: string;
let db: ZccDatabase;
let hostId: string;
let environmentId: string;
let handle: ReturnType<typeof createPluginApi>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plugin-thread-search-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  environmentId = createEnvironment(db, { projectId: 'p', hostId, path: dir, workspaceProvisionType: 'unmanaged', status: 'ready' }).id;
  handle = createPluginApi('test', dir, { productContext: { db } as never });
});
afterEach(async () => { await handle.dispose(); db.close(); rmSync(dir, { recursive: true, force: true }); });
const create = (title: string, visibility: 'visible' | 'hidden' = 'visible') =>
  createConversationThread(db, { projectId: 'p', hostId, environmentId, providerId: 'codex', title, visibility });

it('finds older archived conversation content beyond the first 500 threads', async () => {
  for (let i = 0; i < 505; i++) create(`Unrelated ${i}`);
  const archived = create('Archived worker');
  archiveConversationThread(db, archived.id);
  appendConversationThreadEvent(db, { threadId: archived.id, type: 'client/turn/requested', payload: { prompt: ['the sapphire milestone'] } });
  const active = create('Sapphire active worker');
  create('Sapphire hidden worker', 'hidden');
  expect(await handle.api.sdk.threads.search({ query: 'sapphire', archived: true })).toMatchObject([{ id: archived.id, title: 'Archived worker', archivedAt: expect.any(Number) }]);
  expect(await handle.api.sdk.threads.search({ query: 'sapphire', archived: false })).toMatchObject([{ id: active.id }]);
  expect(await handle.api.sdk.threads.search({ query: 'sapphire' })).toHaveLength(2);
  expect(await handle.api.sdk.threads.search({ query: 'not present' })).toEqual([]);
});

it('bounds search results, keeps literal wildcard text, and orders recent threads first', async () => {
  for (let i = 0; i < 30; i++) create(`Worker ${i}`);
  const latest = create('100%_complete');
  db.sqlite.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(Date.now() + 1000, latest.id);
  expect(await handle.api.sdk.threads.search({ query: '', limit: 10000 })).toHaveLength(25);
  expect(await handle.api.sdk.threads.search({ query: '', limit: NaN })).toHaveLength(25);
  expect(await handle.api.sdk.threads.search({ query: '', limit: -1 })).toMatchObject([{ id: latest.id }]);
  expect(await handle.api.sdk.threads.search({ query: '%_' })).toMatchObject([{ id: latest.id }]);
  await handle.dispose();
  await expect(handle.api.sdk.threads.search({ query: '' })).rejects.toThrow();
});

it('requires the product database', async () => {
  const bare = createPluginApi('bare', dir);
  try {
    await expect(bare.api.sdk.threads.search({ query: 'worker' })).rejects.toThrow(/not available/);
  } finally { await bare.dispose(); }
});
