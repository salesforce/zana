import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { waitForThreadProvider } from './services/threads/thread-provider-catalog.js';

const h = vi.hoisted(() => ({
  listen: vi.fn(),
  pluginsStarted: null as null | { promise: Promise<void>; resolve: () => void },
  close: vi.fn(async () => undefined)
}));
vi.mock('./services/threads/thread-reads.js', async original => ({
  ...await original<typeof import('./services/threads/thread-reads.js')>(), prepareThreadReads: async () => undefined
}));
vi.mock('./http/product-context.js', async original => ({
  ...await original<typeof import('./http/product-context.js')>(),
  createProductHttpContext: () => ({ db: {}, hub: { emit() {}, subscribe: () => () => undefined }, config: { getConfig: () => ({}) }, dispose() {} })
}));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: () => ({ stop() {} }),
  startAttachedProductPluginService: () => h.pluginsStarted!.promise
}));
vi.mock('./static-host.js', () => ({ startStaticHost: h.listen }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
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

it('holds provider waits from when the host listens until plugin startup settles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-provider-startup-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const start = { data: { type: 'start', dataDir: root, rendererRoot: root,
    hostBinding: { hostId: 'test-host', instanceId: 'test-instance' } } };
  let started = false;
  try {
    await import('./utility-entry.js');

    // A failed start releases the hold, so nothing waits out the full bound.
    let failedWait: Promise<void> | undefined;
    h.listen.mockImplementationOnce(async () => {
      failedWait = waitForThreadProvider('claude-code');
      throw new Error('port in use');
    });
    parent.emit('message', start);
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'port in use' })));
    await failedWait;

    // A daemon that reconnects as soon as the host listens starts its resume pass before plugins start.
    let resolved = false;
    let resumeWait: Promise<void> | undefined;
    h.pluginsStarted = Promise.withResolvers<void>();
    h.listen.mockImplementationOnce(async () => {
      resumeWait = waitForThreadProvider('claude-code').then(() => { resolved = true; });
      return { url: 'http://127.0.0.1:0/', close: h.close };
    });
    parent.emit('message', start);
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    started = true;
    await new Promise((resolve) => setImmediate(resolve));
    expect(resolved).toBe(false);
    h.pluginsStarted.resolve();
    await resumeWait;
    expect(resolved).toBe(true);
  } finally {
    h.pluginsStarted?.resolve();
    if (started) {
      parent.emit('message', { data: { type: 'stop' } });
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    }
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
