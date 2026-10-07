import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import WebSocket from 'ws';
import { appendConversationThreadEvent, createConversationThread, createEnvironment, getConversationThread, getThreadTabs, replaceThreadTabs, openHostSession, upsertHost } from '@zana-ai/zcc-db';
import { HOST_RPC_PROTOCOL_VERSION, type HostEventEnvelope, type HostRuntimeSnapshot } from '@zana-ai/zcc-contracts/host-rpc';
import { startProductServer } from './product-server.js';
import { hashHostKey } from './host-hub.js';
import { createHostServerSocket } from '../../../host-daemon/src/server-socket.js';
import { healDisconnectedConversationThreadsForHost } from '../services/threads/conversation-host-recovery.js';
import * as plans from '../services/threads/conversation-plan.js';

const key = 'fixture-key-with-enough-characters';
let dir: string, server: Awaited<ReturnType<typeof startProductServer>>;
let hostId: string, instanceId: string, environmentId: string;
let connections: ReturnType<typeof createHostServerSocket>[];
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-reconnect-'));
  server = await startProductServer({ dataDir: dir, origins: { serverPort: 0, devAppPort: 5173 } });
  const host = upsertHost(server.ctx.db, { name: 'fixture', hostKeyHash: hashHostKey(key), isPrimary: false });
  hostId = host.id; instanceId = randomUUID(); connections = [];
  openHostSession(server.ctx.db, { hostId, instanceId, hostName: host.name });
  environmentId = createEnvironment(server.ctx.db, { projectId: 'fixture', hostId, path: dir }).id;
});
afterEach(async () => { vi.restoreAllMocks(); connections.forEach(c => c.close()); await server.close(); rmSync(dir, { recursive: true, force: true }); });
function connect(overrides: Partial<Parameters<typeof createHostServerSocket>[0]> = {}) {
  const c = createHostServerSocket({ serverUrl: server.url, hostId, hostKey: key, instanceId,
    onHello: async () => {}, onMessage: () => {}, onConnectionChange: () => {}, ...overrides });
  void c.ready.catch(() => {}); connections.push(c); return c;
}
function thread(status: 'active' | 'stopping' | 'error' | 'idle') {
  return createConversationThread(server.ctx.db, { projectId: 'fixture', hostId, environmentId, providerId: 'fake', status });
}

async function eventHost() {
  const acks: Array<{ type: string; batchId?: string; accepted?: number }> = [];
  const connection = connect({ onMessage: raw => { acks.push(raw as typeof acks[number]); } });
  await connection.ready;
  return async (events: HostEventEnvelope[], batchId = randomUUID()) => {
    expect(connection.send(JSON.stringify({ type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId, instanceId, batchId, events }))).toBe(true);
    await vi.waitFor(() => expect(acks.find(ack => ack.type === 'host.event-ack' && ack.batchId === batchId)?.accepted).toBe(events.length));
    return batchId;
  };
}

