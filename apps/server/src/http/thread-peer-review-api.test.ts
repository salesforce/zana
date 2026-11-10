import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createConversationThread, createEnvironment, upsertHost, listDeferredThreadMessages } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { signUiSend } from './ui-send-proof.js';
import { invokeThreadPeerTool, threadPeerCaller } from '../services/threads/thread-peer-communication.js';

const secret = 'peer-review-desktop-secret-with-32-bytes';
let dir: string, server: ProductServer, sender: string, target: string, id: string;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-peer-review-api-'));
  server = await startProductServer({ dataDir: dir, uiSendSecret: secret, origins: { serverPort: 0, devAppPort: 5173 } });
  const host = upsertHost(server.ctx.db, { name: 'host', hostKeyHash: 'p'.repeat(64) });
  const env = createEnvironment(server.ctx.db, { projectId: 'p', hostId: host.id, path: dir });
  const add = () => createConversationThread(server.ctx.db, { projectId: 'p', hostId: host.id, environmentId: env.id, providerId: 'test', status: 'active' }).id;
  sender = add(); target = add();
  id = (await invokeThreadPeerTool(server.ctx, threadPeerCaller(server.ctx, sender), 'agent_send', { to: target, message: 'Review the exact body' }) as { id: string }).id;
});
afterEach(async () => { await server.close(); rmSync(dir, { recursive: true, force: true }); });
const path = (owner = target) => `api/v1/threads/${owner}/peer-messages`;
const list = async () => (await fetch(new URL(path(), server.url))).json();
const send = (proof?: string, body: unknown = { confirmed: true, expectedUpdatedAt: 1 }, owner = target) => fetch(new URL(`${path(owner)}/${id}/send`, server.url), {
  method: 'POST', headers: { 'content-type': 'application/json', ...(proof ? { 'x-zcc-ui-send-proof': proof } : {}) }, body: JSON.stringify(body)
});
it('returns human review state without placing content in model context, mailbox or runnable queue', async () => {
  expect(await list()).toMatchObject({ enabled: true, paused: false, items: [{ id, text: 'Review the exact body', status: 'pending', updatedAt: 1 }] });
  expect(listDeferredThreadMessages(server.ctx.db, target)).toEqual([]);
  expect(await invokeThreadPeerTool(server.ctx, threadPeerCaller(server.ctx, target), 'agent_inbox', {})).toEqual([]);
  expect(server.ctx.db.sqlite.prepare("SELECT 1 FROM thread_events WHERE thread_id = ? AND type IN ('client/turn/requested','peer/message/received')").get(target)).toBeUndefined();
});
it('refuses unsigned, foreign, expired, wrong-key and replayed confirmation proofs', async () => {
  for (const proof of [undefined, signUiSend(secret, sender, id), signUiSend('wrong-secret-with-enough-length-xxxx', target, id), signUiSend(secret, target, id, Date.now() - 31_000)]) {
    expect((await send(proof)).status).toBe(403);
  }
  const proof = signUiSend(secret, target, id);
  expect((await send(proof)).status).toBe(200);
  expect((await send(proof)).status).toBe(403);
  expect(listDeferredThreadMessages(server.ctx.db, target)).toHaveLength(1);
  expect((await send(signUiSend(secret, sender, id), undefined, sender)).status).toBe(404);
});
it('requires a current message revision and an explicit confirmation', async () => {
  for (const body of [{}, { confirmed: true }, { confirmed: true, expectedUpdatedAt: '1' }]) {
    expect((await send(signUiSend(secret, target, id), body)).status).toBe(400);
  }
  expect((await send(signUiSend(secret, target, id), { confirmed: true, expectedUpdatedAt: 2 })).status).toBe(409);
  expect(listDeferredThreadMessages(server.ctx.db, target)).toEqual([]);
});
it('honors the default-on switch and keeps pending content held across off/on', async () => {
  server.ctx.config.setConfig({ threadCommunicationEnabled: false });
  expect((await send(signUiSend(secret, target, id))).status).toBe(409);
  expect(await list()).toMatchObject({ enabled: false, items: [{ status: 'pending' }] });
  server.ctx.config.setConfig({ threadCommunicationEnabled: true });
  expect((await list()).items[0].status).toBe('pending');
  expect(listDeferredThreadMessages(server.ctx.db, target)).toEqual([]);
});
it('allows discard while disabled and rejects unavailable threads and unsupported methods', async () => {
  server.ctx.config.setConfig({ threadCommunicationEnabled: false });
  const discard = () => fetch(new URL(`${path()}/${id}`, server.url), { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedUpdatedAt: 1 }) });
  expect((await discard()).status).toBe(200); expect((await discard()).status).toBe(200);
  expect((await list()).items).toEqual([]);
  expect((await fetch(new URL(path('missing'), server.url))).status).toBe(404);
  expect((await fetch(new URL(path(), server.url), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(405);
});
