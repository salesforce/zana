import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

const h = vi.hoisted(() => ({
  config: { pluginSafeMode: true }, emit: vi.fn(), refresh: vi.fn(async () => undefined),
  context: null as any, close: vi.fn(async () => undefined), databaseClose: vi.fn()
}));
vi.mock('./services/threads/thread-reads.js', async original => ({
  ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined
}));
vi.mock('./http/product-context.js', async original => ({
  ...await original<typeof import('./http/product-context.js')>(), createProductHttpContext: () => h.context
}));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: (ctx: any) => {
    ctx.plugins = { refreshSafeMode: h.refresh, stop() {} };
    return ctx.plugins;
  },
  startAttachedProductPluginService: async () => undefined
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: h.close }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close: h.databaseClose }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class {
  refreshHostConnection() { return Promise.resolve(); }
} }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({
  ...await original<typeof import('@zana-ai/zcc-process-utils')>(), installRuntimeLog() {}
}));
vi.mock('./runtime-request-boundary.js', () => ({
  dispatchRuntimeMessage: async (data: unknown, _reply: unknown, handler: (data: unknown) => Promise<void>) => handler(data)
}));

it('refreshes plugin policy and publishes the owner config through utility-process messages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-config-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  h.context = { db: {}, hub: { emit: h.emit, subscribe: () => () => undefined }, config: { getConfig: () => h.config } };
  let id = 0;
  let stopped = false;
  const publish = async (channel: string, args: unknown[] = []) => {
    const requestId = `config-event-${++id}`;
    parent.emit('message', { data: { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      id: requestId, deadlineAt: new Date(Date.now() + 20_000).toISOString(), operation: 'product-event', channel, args } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', id: requestId, value: true })));
  };
  try {
    await import('./utility-entry.js');
    await publish('config:onChanged', [{ pluginSafeMode: false }]);
    expect(h.refresh).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
    parent.emit('message', { data: { type: 'start', dataDir: root, rendererRoot: root,
      hostBinding: { hostId: 'test-host', instanceId: 'test-instance' } } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));

    await publish('config:onChanged', [{ pluginSafeMode: false }]);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.emit).toHaveBeenCalledWith('config:changed', { pluginSafeMode: true });
    h.config = { pluginSafeMode: false };
    await publish('product:reset', [{ pluginSafeMode: true }]);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(h.emit).toHaveBeenCalledWith('config:changed', { pluginSafeMode: false });
    expect(h.emit).toHaveBeenCalledWith('library:changed', {});
    await publish('goals:onChanged');
    expect(h.refresh).toHaveBeenCalledTimes(2);

    delete h.context.plugins;
    await publish('config:onChanged');
    expect(h.refresh).toHaveBeenCalledTimes(2);
    parent.emit('message', { data: { type: 'stop' } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    stopped = true;
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.databaseClose).toHaveBeenCalledOnce();
  } finally {
    if (!stopped) {
      parent.emit('message', { data: { type: 'stop' } });
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    }
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
