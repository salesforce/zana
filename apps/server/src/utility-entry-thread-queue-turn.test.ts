import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
const h = vi.hoisted(() => ({ context: vi.fn(), send: vi.fn(), row: vi.fn(), live: vi.fn() }));
vi.mock('./services/threads/thread-reads.js', () => ({ prepareThreadReads: async () => undefined }));
vi.mock('./services/threads/conversation-lifecycle.js', () => ({ sendConversationTurn: h.send }));
vi.mock('@zana-ai/zcc-db', async original => ({ ...await original<Record<string, unknown>>(), getConversationThread: h.row }));
vi.mock('./services/agents/thread-liveness.js', () => ({ isThreadLiveInProject: h.live }));
vi.mock('./http/product-context.js', async original => ({ ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: h.context }));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: () => ({ stop() {} }),
  startAttachedProductPluginService: async () => undefined
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: async () => undefined }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class {
  refreshHostConnection() { return Promise.resolve(); }
} }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {} }));

it('queues a turn into a live thread and reports not-live, queued, sent and failures', async () => {
  const { ThreadCreateError } = await import('./http/thread-create.js');
  const root = await mkdtemp(join(tmpdir(), 'utility-queue-turn-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const ask = async () => {
    const id = randomUUID();
    parent.emit('message', { data: { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(), id,
      operation: 'thread-queue-turn', threadId: 't1', projectId: 'p1', text: 'go' } });
    await vi.waitFor(() => expect(parent.postMessage.mock.calls.some(([m]) => m.id === id)).toBe(true));
    return parent.postMessage.mock.calls.find(([m]) => m.id === id)![0].value;
  };
  try {
    await import('./utility-entry.js');
    // No product context yet.
    expect(await ask()).toEqual({ ok: false, reason: 'not-live' });

    h.context.mockReturnValue({ hub: { subscribe: () => () => undefined }, db: {}, origins: {}, dispose() {} });
    parent.emit('message', { data: { type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      dataDir: root, rendererRoot: root, version: '0.0.0-test', hostUrl: 'http://127.0.0.1:1',
      hostToken: 't'.repeat(32), hostSigningKey: 's'.repeat(32),
      hostBinding: { hostId: randomUUID(), instanceId: randomUUID() } } });
    await vi.waitFor(() => expect(h.context).toHaveBeenCalled());
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    expect(parent.postMessage.mock.calls.some(([m]) => m.type === 'error')).toBe(false);

    h.live.mockReturnValue(false);
    expect(await ask()).toEqual({ ok: false, reason: 'not-live' });
    expect(h.send).not.toHaveBeenCalled();

    h.live.mockReturnValue(true);
    h.row.mockReturnValue({ status: 'active' });
    h.send.mockResolvedValue({});
    expect(await ask()).toEqual({ ok: true, queued: true });
    expect(h.send).toHaveBeenCalledWith(expect.anything(), 't1', [{ type: 'text', text: 'go', mentions: [] }], 'queue-if-active');

    h.row.mockReturnValue({ status: 'starting' });
    expect(await ask()).toEqual({ ok: true, queued: true });

    h.row.mockReturnValue({ status: 'idle' });
    expect(await ask()).toEqual({ ok: true, queued: false });

    h.send.mockRejectedValueOnce(new ThreadCreateError(409, 'deferred_queue_full', 'full'));
    expect(await ask()).toEqual({ ok: false, reason: 'deferred_queue_full' });
    h.send.mockRejectedValueOnce(new Error('boom'));
    expect(await ask()).toEqual({ ok: false, reason: 'error' });
  } finally {
    parent.emit('message', { data: { type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor); else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