it('adopts an orphaned browser tab through authenticated host RPC and emits after the event transaction', async () => {
  const live = thread('idle');
  const oldWindow = randomUUID(), currentWindow = randomUUID(), generation = randomUUID();
  const tabId = 'browser:recovery-tab';
  replaceThreadTabs(server.ctx.db, {
    threadId: live.id, expectedRevision: 0,
    tabsJson: JSON.stringify([{ id: tabId, kind: 'browser', environmentId: null, title: 'Old', url: 'about:blank',
      desktopTarget: { hostId, instanceId: oldWindow, generation: 'old-generation' } }])
  });
  const updates: unknown[] = [];
  const stop = server.ctx.hub.subscribe('threads:tabs', value => updates.push(value));
  const batchId = randomUUID();
  let ack: unknown;
  const commands: string[] = [];
  let connection!: ReturnType<typeof createHostServerSocket>;
  connection = connect({ onMessage: raw => {
    const message = raw as { type: string; batchId?: string; requestId?: string; command?: { type: string } };
    if (message.batchId === batchId) ack = message;
    if (message.type !== 'host-rpc.request') return;
    commands.push(message.command!.type);
    connection.send(JSON.stringify({ type: 'host-rpc.response', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId: message.requestId, commandType: message.command!.type, ok: true,
      result: { instances: [{ instanceId: currentWindow, generation, label: 'Current' }] }
    }));
  } });
  try {
    await connection.ready;
    connection.send(JSON.stringify({ type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId, instanceId, batchId, events: [{ kind: 'desktop.browser.changed', threadId: live.id,
        payload: { type: 'desktop-browser.changed', instanceId: currentWindow, generation, threadId: live.id, tabs: [{ tabId, threadId: live.id,
          title: 'Recovered', url: 'https://example.test/', control: null,
          profile: { kind: 'automation', id: 'recovery-profile' }, presentation: 'hidden' }] }
      }]
    }));
    await vi.waitFor(() => expect(ack).toMatchObject({ accepted: 1, rejected: [] }));
    await vi.waitFor(() => expect(updates).toContainEqual(expect.objectContaining({ threadId: live.id, revision: 2 })));
    const saved = getThreadTabs(server.ctx.db, live.id)!;
    expect(saved.revision).toBe(2);
    expect(JSON.parse(saved.tabsJson)[0]).toMatchObject({ title: 'Recovered', url: 'https://example.test/',
      desktopTarget: { hostId, instanceId: currentWindow, generation } });
    expect(commands).toEqual(['desktop.browser.list_instances']);
  } finally {
    stop();
  }
});

it('rejects completed-item events outside the authenticated host without reconciling their plans', async () => {
  const other = upsertHost(server.ctx.db, { name: 'other-event-host', hostKeyHash: hashHostKey('other-event-key') });
  const foreign = createConversationThread(server.ctx.db, { projectId: 'fixture', hostId: other.id, providerId: 'fake', status: 'active' });
  const sync = vi.spyOn(plans, 'syncPlanFromLatestEvents');
  const batchId = randomUUID();
  let acknowledgement: unknown;
  // The public host protocol must reject this even though the thread exists.
  const sender = connect({ onMessage: raw => {
    if ((raw as { batchId?: string }).batchId === batchId) acknowledgement = raw;
  } });
  await sender.ready;
  sender.send(JSON.stringify({ type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    hostId, instanceId, batchId, events: [{ threadId: foreign.id, kind: 'thread.event',
      payload: { type: 'item/completed', item: { type: 'plan', text: '# Foreign draft' } } }] }));
  await vi.waitFor(() => expect(acknowledgement).toMatchObject({ accepted: 0, rejected: [{ index: 0, reason: 'unknown_thread' }] }));
  expect(sync).not.toHaveBeenCalled();
  expect(server.ctx.db.sqlite.prepare('SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = ?').get(foreign.id)).toEqual({ count: 0 });
});

it('256 unrelated deltas never scan completed history or update plan tasks', async () => {
  const post = await eventHost(), live = thread('active');
  for (let index = 0; index < 400; index++) appendConversationThreadEvent(server.ctx.db, {
    threadId: live.id, type: 'item/completed', payload: { type: 'item/completed', scope: { turnId: 'old' },
      item: { id: `command-${index}`, type: 'commandExecution', aggregatedOutput: 'x'.repeat(16_384) } }
  });
  plans.importProviderPlanSteps(server.ctx.db, { threadId: live.id, steps: [{ step: 'Keep progress', status: 'in_progress' }] });
  const prepare = vi.spyOn(server.ctx.db.sqlite, 'prepare');
  const sync = vi.spyOn(plans, 'syncPlanFromLatestEvents');
  await post(Array.from({ length: 256 }, (_, index) => ({ threadId: live.id, kind: 'thread.event', payload: {
    type: 'item/agentMessage/delta', itemId: 'reply', delta: String(index), scope: { kind: 'turn', turnId: 'next' }
  } })));
  expect(sync).not.toHaveBeenCalled();
  expect(prepare.mock.calls.some(([sql]) => sql.includes('payload_bytes'))).toBe(false);
  expect(prepare.mock.calls.some(([sql]) => /(?:UPDATE|INSERT INTO|DELETE FROM) thread_plan_tasks/.test(sql))).toBe(false);
});

