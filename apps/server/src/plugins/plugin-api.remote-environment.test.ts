import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { MessageChannel } from 'node:worker_threads';
import { createRemoteEnvironmentService } from '../services/hosts/remote-environment.js';
import { createPluginApi } from './plugin-api.js';
import { createPluginWorkerBridge } from './plugin-worker-bridge.js';

const SECRET = 'remote-env-secret-value-0123456789';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('zcc.remoteEnvironment', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-remote-env-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function setup(names: readonly string[] | undefined) {
    const callHost = vi.fn(async () => ({ applied: [], skipped: [] }));
    const service = createRemoteEnvironmentService({
      connectedHostIds: () => ['remote-1', 'primary-1'],
      isEligibleHost: (id) => id === 'remote-1',
      callHost
    });
    const handle = createPluginApi('env-plugin', dir, {
      productContext: { remoteEnvironment: service } as never,
      ...(names ? { remoteEnvironmentNames: names } : {})
    });
    return { callHost, service, handle };
  }

  it('refuses a plugin whose manifest declares no remote environment names', async () => {
    const { handle, service } = setup(undefined);
    try {
      expect(() => handle.api.remoteEnvironment.provide(() => [])).toThrow(/remoteEnvironment/);
    } finally {
      await handle.dispose();
      service.dispose();
    }
  });

  it('refuses when the runtime has no product context', async () => {
    const handle = createPluginApi('env-plugin', dir, { remoteEnvironmentNames: ['GH_TOKEN'] });
    try {
      expect(() => handle.api.remoteEnvironment.provide(() => [])).toThrow(/not available/);
      expect(() => handle.api.remoteEnvironment.refresh()).not.toThrow();
    } finally {
      await handle.dispose();
    }
  });

  it('rejects a non-function provider and a second registration', async () => {
    const { handle, service } = setup(['GH_TOKEN']);
    try {
      expect(() => handle.api.remoteEnvironment.provide('nope' as never)).toThrow(/function/);
      handle.api.remoteEnvironment.provide(() => []);
      expect(() => handle.api.remoteEnvironment.provide(() => [])).toThrow(/already/);
    } finally {
      await handle.dispose();
      service.dispose();
    }
  });

  it('pushes only declared names to non-primary machines and re-resolves on refresh', async () => {
    const { handle, service, callHost } = setup(['GH_TOKEN', 'GIT_CONFIG_*']);
    try {
      let token = SECRET;
      handle.api.remoteEnvironment.provide(() => [
        { name: 'GH_TOKEN', value: token },
        { name: 'GIT_CONFIG_COUNT', value: '1' },
        { name: 'NOT_DECLARED', value: 'x' },
        { name: 'PATH', value: '/evil' }
      ]);
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(1));
      const [hostId, command] = callHost.mock.calls[0] as unknown as [string, { type: string; entries: Array<{ name: string; value: string }> }];
      expect(hostId).toBe('remote-1');
      expect(command.type).toBe('host.environment.replace');
      expect(command.entries.map((entry) => entry.name).sort()).toEqual(['GH_TOKEN', 'GIT_CONFIG_COUNT']);

      token = `${SECRET}-rotated`;
      handle.api.remoteEnvironment.refresh();
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(2));
      const second = callHost.mock.calls[1] as unknown as [string, { entries: Array<{ name: string; value: string }> }];
      expect(second[1].entries.find((entry) => entry.name === 'GH_TOKEN')?.value).toBe(`${SECRET}-rotated`);
    } finally {
      await handle.dispose();
      service.dispose();
    }
  });

  it('withdraws the contribution on dispose and rejects use of a stale context', async () => {
    const { handle, service, callHost } = setup(['GH_TOKEN']);
    try {
      handle.api.remoteEnvironment.provide(() => [{ name: 'GH_TOKEN', value: SECRET }]);
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(1));
      await handle.dispose();
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(2));
      const last = callHost.mock.calls[1] as unknown as [string, { entries: unknown[] }];
      expect(last[1].entries).toEqual([]);
      expect(() => handle.api.remoteEnvironment.provide(() => [])).toThrow(/stale/);
      expect(() => handle.api.remoteEnvironment.refresh()).toThrow(/stale/);
    } finally {
      await handle.dispose();
      service.dispose();
    }
  });

  it('never writes provided values to the plugin data directory', async () => {
    const { handle, service, callHost } = setup(['GH_TOKEN']);
    try {
      handle.api.remoteEnvironment.provide(() => [{ name: 'GH_TOKEN', value: SECRET }]);
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(1));
      await handle.dispose();
      for (const file of filesUnder(dir)) expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    } finally {
      await handle.dispose();
      service.dispose();
    }
  });

  it('accepts a provider that crosses the isolated plugin worker bridge', async () => {
    const { handle, service, callHost } = setup(['GH_TOKEN']);
    const channel = new MessageChannel();
    const server = createPluginWorkerBridge(channel.port1, 'server');
    const worker = createPluginWorkerBridge(channel.port2, 'plugin');
    try {
      // The plugin's callback reaches the server as an async remote whose result is a decoded copy.
      const resolve = server.decode(worker.encode(async () => [{ name: 'GH_TOKEN', value: SECRET, requires: [] }]));
      handle.api.remoteEnvironment.provide(resolve);
      await vi.waitFor(() => expect(callHost).toHaveBeenCalledTimes(1));
      const sent = callHost.mock.calls[0] as unknown as [string, { entries: Array<{ name: string; value: string }> }];
      expect(sent[1].entries).toEqual([expect.objectContaining({ name: 'GH_TOKEN', value: SECRET })]);
    } finally {
      await handle.dispose();
      service.dispose();
      server.dispose();
      worker.dispose();
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('is available in the plugin test harness and records the provider', async () => {
    const fake = createFakePluginHost();
    try {
      const resolve = () => [{ name: 'GH_TOKEN', value: SECRET }];
      fake.zcc.remoteEnvironment.provide(resolve);
      expect(fake.harness.remoteEnvironment.provider).toBe(resolve);
      await expect(fake.harness.remoteEnvironment.resolve()).resolves.toEqual([{ name: 'GH_TOKEN', value: SECRET }]);
      fake.zcc.remoteEnvironment.refresh();
      expect(fake.harness.remoteEnvironment.refreshCount).toBe(1);
      expect(() => fake.zcc.remoteEnvironment.provide(resolve)).toThrow(/already/);
      await fake.harness.dispose();
      expect(fake.harness.remoteEnvironment.provider).toBeNull();
      expect(() => fake.zcc.remoteEnvironment.refresh()).toThrow(/stale/);
    } finally {
      await fake.harness.dispose();
    }
  });
});
