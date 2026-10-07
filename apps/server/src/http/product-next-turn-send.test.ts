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
import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';
import { signUiSend } from './ui-send-proof.js';

const uiSecret = 'desktop-only-boot-secret-of-at-least-32-bytes';

let server: ProductServer;
let dir: string;
let threadId: string;
let otherThreadId: string;
let provider: { unregister(): void };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-next-turn-http-'));
  server = await startProductServer({ dataDir: dir, uiSendSecret: uiSecret, origins: { serverPort: 0, devAppPort: 5173 } });
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
function send(id: string, callerHeaders?: Record<string, string>, body: unknown = {
  confirmed: true, expectedUpdatedAt: getDeferredThreadMessage(server.ctx.db, { threadId, id })?.updatedAt ?? 0
}) {
  return fetch(`${server.url}api/v1/threads/${threadId}/next-turn/${id}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...callerHeaders }, body: JSON.stringify(body)
  });
}
function uiSend(id: string) {
  return send(id, { 'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, id) });
}

function mobileSend(id: string, expectedUpdatedAt: number, body: unknown = { confirmed: true, expectedUpdatedAt }) {
  return fetch(`${server.url}api/v1/threads/${threadId}/next-turn/${id}/send`, {
    method: 'POST', headers: {
      'content-type': 'application/json', 'x-zcc-ui-send-surface': 'mobile',
      'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, id, Date.now(), 'mobile-ui')
    }, body: JSON.stringify(body)
  });
}

it('sends only the confirmed phone message while leaving its paused neighbors intact', async () => {
  const first = queue();
  const selected = queue();
  const response = await mobileSend(selected.id, selected.updatedAt);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toBeNull();
  expect(listDeferredThreadMessages(server.ctx.db, threadId)).toEqual([first]);
  expect(server.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalledOnce();
});

it.each(['desktop', 'phone'])('rejects changed %s confirmations without dispatching or altering the queued row', async surface => {
  const selected = queue();
  const response = surface === 'phone' ? await mobileSend(selected.id, selected.updatedAt - 1)
    : await send(selected.id, { 'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, selected.id) },
      { confirmed: true, expectedUpdatedAt: selected.updatedAt - 1 });
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: 'queued-send-changed' });
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it.each([{}, { confirmed: false, expectedUpdatedAt: 1 }, { confirmed: true }, { confirmed: true, expectedUpdatedAt: -1 }])('requires a valid phone confirmation body (%j)', async body => {
  const selected = queue();
  expect((await mobileSend(selected.id, selected.updatedAt, body)).status).toBe(400);
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it('requires the confirmed revision after native desktop approval', async () => {
  const selected = queue();
  const response = await send(selected.id, { 'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, selected.id) }, {});
  expect(response.status).toBe(400);
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it('cannot relabel a desktop proof as a phone approval', async () => {
  const selected = queue();
  const response = await send(selected.id, {
    'x-zcc-ui-send-surface': 'mobile', 'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, selected.id)
  });
  expect(response.status).toBe(403);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it('preserves a non-overrideable plugin wait after a verified phone confirmation', async () => {
  const selected = createDeferredThreadMessage(server.ctx.db, {
    threadId, kind: 'send', paused: true,
    payload: JSON.stringify({ kind: 'send', mode: 'auto', input: 'held prompt',
      admission: { generation: 1, overrideable: false, reason: 'policy' } })
  });
  const response = await mobileSend(selected.id, selected.updatedAt);
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ error: 'dispatch_not_overrideable' });
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).not.toBeNull();
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it('sends the selected stored prompt and broadcasts the remaining paused queue', async () => {
  const first = queue();
  const selected = queue();
  const emit = vi.spyOn(server.ctx.hub, 'emit');
  const response = await uiSend(selected.id);
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
  const response = await uiSend(foreign.id);
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({ error: 'unknown-queued-send' });
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(getDeferredThreadMessage(server.ctx.db, { threadId: otherThreadId, id: foreign.id })).toEqual(foreign);
});

it('surfaces host-offline errors without losing the selected message', async () => {
  const selected = queue();
  server.ctx.hostHub.connectedHostIds = () => [];
  const response = await uiSend(selected.id);
  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toMatchObject({ error: 'host_unavailable' });
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
});

it('rejects a forged caller-session credential (OBL-003) without sending or dropping the queued message', async () => {
  const selected = queue();
  const response = await send(selected.id, {
    'x-zcc-caller-session-id': 'session-not-real',
    'x-zcc-caller-credential': 'not-the-real-hmac'
  });
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: 'invalid_caller_credential' });
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
});

it('rejects even a valid agent-session HMAC and headerless desktop-looking calls', async () => {
  const selected = queue();
  const sessionId = 'session-real-1';
  const agent = await send(selected.id, {
    'x-zcc-caller-session-id': sessionId,
    'x-zcc-caller-credential': controlCredentialForSession(sessionId),
    'x-zcc-app-surface': 'desktop'
  });
  expect(agent.status).toBe(403);
  const forged = await send(selected.id, {
    origin: 'http://127.0.0.1:5173', 'x-zcc-app-surface': 'desktop'
  });
  expect(forged.status).toBe(403);
  expect((await send(selected.id)).status).toBe(403);
  expect(server.ctx.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(getDeferredThreadMessage(server.ctx.db, { threadId, id: selected.id })).toEqual(selected);
});

it('requires a fresh single-use desktop proof bound to the queued item and thread', async () => {
  const selected = queue();
  const proof = signUiSend(uiSecret, threadId, selected.id);
  const wrongItem = await send(queue().id, { 'x-zcc-ui-send-proof': proof });
  expect(wrongItem.status).toBe(403);
  const wrongThread = await fetch(`${server.url}api/v1/threads/${otherThreadId}/next-turn/${selected.id}/send`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zcc-ui-send-proof': proof }, body: '{}'
  });
  expect(wrongThread.status).toBe(403);
  expect((await send(selected.id, { 'x-zcc-ui-send-proof': signUiSend('wrong-secret', threadId, selected.id) })).status).toBe(403);
  expect((await send(selected.id, { 'x-zcc-ui-send-proof': signUiSend(uiSecret, threadId, selected.id, Date.now() - 31_000) })).status).toBe(403);
  const sent = await send(selected.id, { 'x-zcc-ui-send-proof': proof });
  expect(sent.status, await sent.clone().text()).toBe(200);
  expect((await send(selected.id, { 'x-zcc-ui-send-proof': proof })).status).toBe(403);
  expect(server.ctx.hostHub.callHostOnlineRpc).toHaveBeenCalledTimes(1);
});
