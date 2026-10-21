import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createConversationThread, createDeferredThreadMessage, createEnvironment, getDeferredThreadMessage,
  listDeferredThreadMessages, setConversationProviderThreadId, upsertHost
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer;
let dir: string;
let threadId: string;
let otherThreadId: string;
let provider: { unregister(): void };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-next-turn-edit-'));
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

function queue(input = 'original', target = threadId) {
  return createDeferredThreadMessage(server.ctx.db, {
    threadId: target, kind: 'send', payload: JSON.stringify({ kind: 'send', mode: 'queue-if-active', input })
  });
}
const url = (id: string, suffix = '', target = threadId) => `${server.url}api/v1/threads/${target}/next-turn/${id}${suffix}`;
const json = { 'content-type': 'application/json' };
const hold = (id: string, target = threadId) => fetch(url(id, '/edit-hold', target), { method: 'POST', headers: json });
const release = (id: string, target = threadId) => fetch(url(id, '/edit-hold', target), { method: 'DELETE', headers: json });
const save = (id: string, body: unknown, target = threadId) => fetch(url(id, '', target), {
  method: 'PATCH', headers: json, body: JSON.stringify(body)
});
const row = (id: string) => getDeferredThreadMessage(server.ctx.db, { id, threadId });
const sentText = () => JSON.stringify((server.ctx.hostHub.callHostOnlineRpc as ReturnType<typeof vi.fn>).mock.calls);

it('takes and renews a bounded lease through the API without changing the revision', async () => {
  const queued = queue();
  const first = await hold(queued.id);
  expect(first.status).toBe(200);
  const body = await first.json() as { ok: boolean; leaseMs: number; heldUntil: number };
  expect(body).toMatchObject({ ok: true, leaseMs: 120_000 });
  expect(body.heldUntil).toBeGreaterThan(Date.now() + 100_000);
  expect(body.heldUntil).toBeLessThanOrEqual(Date.now() + 120_000);
  expect(row(queued.id)).toMatchObject({ editHeldUntil: body.heldUntil, updatedAt: queued.updatedAt });
  expect((await hold(queued.id)).status).toBe(200);
});

it('keeps an edited message from being sent mid-edit, then sends the saved text on save', async () => {
  const queued = queue('original');
  await hold(queued.id);
  const drain = await fetch(`${server.url}api/v1/threads/${threadId}/next-turn/flush`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: false })
  });
  expect(drain.status).toBe(200);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(row(queued.id)).toMatchObject({ status: 'queued' });

  const saved = await save(queued.id, { text: 'edited text', expectedUpdatedAt: queued.updatedAt });
  expect(saved.status).toBe(200);
  const savedBody = await saved.json() as { ok: boolean; item: { id: string; text: string; updatedAt: number } };
  expect(savedBody).toMatchObject({ ok: true, item: { id: queued.id, text: 'edited text' } });
  expect(savedBody.item.updatedAt).toBeGreaterThan(queued.updatedAt);
  // The save wakes the queue; the thread is idle so the edited text goes out.
  await vi.waitFor(() => expect(server.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalled());
  expect(sentText()).toContain('edited text');
  expect(sentText()).not.toContain('original');
  await vi.waitFor(() => expect(row(queued.id)).toBeNull());
});

