import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE,
  type DesktopBrowserChanged,
  type DesktopBrowserCommand,
  type DesktopBrowserInstance,
  type DesktopBrowserResult
} from '@zana-ai/zcc-host-daemon-contract';
import { startDesktopBrowserBroker } from '@zana-ai/zcc-host-daemon/desktop-browser-broker';
import { createDesktopBrowserBrokerClient } from './desktop-browser-broker-client.js';

function fakeBroker(instances: DesktopBrowserInstance[] = []) {
  const instanceListeners = new Set<() => void>();
  const changeListeners = new Set<(event: DesktopBrowserChanged) => void>();
  let hostId: string | null = null;
  return {
    listInstances: () => instances.map((instance) => ({ ...instance })),
    setHostId(value: string | null) {
      hostId = value;
    },
    hostId() {
      return hostId;
    },
    resetServer: vi.fn(),
    subscribe(listener: (event: DesktopBrowserChanged) => void) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    subscribeInstances(listener: () => void) {
      instanceListeners.add(listener);
      return () => instanceListeners.delete(listener);
    },
    async execute(command: DesktopBrowserCommand): Promise<DesktopBrowserResult> {
      if (command.type === 'desktop.browser.list_instances') {
        return { instances };
      }
      if (command.type === 'desktop.browser.list_tabs') {
        return { tabs: [] };
      }
      throw new Error(`unexpected ${command.type}`);
    }
  };
}

describe('desktop browser broker client', () => {
  const clients: Array<{ stop(): void }> = [];
  const brokers: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  });

  it('registers over the loopback broker and answers list_instances locally', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'zcc-browser-client-'));
    const daemon = await startDesktopBrowserBroker({
      dataDir,
      hostId: 'host-1',
      serverUrl: 'http://127.0.0.1:8780/',
      onChanged: () => undefined
    });
    brokers.push(daemon);
    daemon.setConnected(true);
    const native = fakeBroker([
      { instanceId: 'window-1', generation: 'gen-1', label: 'ZCC window 1' }
    ]);
    const client = createDesktopBrowserBrokerClient({
      broker: native as never,
      dataDir,
      getServerUrl: () => 'http://127.0.0.1:8780/'
    });
    clients.push(client);
    await vi.waitFor(async () => {
      expect(native.hostId()).toBe('host-1');
      expect(
        (await daemon.request({ type: 'desktop.browser.list_instances' })).instances
      ).toEqual([{ instanceId: 'window-1', generation: 'gen-1', label: 'ZCC window 1' }]);
    });
  });

  it('ignores a world-readable descriptor and a foreign-home broker file', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'zcc-browser-client-perm-'));
    const foreignHome = await mkdtemp(join(tmpdir(), 'zcc-browser-foreign-home-'));
    await mkdir(join(foreignHome, '.bb-machines', '127.0.0.1-8780'), { recursive: true });
    await writeFile(
      join(foreignHome, '.bb-machines', '127.0.0.1-8780', DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE),
      JSON.stringify({
        version: 1,
        hostId: 'foreign',
        serverUrl: 'http://127.0.0.1:8780',
        url: 'ws://127.0.0.1:9/desktop-browser',
        token: 'a'.repeat(64)
      }),
      { mode: 0o600 }
    );
    await writeFile(
      join(dataDir, DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE),
      JSON.stringify({
        version: 1,
        hostId: 'host-1',
        serverUrl: 'http://127.0.0.1:8780',
        url: 'ws://127.0.0.1:9/desktop-browser',
        token: 'b'.repeat(64)
      }),
      { mode: 0o644 }
    );
    const native = fakeBroker();
    const client = createDesktopBrowserBrokerClient({
      broker: native as never,
      dataDir,
      getServerUrl: () => 'http://127.0.0.1:8780/'
    });
    clients.push(client);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(native.hostId()).toBeNull();
    await chmod(join(dataDir, DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE), 0o600);
  });
});
