import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';

const h = vi.hoisted(() => ({
  list: vi.fn(), listInstalled: vi.fn(), plan: vi.fn(), install: vi.fn(), forget: vi.fn()
}));
vi.mock('./services/threads/thread-reads.js', () => ({ prepareThreadReads: async () => {} }));
vi.mock('./http/product-context.js', () => ({ createProductHttpContext: () => ({
  db: {}, config: { getConfig: () => ({}) }, hub: { emit() {}, subscribe: () => () => {} }
}) }));
vi.mock('./http/product-plugins.js', async original => ({
  ...await original<typeof import('./http/product-plugins.js')>(),
  createAttachedProductPluginService: () => ({ stop() {}, pluginPacks: h }),
  startAttachedProductPluginService: async () => {}
}));
vi.mock('./static-host.js', () => ({ startStaticHost: async () => ({ url: 'http://127.0.0.1:0/', close: async () => {} }) }));
vi.mock('./runtime-database.js', () => ({ createRuntimeDatabase: () => ({ close() {} }) }));
vi.mock('./terminal-execution-service.js', () => ({ createTerminalExecutionService: () => ({ binding: { hostId: 'test-host' } }) }));
vi.mock('./terminal-session-service.js', () => ({ TerminalSessionService: class { refreshHostConnection() { return Promise.resolve(); } } }));
vi.mock('@zana-ai/zcc-process-utils', async original => ({ ...await original<Record<string, unknown>>(), installRuntimeLog() {} }));

const identity = { marketplaceSource: 'https://example.test/marketplace.json', packId: 'team-tools' };
const request = { identity, planId: randomUUID(), pluginIds: ['team-search'] };
const operations = [
  { operation: 'plugin-packs-list', method: 'list', payload: {}, args: [], value: [{ identity, pack: { id: identity.packId } }] },
  { operation: 'plugin-packs-installed', method: 'listInstalled', payload: {}, args: [], value: [{ identity, members: [] }] },
  { operation: 'plugin-packs-plan', method: 'plan', payload: { identity }, args: [identity], value: { identity, planId: request.planId, members: [] } },
  { operation: 'plugin-packs-install', method: 'install', payload: { request }, args: [request], value: { identity, members: [{ pluginId: 'team-search', status: 'installed' }] } },
  { operation: 'plugin-packs-forget', method: 'forget', payload: { identity }, args: [identity], value: true }
] as const;

interface Reply { type: string; id?: string; message?: string; value?: unknown }
type Ask = (operation: string, payload?: Record<string, unknown>) => Promise<Reply>;

async function withRuntime(start: boolean, run: (ask: Ask) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'utility-plugin-packs-'));
  const parent = Object.assign(new EventEmitter(), { postMessage: vi.fn<(message: Reply) => void>() });
  const descriptor = Object.getOwnPropertyDescriptor(process, 'parentPort');
  Object.defineProperty(process, 'parentPort', { configurable: true, value: parent });
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const ask: Ask = async (operation, payload = {}) => {
    const id = randomUUID();
    parent.emit('message', { data: { type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id,
      deadlineAt: new Date(Date.now() + 20_000).toISOString(), operation, ...payload } });
    await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id })));
    const replies = parent.postMessage.mock.calls.map(([message]) => message).filter(message => message.id === id);
    expect(replies).toHaveLength(1);
    return replies[0]!;
  };
  try {
    await import('./utility-entry.js');
    if (start) {
      parent.emit('message', { data: { type: 'start', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        dataDir: root, rendererRoot: root, hostUrl: 'http://127.0.0.1:1', hostToken: 't'.repeat(32),
        hostSigningKey: 's'.repeat(32), version: '1.0.0', hostBinding: { hostId: randomUUID(), instanceId: randomUUID() } } });
      await vi.waitFor(() => expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' })));
    }
    await run(ask);
  } finally {
    parent.emit('message', { data: { type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION } });
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    parent.removeAllListeners();
    exit.mockRestore();
    if (descriptor) Object.defineProperty(process, 'parentPort', descriptor);
    else Reflect.deleteProperty(process, 'parentPort');
    await rm(root, { recursive: true, force: true });
  }
}

beforeEach(() => {
  vi.resetModules();
  Object.values(h).forEach(method => method.mockReset());
});

it('rejects every pack operation while the plugin host is unavailable', async () => {
  await withRuntime(false, async ask => {
    await expect(ask('plugins-list')).resolves.toMatchObject({ type: 'result', value: [] });
    for (const operation of operations) {
      await expect(ask(operation.operation, operation.payload)).resolves.toMatchObject({
        type: 'error', message: 'plugin host is unavailable'
      });
    }
    Object.values(h).forEach(method => expect(method).not.toHaveBeenCalled());
  });
});

it('dispatches each pack operation with its validated payload and returns its result', async () => {
  await withRuntime(true, async ask => {
    for (const operation of operations) {
      h[operation.method].mockReturnValueOnce(operation.value);
      await expect(ask(operation.operation, operation.payload)).resolves.toMatchObject({ type: 'result', value: operation.value });
      expect(h[operation.method]).toHaveBeenCalledExactlyOnceWith(...operation.args);
    }
  });
});

it('returns synchronous and asynchronous pack failures to the requesting utility caller', async () => {
  await withRuntime(true, async ask => {
    for (const operation of operations) {
      const message = `${operation.method} failed`;
      if (operation.method === 'list' || operation.method === 'listInstalled') {
        h[operation.method].mockImplementationOnce(() => { throw new Error(message); });
      } else {
        h[operation.method].mockRejectedValueOnce(new Error(message));
      }
      await expect(ask(operation.operation, operation.payload)).resolves.toMatchObject({ type: 'error', message });
      expect(h[operation.method]).toHaveBeenCalledExactlyOnceWith(...operation.args);
    }
  });
});

it('rejects malformed pack requests before invoking the plugin service', async () => {
  await withRuntime(true, async ask => {
    const malformed = [
      { operation: 'plugin-packs-list', payload: { identity } },
      { operation: 'plugin-packs-installed', payload: { extra: true } },
      { operation: 'plugin-packs-plan', payload: { identity: { ...identity, packId: '../outside' } } },
      { operation: 'plugin-packs-forget', payload: { identity: { packId: identity.packId } } },
      { operation: 'plugin-packs-install', payload: { request: { ...request, planId: 'unreviewed' } } },
      { operation: 'plugin-packs-install', payload: { request: { ...request, pluginIds: [] } } },
      { operation: 'plugin-packs-install', payload: { request: { ...request, pluginIds: ['team-search', 'team-search'] } } },
      { operation: 'plugin-packs-install', payload: { request: { ...request, source: 'https://unreviewed.test/' } } }
    ];
    for (const operation of malformed) {
      await expect(ask(operation.operation, operation.payload)).resolves.toMatchObject({
        type: 'error', message: expect.stringContaining('invalid server runtime message:')
      });
    }
    Object.values(h).forEach(method => expect(method).not.toHaveBeenCalled());
  });
});
