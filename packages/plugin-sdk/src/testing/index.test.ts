import { describe, expect, it } from 'vitest';
import { createFakePluginHost, PluginContextStaleError } from './index.js';

describe('createFakePluginHost', () => {
  it('records rpc, kv, settings, and realtime', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
    zcc.rpc.method('echo', (args) => args);
    await zcc.storage.kv.set('k', { n: 1 });
    zcc.realtime.publish('tick', { ok: true });
    const settings = zcc.settings.define({
      token: { type: 'string', label: 'Token', default: 'x' }
    });
    expect(await settings.get()).toEqual({ token: 'x' });
    harness.setSettings({ token: 'secret' });
    expect(await settings.get()).toEqual({ token: 'secret' });
    expect(() => harness.setSettings({ token: true as never })).toThrow(/expected string/);
    await expect(harness.callRpc('echo', { a: 1 })).resolves.toEqual({ a: 1 });
    expect(await zcc.storage.kv.get('k')).toEqual({ n: 1 });
    expect(harness.published).toEqual([{ event: 'tick', payload: { ok: true } }]);
  });

  it('poisons the api after dispose', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'gone' });
    await harness.dispose();
    expect(() => zcc.rpc.method('x', () => null)).toThrow(PluginContextStaleError);
  });
});

describe('collectTestPluginApp', () => {
  it('collects slots from a definePluginApp export', async () => {
    const { collectTestPluginApp } = await import('./app.js');
    const { definePluginApp } = await import('../app.js');
    const set = collectTestPluginApp(
      definePluginApp((app) => {
        app.slots.navPanel({ id: 'main', title: 'Notes', icon: 'FileText', component: () => null });
      }),
      'notes'
    );
    expect(set.navPanels[0]?.title).toBe('Notes');
    expect(set.pluginId).toBe('notes');
  });
});

describe('createFakePluginHost sdk stubs', () => {
  it('throws until inbox and projects callbacks are wired', async () => {
    const bare = createFakePluginHost({ pluginId: 'bare' });
    await expect(bare.zcc.sdk.inbox.push({ projectId: 'p', comments: 'x' })).rejects.toThrow(/not available/);
    await expect(bare.zcc.sdk.projects.list()).rejects.toThrow(/not available/);
    const wired = createFakePluginHost({
      pluginId: 'wired',
      pushInbox: async (args) => ({ id: `inb:${args.projectId}` }),
      listProjects: async () => [{ id: 'p1', name: 'A' }]
    });
    await expect(wired.zcc.sdk.inbox.push({ projectId: 'p1', comments: 'hi' })).resolves.toEqual({
      id: 'inb:p1'
    });
    await expect(wired.zcc.sdk.projects.list()).resolves.toEqual([{ id: 'p1', name: 'A' }]);
  });

  it('throws until thread archive fork and unarchive callbacks are wired', async () => {
    const bare = createFakePluginHost({ pluginId: 'bare' });
    await expect(bare.zcc.sdk.threads.archive({ threadId: 't1' })).rejects.toThrow(/not available/);
    const wired = createFakePluginHost({
      pluginId: 'wired',
      archiveThread: async (args) => ({ id: args.threadId }),
      forkThread: async (args) => ({ id: `fork:${args.threadId}` }),
      unarchiveThread: async (args) => ({ id: args.threadId })
    });
    await expect(wired.zcc.sdk.threads.archive({ threadId: 't1' })).resolves.toEqual({ id: 't1' });
    await expect(wired.zcc.sdk.threads.fork({ threadId: 't1' })).resolves.toEqual({ id: 'fork:t1' });
    await expect(wired.zcc.sdk.threads.unarchive({ threadId: 't1' })).resolves.toEqual({ id: 't1' });
  });
});
