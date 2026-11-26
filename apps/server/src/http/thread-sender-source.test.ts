import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createConversationThread, createEnvironment, getConversationThread, updateConversationThreadTitle, upsertHost
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { threadSenderAttribution, withSenderContext } from './thread-sender-source.js';

const calls = vi.hoisted(() => ({ create: [] as unknown[], send: [] as unknown[][] }));

vi.mock('../services/threads/conversation-create.js', async (importActual) => {
  const actual = await importActual<typeof import('../services/threads/conversation-create.js')>();
  return {
    ...actual,
    createConversationFromRequest: vi.fn(async (_ctx: unknown, input: unknown) => {
      calls.create.push(input);
      return getConversationThread((_ctx as ProductServer['ctx']).db, senderId)!;
    })
  };
});
vi.mock('../services/threads/conversation-lifecycle.js', async (importActual) => {
  const actual = await importActual<typeof import('../services/threads/conversation-lifecycle.js')>();
  return {
    ...actual,
    sendConversationTurn: vi.fn(async (ctx: ProductServer['ctx'], id: string, ...rest: unknown[]) => {
      calls.send.push([id, ...rest]);
      return getConversationThread(ctx.db, id)!;
    })
  };
});

let server: ProductServer;
let dir: string;
let senderId: string;
let targetId: string;

beforeEach(async () => {
  calls.create.length = 0;
  calls.send.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'zcc-thread-sender-'));
  server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  const host = upsertHost(server.ctx.db, { name: 'test', hostKeyHash: 'h'.repeat(64) });
  const environment = createEnvironment(server.ctx.db, { projectId: 'p', hostId: host.id, path: dir });
  const create = () => createConversationThread(server.ctx.db, {
    projectId: 'p', hostId: host.id, environmentId: environment.id, providerId: 'codex', status: 'idle'
  }).id;
  senderId = create();
  targetId = create();
  updateConversationThreadTitle(server.ctx.db, senderId, 'Release\u202e checks\nbranch');
});
afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function post(path: string, body: unknown) {
  return fetch(`${server.url}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
}

const expectedSource = () => ({
  pluginId: 'sdk', kind: 'thread', label: 'Release checks branch', threadId: senderId
});

it('labels a thread another agent spawned with the sending thread, like a bot message', async () => {
  const response = await post('api/v1/threads', { projectId: 'p', prompt: 'Read the brief', fromThreadId: senderId, origin: 'sdk' });
  expect(response.status, await response.clone().text()).toBe(201);
  expect(calls.create[0]).toMatchObject({
    messageSource: { ...expectedSource(), detail: 'started this thread' },
    promptInput: [
      { type: 'text', text: `[From thread Release checks branch (${senderId})]`, visibility: 'agent-only' },
      { type: 'text', text: 'Read the brief' }
    ]
  });
});

it('labels a thread tell from another agent thread', async () => {
  const response = await post(`api/v1/threads/${targetId}/send`, { text: 'status?', mode: 'auto', fromThreadId: senderId });
  expect(response.status, await response.clone().text()).toBe(200);
  const [id, input, , , options] = calls.send[0]!;
  expect(id).toBe(targetId);
  expect(input).toEqual([
    { type: 'text', text: `[From thread Release checks branch (${senderId})]`, mentions: [], visibility: 'agent-only' },
    { type: 'text', text: 'status?', mentions: [] }
  ]);
  expect(options).toEqual({ messageSource: { ...expectedSource(), detail: 'messaged' } });
});

it('leaves operator sends and unknown or self senders unlabeled', async () => {
  await post(`api/v1/threads/${targetId}/send`, { text: 'plain' });
  await post(`api/v1/threads/${targetId}/send`, { text: 'ghost', fromThreadId: 'not-a-thread' });
  await post(`api/v1/threads/${targetId}/send`, { text: 'self', fromThreadId: targetId });
  await post('api/v1/threads', { projectId: 'p', prompt: 'hi', fromThreadId: 42 });
  for (const call of calls.send) expect(call[4]).toEqual({});
  expect(calls.send.map(call => call[1])).toEqual(['plain', 'ghost', 'self']);
  expect(calls.create[0]).not.toHaveProperty('messageSource');
});

it('falls back to a generic label and omits the link for hidden or untitled senders', () => {
  const hidden = createConversationThread(server.ctx.db, {
    projectId: 'p', hostId: getConversationThread(server.ctx.db, senderId)!.hostId,
    environmentId: getConversationThread(server.ctx.db, senderId)!.environmentId!, providerId: 'codex', status: 'idle', visibility: 'hidden'
  });
  expect(threadSenderAttribution(server.ctx.db, ` ${hidden.id} `, 'messaged').messageSource).toEqual({
    pluginId: 'sdk', kind: 'thread', label: 'A thread', detail: 'messaged'
  });
  updateConversationThreadTitle(server.ctx.db, senderId, 'x'.repeat(120));
  expect(threadSenderAttribution(server.ctx.db, senderId, 'messaged').messageSource?.label).toBe(`${'x'.repeat(79)}…`);
  expect(threadSenderAttribution(server.ctx.db, '', 'messaged')).toEqual({});
  expect(threadSenderAttribution(server.ctx.db, 'x'.repeat(201), 'messaged')).toEqual({});
  expect(threadSenderAttribution({ prepare() { throw new Error('closed'); } } as never, senderId, 'messaged')).toEqual({});
});

it('prepends the agent-only header to every input shape it understands', () => {
  const attribution = { agentContext: '[From thread A (t)]' };
  const header = { type: 'text', text: '[From thread A (t)]', mentions: [], visibility: 'agent-only' };
  expect(withSenderContext('hi', {})).toBe('hi');
  expect(withSenderContext('hi', attribution)).toEqual([header, { type: 'text', text: 'hi', mentions: [] }]);
  const part = { type: 'image', path: '/a.png' };
  expect(withSenderContext(['hi', part], attribution)).toEqual([header, { type: 'text', text: 'hi', mentions: [] }, part]);
  expect(withSenderContext(undefined, attribution)).toBeUndefined();
});