it('reconciles each affected thread once per batch and captures at the terminal boundary', async () => {
  const post = await eventHost(), first = thread('active'), second = thread('active');
  const sync = vi.spyOn(plans, 'syncPlanFromLatestEvents');
  const events: HostEventEnvelope[] = [first, second].flatMap(live => [
    { kind: 'thread.event', threadId: live.id, payload: { type: 'client/turn/requested', execution: { acpMode: 'plan' }, input: [{ type: 'text', text: 'Write a plan' }] } },
    { kind: 'thread.event', threadId: live.id, payload: { type: 'turn/started', scope: { kind: 'turn', turnId: live.id } } },
    { kind: 'thread.event', threadId: live.id, payload: { type: 'item/completed', scope: { kind: 'turn', turnId: live.id }, item: { id: 'reply', type: 'agentMessage', text: '# Captured plan\n\nImplement the requested converter.' } } },
    { kind: 'turn.completed', threadId: live.id, payload: { type: 'turn/completed', scope: { kind: 'turn', turnId: live.id }, status: 'completed' } }
  ]);
  const batchId = await post(events);
  expect(sync.mock.calls.map(([, id]) => id)).toEqual([first.id, second.id]);
  for (const live of [first, second]) expect(plans.getDurableThreadPlanView(server.ctx.db, live.id)).toMatchObject({ revision: 1, markdown: '# Captured plan\n\nImplement the requested converter.' });
  await post(events, batchId);
  expect(sync).toHaveBeenCalledTimes(2);
});

it('captures a planning reply when completion arrives in a later batch and protects a user revision', async () => {
  const post = await eventHost(), live = thread('active');
  plans.recordThreadExecutionMode(server.ctx.db, { threadId: live.id, requestedMode: 'plan' });
  await post([{ kind: 'thread.event', threadId: live.id, payload: { type: 'turn/started', scope: { turnId: 'planning' } } },
    { kind: 'thread.event', threadId: live.id, payload: { type: 'item/completed', scope: { turnId: 'planning' }, item: { type: 'agentMessage', text: '# Late-boundary plan' } } }]);
  expect(plans.getDurableThreadPlanView(server.ctx.db, live.id)?.markdown).toBeNull();
  await post([{ kind: 'thread.event', threadId: live.id, payload: { type: 'turn/completed', scope: { turnId: 'planning' }, status: 'completed' } }]);
  expect(plans.getDurableThreadPlanView(server.ctx.db, live.id)).toMatchObject({ revision: 1, markdown: '# Late-boundary plan' });
  plans.snapshotApprovedPlan(server.ctx.db, { threadId: live.id, markdown: '# User correction', source: 'user' });
  await post([{ kind: 'thread.event', threadId: live.id, payload: { type: 'item/completed', scope: { turnId: 'ordinary' }, item: { type: 'plan', text: '# Stale native draft' } } }]);
  expect(plans.getDurableThreadPlanView(server.ctx.db, live.id)).toMatchObject({ revision: 2, markdown: '# User correction' });
});

it('acknowledges authoritative events when advisory plan reconciliation fails', async () => {
  const post = await eventHost(), live = thread('active');
  vi.spyOn(plans, 'syncPlanFromLatestEvents').mockImplementation(() => { throw new Error('advisory import failed'); });
  await post([{ kind: 'thread.event', threadId: live.id, payload: { type: 'item/completed', item: { type: 'plan', text: '# Plan' } } }]);
  expect(server.ctx.db.sqlite.prepare('SELECT COUNT(*) AS count FROM thread_events WHERE thread_id = ?').get(live.id)).toMatchObject({ count: 1 });
});

