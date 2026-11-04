import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

const h = vi.hoisted(() => ({ applyAllUpdates: vi.fn() }));
vi.mock('./services/threads/thread-reads.js', () => ({ prepareThreadReads: async () => {} }));
vi.mock('./http/product-context.js', () => ({ createProductHttpContext: () => ({
  db: {}, config: { getConfig: () => ({}) }, hub: { emit() {}, subscribe: () => () => {} }
}) }));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: () => ({ stop() {}, applyAllUpdates: h.applyAllUpdates }),
  startAttachedProductPluginService: async () => {}
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: async () => {} }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class { refreshHostConnection() { return Promise.resolve(); } } }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<Record<string, unknown>>(), installRuntimeLog() {} }));

it('reports unavailable, successful and failed bulk plugin updates over the utility channel', async () => {
  const root = await mkdtemp(join(tmpdir(), 'utility-plugin-updates-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const ask = async () => {
    const id = randomUUID();
    parent.emit('message', { data: { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(), operation: 'plugins-update-all' } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id })));
    return parent.postMessage.mock.calls.map(([message]) => message).find(message => message.id === id);
  };
  try {
    await import('./utility-entry.js');
    await expect(ask()).resolves.toMatchObject({ type: 'error', message: 'plugin host is unavailable' });
    expect(h.applyAllUpdates).not.toHaveBeenCalled();
    parent.emit('message', { data: { type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
      dataDir: root, rendererRoot: root, hostUrl: 'http://127.0.0.1:1', hostToken: 't'.repeat(32),
      hostSigningKey: 's'.repeat(32), version: '1.0.0', hostBinding: { hostId: randomUUID(), instanceId: randomUUID() } } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    const value = { updated: ['fixture'], failed: [{ id: 'offline', message: 'source unavailable' }] };
    h.applyAllUpdates.mockResolvedValueOnce(value);
    await expect(ask()).resolves.toMatchObject({ type: 'result', value });
    h.applyAllUpdates.mockRejectedValueOnce(new Error('runtime stopped'));
    await expect(ask()).resolves.toMatchObject({ type: 'error', message: 'runtime stopped' });
  } finally {
    parent.emit('message', { data: { type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
});
