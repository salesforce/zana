import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  archiveConversationThread, createConversationThread, createPendingInteraction,
  setPendingInteractionResolving, setPendingInteractionResolved, upsertHost
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | undefined;
let dir: string | undefined;
afterEach(async () => { await server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

it('counts all live and waiting Modern threads, including hidden agents, without roster limits', async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-quit-state-'));
  server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  const db = server.ctx.db;
  const host = upsertHost(db, { name: 'local', hostKeyHash: 'h'.repeat(64) });
  const count = async () => (await (await fetch(`${server!.url}api/v1/system/quit-state`)).json());
  expect(await count()).toEqual({ activeThreads: 0 });
  // The activity endpoint is read-only; other methods must not match it.
  expect((await fetch(`${server.url}api/v1/system/quit-state`, { method: 'HEAD' })).status).toBe(404);
  const make = (status: 'active' | 'starting' | 'stopping' | 'idle' | 'error', hidden = false) =>
    createConversationThread(db, { projectId: 'p', hostId: host.id, providerId: 'fake', status, visibility: hidden ? 'hidden' : 'visible' });
  for (let i = 0; i < 205; i++) make('active', true);
  make('starting'); make('stopping'); make('idle'); make('error');
  const archived = make('active'); archiveConversationThread(db, archived.id);
  expect(await count()).toEqual({ activeThreads: 207 });
  const waiting = make('idle');
  const interaction = createPendingInteraction(db, { originKind: 'plugin', threadId: waiting.id, pluginId: 'test', rendererId: 'test', payload: '{}' });
  expect(await count()).toEqual({ activeThreads: 208 });
  setPendingInteractionResolving(db, { id: interaction.id, resolution: '{}' });
  expect(await count()).toEqual({ activeThreads: 208 });
  setPendingInteractionResolved(db, { id: interaction.id, resolution: '{}' });
  expect(await count()).toEqual({ activeThreads: 207 });
});