it('delivers pending Stop only after reconciliation and readiness, including beyond disconnect grace', async () => {
  const stopping = thread('stopping');
  healDisconnectedConversationThreadsForHost(server.ctx.db, server.ctx.hub, hostId);
  let finish!: () => void;
  const received: string[] = [];
  const c = connect({ onHello: () => new Promise<void>(resolve => { finish = resolve; }),
    onMessage: (raw, reply) => {
      const message = raw as any; received.push(message.command.type);
      reply(JSON.stringify({ type: 'host-rpc.response', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        requestId: message.requestId, commandType: 'thread.stop', ok: true, result: { threadId: stopping.id, stopped: true } }));
    } });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(server.ctx.hostHub.connectedHostIds()).not.toContain(hostId);
  expect(received).toEqual([]);
  finish(); await c.ready;
  await vi.waitFor(() => expect(getConversationThread(server.ctx.db, stopping.id)?.status).toBe('idle'));
  expect(received).toEqual(['thread.stop']);
});

it('a superseded daemon releases ownership instead of reclaiming the host', async () => {
  const hellos = [0, 0], terminated = vi.fn();
  const first = connect({ onHello: async () => { hellos[0]++; }, onTerminated: terminated });
  await first.ready;
  const replacementId = randomUUID();
  await connect({ instanceId: replacementId, onHello: async () => { hellos[1]++; } }).ready;
  await vi.waitFor(() => expect(terminated).toHaveBeenCalledOnce());
  await new Promise(resolve => setTimeout(resolve, 2300));
  expect(hellos).toEqual([1, 1]);
  expect(server.ctx.hostHub.getSession(hostId)?.instanceId).toBe(replacementId);
});

it('reconciles running, completed, failed and missing work from the same lifetime after grace expires', async () => {
  const first = connect(); await first.ready;
  const running = thread('active'), completed = thread('active'), failed = thread('active'), missing = thread('active');
  first.close(); await vi.waitFor(() => expect(server.ctx.hostHub.connectedHostIds()).not.toContain(hostId));
  healDisconnectedConversationThreadsForHost(server.ctx.db, server.ctx.hub, hostId);
  expect(getConversationThread(server.ctx.db, running.id)?.status).toBe('error');
  const runtime: HostRuntimeSnapshot = { loadedEnvironments: [environmentId], threads: [
    { threadId: running.id, status: 'active' }, { threadId: completed.id, status: 'idle' }, { threadId: failed.id, status: 'error' }
  ] };
  await connect({ getRuntimeSnapshot: () => runtime }).ready;
  expect([running, completed, failed, missing].map(t => getConversationThread(server.ctx.db, t.id)?.status)).toEqual(['active', 'idle', 'error', 'error']);
});

it('does not restore old work from a different process or mutate another host', async () => {
  const running = thread('active');
  const otherHost = upsertHost(server.ctx.db, { name: 'other', hostKeyHash: hashHostKey('other'), isPrimary: false });
  const foreign = createConversationThread(server.ctx.db, { projectId: 'fixture', hostId: otherHost.id, providerId: 'fake', status: 'error' });
  await connect({ instanceId: randomUUID(), getRuntimeSnapshot: () => ({ loadedEnvironments: [environmentId], threads: [
    { threadId: running.id, status: 'active' }, { threadId: foreign.id, status: 'active' }
  ] }) }).ready;
  expect(getConversationThread(server.ctx.db, running.id)?.status).toBe('error');
  expect(getConversationThread(server.ctx.db, foreign.id)?.status).toBe('error');
});

it.each(['malformed', 'wrong-lifetime'] as const)('rejects %s readiness without publishing the machine', async kind => {
  const url = new URL('internal/hosts/ws', server.url); url.protocol = 'ws:';
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${key}`, 'x-zcc-host-id': hostId } });
  try {
    await once(socket, 'open');
    const hello = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'host.hello', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId }));
    await hello;
    const closed = once(socket, 'close');
    socket.send(kind === 'malformed' ? 'invalid JSON' : JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId, instanceId: randomUUID(), runtime: { threads: [], loadedEnvironments: [] } }));
    expect((await closed)[0]).toBe(4002);
    expect(server.ctx.hostHub.connectedHostIds()).not.toContain(hostId);
  } finally { socket.terminate(); }
});