it('sends the unchanged text when the editor is cancelled', async () => {
  const queued = queue('keep this');
  await hold(queued.id);
  const released = await release(queued.id);
  expect(released.status).toBe(200);
  await expect(released.json()).resolves.toEqual({ ok: true });
  await vi.waitFor(() => expect(server.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalled());
  expect(sentText()).toContain('keep this');
});

it('answers release for an unheld, unknown or foreign row without error or side effects', async () => {
  const queued = queue();
  expect((await release(queued.id)).status).toBe(200);
  expect((await release('missing')).status).toBe(200);
  expect((await release(queued.id, otherThreadId)).status).toBe(200);
  expect((await release(queued.id, 'no-such-thread')).status).toBe(404);
  expect(row(queued.id)).toEqual(queued);
});

it('rejects hold and save with 404 for unknown threads, missing rows and rows of another thread', async () => {
  const foreign = queue('foreign', otherThreadId);
  for (const call of [
    () => hold(foreign.id), () => hold('missing'), () => hold(foreign.id, 'no-such-thread'),
    () => save(foreign.id, { text: 'x' }), () => save('missing', { text: 'x' }), () => save(foreign.id, { text: 'x' }, 'no-such-thread')
  ]) expect((await call()).status).toBe(404);
  expect(listDeferredThreadMessages(server.ctx.db, otherThreadId)).toEqual([foreign]);
});

it('answers 409 once the row has been claimed, without writing the edit', async () => {
  const queued = queue('original');
  await hold(queued.id);
  const sent = await fetch(`${server.url}api/v1/threads/${threadId}/next-turn/flush`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  expect(sent.status).toBe(200);
  // Force flush (Send all) claimed and delivered the row; its editor learns on the next renewal.
  expect((await hold(queued.id)).status).toBe(404);

  const inFlight = queue('in flight');
  server.ctx.db.sqlite.prepare("UPDATE deferred_thread_messages SET status = 'dispatching' WHERE id = ?").run(inFlight.id);
  const heldInFlight = await hold(inFlight.id);
  expect(heldInFlight.status).toBe(409);
  await expect(heldInFlight.json()).resolves.toMatchObject({ error: 'queued-send-dispatching' });
  expect((await save(inFlight.id, { text: 'late' })).status).toBe(409);
  expect(JSON.parse(row(inFlight.id)!.payload).input).toBe('in flight');
});

it('validates the edit body and the revision it confirms against', async () => {
  const queued = queue('original');
  for (const body of [{}, { text: 5 }, { text: '   ' }, { text: 'ok', expectedUpdatedAt: -1 }, { text: 'ok', expectedUpdatedAt: 'x' }, { text: 'ok', expectedUpdatedAt: 1.5 }]) {
    expect((await save(queued.id, body)).status, JSON.stringify(body)).toBe(400);
  }
  const tooLong = await save(queued.id, { text: 'x'.repeat(100_001) });
  expect(tooLong.status).toBe(413);
  // Past the body cap the route still answers with the edit's own code, not a host error.
  const oversized = await save(queued.id, { text: '\u001f'.repeat(110_000) });
  expect(oversized.status).toBe(413);
  await expect(oversized.json()).resolves.toMatchObject({ error: 'queued_message_too_long' });
  const stale = await save(queued.id, { text: 'ok', expectedUpdatedAt: queued.updatedAt - 1 });
  expect(stale.status).toBe(409);
  await expect(stale.json()).resolves.toMatchObject({ error: 'queued-send-changed' });
  // Fresh socket (Connection: close): reusing a keep-alive socket the server half-closed after the
  // prior stale-409 above races into a read ECONNRESET under parallel-suite load. The route always
  // answers with a status for malformed JSON, so the reset is purely a client socket-reuse flake.
  const malformed = await fetch(url(queued.id), { method: 'PATCH', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{not json' });
  expect(malformed.status).toBeGreaterThanOrEqual(400);
  expect(row(queued.id)).toEqual(queued);
});

it('accepts the longest allowed text even when every character is escaped in JSON', async () => {
  server.ctx.db.sqlite.prepare("UPDATE threads SET status = 'active' WHERE id = ?").run(threadId);
  const queued = queue('original');
  const saved = await save(queued.id, { text: `a${'\u001f'.repeat(99_999)}` });
  expect(saved.status).toBe(200);
  expect(JSON.parse(row(queued.id)!.payload).input).toHaveLength(100_000);
});

it('does not wake the queue for a save that leaves the thread busy', async () => {
  server.ctx.db.sqlite.prepare("UPDATE threads SET status = 'active' WHERE id = ?").run(threadId);
  const queued = queue('original');
  await hold(queued.id);
  expect((await save(queued.id, { text: 'edited' })).status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(JSON.parse(row(queued.id)!.payload).input).toBe('edited');
  expect(row(queued.id)).toMatchObject({ status: 'queued', editHeldUntil: null });
});
