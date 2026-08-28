import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPrMonitorPlugin } from '../lib/plugin.js';
import { packRpcArgs, invokeRpc } from '../lib/rpc.js';
import { DEFAULT_PR_MONITOR_SETTINGS } from '../lib/types.js';

const dirs: string[] = [];

function isolatedDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-prm-plugin-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('packRpcArgs / invokeRpc', () => {
  it('round-trips 0, 1, and N arguments', () => {
    const captured: unknown[][] = [];
    const fn = (...args: unknown[]) => {
      captured.push(args);
      return args.length;
    };
    expect(invokeRpc(fn as never, packRpcArgs([]))).toBe(0);
    expect(invokeRpc(fn as never, packRpcArgs(['url']))).toBe(1);
    expect(invokeRpc(fn as never, packRpcArgs(['url', 'proj']))).toBe(2);
    expect(captured).toEqual([[], ['url'], ['url', 'proj']]);
  });
});

describe('createPrMonitorPlugin', () => {
  it('exposes storage, badge, and inbox RPCs', async () => {
    const pushed: Array<{ projectId: string; comments: string }> = [];
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [],
      pushInbox: async (args) => {
        pushed.push(args);
        return { id: 'inb-1' };
      }
    });
    await createPrMonitorPlugin(zcc, {
      exec: async () => ({ code: 0, stdout: '{}', stderr: '' }),
      startBackground: false,
      dataDir: isolatedDataDir()
    });
    await harness.callRpc('storageSet', { key: 'settings', value: { badgeMode: 'unread' } });
    await expect(harness.callRpc('storageGet', 'settings')).resolves.toEqual({ badgeMode: 'unread' });
    await expect(harness.callRpc('badge')).resolves.toEqual({ count: null });
    await expect(harness.callRpc('pushInbox', { projectId: 'p1', comments: 'hello' })).resolves.toEqual({
      id: 'inb-1'
    });
    expect(pushed).toEqual([{ projectId: 'p1', comments: 'hello' }]);
    await expect(harness.callRpc('storageSet', { value: 1 })).rejects.toThrow(/key/);
    await expect(harness.callRpc('pushInbox', { projectId: '', comments: '' })).rejects.toThrow(/projectId/);
    await harness.dispose();
  });

  it('skips gh when auto-sync is off and still arms the timer', async () => {
    vi.useFakeTimers();
    const exec = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'offline' }));
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [],
      pushInbox: async () => ({ id: 'x' })
    });
    await zcc.storage.kv.set('settings', { ...DEFAULT_PR_MONITOR_SETTINGS, autoSyncEnabled: false });
    await createPrMonitorPlugin(zcc, { exec, startBackground: true, pollIntervalMs: 50, dataDir: isolatedDataDir() });
    await Promise.resolve();
    expect(exec).not.toHaveBeenCalled();
    await harness.dispose();
    vi.useRealTimers();
  });

  it('polls on the background tick when auto-sync is on', async () => {
    vi.useFakeTimers();
    const exec = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'offline' }));
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [],
      pushInbox: async () => ({ id: 'x' })
    });
    await createPrMonitorPlugin(zcc, { exec, startBackground: true, pollIntervalMs: 50, dataDir: isolatedDataDir() });
    await vi.advanceTimersByTimeAsync(0);
    expect(exec.mock.calls.length).toBeGreaterThan(0);
    await harness.dispose();
    vi.useRealTimers();
  });

  it('posts inbox entries from the background poll and swallows push failures', async () => {
    vi.useFakeTimers();
    const pushed: string[] = [];
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [{ id: 'p1', name: 'Alpha' }],
      pushInbox: async (args) => {
        if (args.comments.includes('boom')) throw new Error('inbox down');
        pushed.push(args.projectId);
        return { id: 'inb' };
      }
    });
    await zcc.storage.kv.set('settings', { ...DEFAULT_PR_MONITOR_SETTINGS, sendToInbox: true });
    const pr = {
      url: 'https://github.com/acme/app/pull/1',
      repo: 'acme/app',
      number: 1,
      title: 'Fix',
      status: 'green' as const,
      addedAt: 1,
      lastChecked: 1,
      lastStatusChange: 1,
      projectId: 'p1',
      baseRefName: 'main',
      mergeable: 'MERGEABLE' as const,
      mergeStateStatus: 'CLEAN' as const,
      checks: []
    };
    await createPrMonitorPlugin(zcc, {
      exec: async () => ({ code: 1, stdout: '', stderr: 'offline' }),
      startBackground: true,
      pollIntervalMs: 50,
      dataDir: isolatedDataDir(),
      pollAll: async () => ({
        ok: true,
        deltas: [
          { url: pr.url, oldStatus: 'yellow', newStatus: 'green', pr },
          { url: pr.url, oldStatus: 'green', newStatus: 'failed', pr: { ...pr, title: 'boom' } }
        ]
      })
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(pushed).toEqual(['p1']);
    await harness.dispose();
    vi.useRealTimers();
  });

  it('clamps the poll interval and records a failed poll without throwing', async () => {
    vi.useFakeTimers();
    const pollAll = vi.fn(async () => {
      throw new Error('gh exploded');
    });
    const { zcc, harness } = createFakePluginHost({
      pluginId: 'pr-monitor',
      listProjects: async () => [],
      pushInbox: async () => ({ id: 'x' })
    });
    await zcc.storage.kv.set('settings', { ...DEFAULT_PR_MONITOR_SETTINGS, pollIntervalMinutes: 1 });
    await createPrMonitorPlugin(zcc, {
      exec: async () => ({ code: 1, stdout: '', stderr: 'offline' }),
      startBackground: true,
      dataDir: isolatedDataDir(),
      pollAll
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(pollAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(pollAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pollAll).toHaveBeenCalledTimes(2);
    await harness.dispose();
    vi.useRealTimers();
  });
});
