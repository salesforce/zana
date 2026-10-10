import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commandOptions: undefined as any,
  adapter: { stopBackgroundTask: vi.fn(), cancelPlan: vi.fn() } as Record<string, any>
}));

vi.mock('./runtime-manager.js', () => ({ createRuntimeManager: () => mocks.adapter }));
vi.mock('./command-dispatch.js', () => ({
  createCommandRuntime: (options: unknown) => {
    mocks.commandOptions = options;
    return { terminals: new Map(), emit: () => {} };
  }
}));
vi.mock('./plugin-host-manager.js', () => ({ PluginHostManager: class {} }));
vi.mock('./workspace-fs-watch.js', () => ({ hostFsWatcher: () => ({}) }));
vi.mock('./enrolled-pty.js', () => ({ createEnrolledPty: () => ({}) }));
vi.mock('./preview-tunnel.js', () => ({ HostPreviewTunnel: class { close() {} } }));
vi.mock('./server-socket.js', () => ({
  createHostServerSocket: () => ({ connected: false, ready: new Promise(() => {}), close: async () => {}, reconnect: () => {}, send: () => false })
}));

import { startEnrolledHostConnection } from './server-connection.js';

afterEach(() => { mocks.adapter.stopBackgroundTask = vi.fn(); });

function start() {
  startEnrolledHostConnection({ serverUrl: 'http://127.0.0.1:1/t/zcrs_abcdefghijklmnop', hostId: 'host', hostKey: 'key' });
  return mocks.commandOptions as { stopBackgroundTask: (input: unknown) => Promise<boolean> };
}

it('forwards background task stops to the thread runtime', async () => {
  const runtime = start();
  const input = { threadId: 't', providerThreadId: 'p', itemId: 'i' };
  mocks.adapter.stopBackgroundTask.mockResolvedValueOnce(true);
  await expect(runtime.stopBackgroundTask(input)).resolves.toBe(true);
  expect(mocks.adapter.stopBackgroundTask).toHaveBeenCalledWith(input);
});

it('reports a background stop as unsupported when the runtime has no stop', async () => {
  delete mocks.adapter.stopBackgroundTask;
  const runtime = start();
  await expect(runtime.stopBackgroundTask({ threadId: 't', providerThreadId: 'p', itemId: 'i' })).resolves.toBe(false);
});
