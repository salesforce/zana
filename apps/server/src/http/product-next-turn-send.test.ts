import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createConversationThread, createDeferredThreadMessage, createEnvironment,
  getDeferredThreadMessage, listDeferredThreadMessages, setConversationProviderThreadId, upsertHost
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer;
let dir: string;
let threadId: string;
let otherThreadId: string;
let provider: { unregister(): void };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-next-turn-http-'));
  server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  provider = registerThreadProvider('test', {
    id: 'codex', displayName: 'Codex',
    capabilities: { supportsServiceTier: false, fork: 'checkpoint', supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['full'] }
  });
  server.ctx.pluginHostArtifacts.set('test', { path: '/tmp/host.js', digest: 'a'.repeat(64), byteLength: 12, generation: 'g1' });
  const host = upsertHost(server.ctx.db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(server.ctx.db, { projectId: 'p', hostId: host.id, path: dir });
  const create = () => createConversationThread(server.ctx.db, {
    projectId: 'p', hostId: host.id, environmentId: environment.id, providerId: 'codex', status: 'idle'
  });
  threadId = create().id;
  otherThreadId = create().id;
  setConversationProviderThreadId(server.ctx.db, threadId, 'provider-thread');
  server.ctx.hostHub.connectedHostIds = () => [host.id];
  server.ctx.hostHub.callHostOnlineRpc = vi.fn(async () => ({ accepted: true }));
});
afterEach(async () => {
  await server.close();
  provider.unregister();
  rmSync(dir, { recursive: true, force: true });
});

function queue(target = threadId) {
  return createDeferredThreadMessage(server.ctx.db, {
    threadId: target, kind: 'send', paused: true,
    payload: JSON.stringify({ kind: 'send', mode: 'queue-if-active', input: 'selected message' })
  });
}
function send(id: string) {
  return fetch(`${server.url}api/v1/threads/${threadId}/next-turn/${id}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
}

it('sends the selected stored prompt and broadcasts the remaining paused queue', async () => {
  const first = queue();
  const selected = queue();
  const emit = vi.spyOn(server.ctx.hub, 'emit');
  const response = await send(selected.id);
  expect(response.status, await response.clone().text()).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
  expect(server.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
    command: expect.objectContaining({
      type: 'turn.submit', threadId, mode: 'start',
      input: [{ type: 'text', text: 'selected message', mentions: [] }]
    })
  }));
  expect(listDeferredThreadMessages(server.ctx.db, threadId)).toEqual([first]);
  expect(emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({ id: threadId }));
  const remaining = await fetch(`${server.url}api/v1/threads/${threadId}/next-turn`).then((res) => res.json());
  expect(remaining).toMatchObject({ paused: true, items: [{ id: first.id }] });
});

it('rejects a queued message belonging to another thread', async () => {
  const foreign = queue(otherThreadId);
  const response = await send(foreign.id);
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({ error: 'unknown-queued-send' });
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(getDeferredThreadMessage(server.ctx.db, { threadId: otherThreadId, id: foreign.id })).toEqual(foreign);
});

it('surfaces host-offline errors without losing the selected message', async () => {
  const selected = queue();
  server.ctx.hostHub.connectedHostIds = () => [];
  const response = await send(selected.id);
  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toMatchObject({ error: 'host_unavailable' });
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
});
