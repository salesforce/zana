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
    expect(zcc.storage.database().transaction(() => 3)).toBe(3);
    expect(await zcc.storage.kv.get('k')).toEqual({ n: 1 });
    expect(harness.published).toEqual([{ event: 'tick', payload: { ok: true } }]);
  });

  it('records provider and pty-harness registrations', () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
    const provider = zcc.agents.experimental_registerProvider({
      id: 'pi',
      displayName: 'Pi',
      capabilities: {
        supportsServiceTier: false,
        fork: 'checkpoint',
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['full']
      }
    });
    const pty = zcc.agents.experimental_registerPtyHarness({
      id: 'claude',
      displayName: 'Claude Code',
      profiles: [{ id: 'claude', label: 'Claude' }]
    });
    expect(harness.providers[0]?.id).toBe('pi');
    expect(harness.ptyHarnesses[0]?.id).toBe('claude');
    provider.unregister();
    pty.unregister();
    expect(harness.providers).toEqual([]);
    expect(harness.ptyHarnesses).toEqual([]);
  });

  it('parses registerTool parameters before execute', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
    zcc.agents.registerTool({
      name: 'echo_tool',
      description: 'Echo',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      execute: async (input) => input
    });
    await expect(harness.callAgentTool('echo_tool', { q: 'hi' })).resolves.toEqual({ q: 'hi' });
    expect(() => zcc.agents.registerTool({
      name: 'inbox_push',
      description: 'shadow',
      parameters: { type: 'object' },
      execute: async () => undefined
    })).toThrow(/built-in ZCC tool/);
  });

  it('runs a registered CLI command', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'notes' });
    zcc.cli.register({
      name: 'notes',
      summary: 'Notes CLI',
      async run(argv) {
        return { exitCode: 0, stdout: argv.join(' ') };
      }
    });
    await expect(harness.runCli(['list'])).resolves.toEqual({
      exitCode: 0,
      stdout: 'list',
      stderr: ''
    });
  });

  it('poisons the api after dispose', async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'gone' });
    await harness.dispose();
    expect(() => zcc.rpc.method('x', () => null)).toThrow(PluginContextStaleError);
  });

  it('shares a services registry across fake hosts and unregisters on dispose', async () => {
    const { createPluginServicesRegistry } = await import('../plugin-services.js');
    const registry = createPluginServicesRegistry();
    const alpha = createFakePluginHost({ pluginId: 'alpha', services: registry });
    const beta = createFakePluginHost({ pluginId: 'beta', services: registry });
    alpha.zcc.services.provide({ ping: () => 'alpha' });
    expect(beta.zcc.services.has('alpha')).toBe(true);
    expect(beta.zcc.services.use<{ ping: () => string }>('alpha').ping()).toBe('alpha');
    await alpha.harness.dispose();
    expect(() => beta.zcc.services.use<{ ping: () => string }>('alpha').ping()).toThrow(
      /unavailable/
    );
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

  it('lists hidden forks and queued messages when callbacks are wired', async () => {
    const wired = createFakePluginHost({
      pluginId: 'wired',
      forkThread: async (args) => ({ id: `fork:${args.threadId}` }),
      listThreads: async () => [{
        id: 'thr-h',
        projectId: 'p1',
        hostId: 'h1',
        environmentId: 'e1',
        providerId: 'codex',
        status: 'idle',
        originKind: 'fork',
        originPluginId: 'wired',
        visibility: 'hidden',
        archivedAt: null,
        createdAt: 1,
        parentThreadId: 't1'
      }],
      listQueuedMessages: async () => [{ id: 'qm-1' }],
      createQueuedMessage: async () => ({ id: 'qm-2' })
    });
    await expect(wired.zcc.sdk.threads.fork({ sourceThreadId: 't1', visibility: 'hidden' })).resolves.toEqual({
      id: 'fork:t1'
    });
    await expect(wired.zcc.sdk.threads.list({ includeHidden: true })).resolves.toHaveLength(1);
    await expect(wired.zcc.sdk.threads.queuedMessages.list({ threadId: 't1' })).resolves.toEqual([{ id: 'qm-1' }]);
    await expect(wired.zcc.sdk.threads.queuedMessages.create({
      threadId: 't1',
      input: [],
      senderThreadId: 'thr-h'
    })).resolves.toEqual({ id: 'qm-2' });
  });

  it('wires stop, output, files, and environments when callbacks are provided', async () => {
    const wired = createFakePluginHost({
      pluginId: 'wired',
      stopThread: async () => ({ ok: true as const }),
      threadOutput: async () => ({ output: 'done' }),
      defaultExecutionOptions: async () => ({
        model: 'opus',
        reasoningLevel: 'medium',
        permissionMode: 'accept-edits'
      }),
      getEnvironment: async () => ({
        id: 'e1',
        projectId: 'p1',
        hostId: 'h1',
        path: '/tmp/ws'
      }),
      readWorkspaceFile: async () => ({
        content: 'export const meta = {}',
        contentEncoding: 'utf8' as const,
        sizeBytes: 22
      }),
      listProviders: async () => [{ id: 'claude-code', available: true }],
      loadProviderModels: async () => ({
        models: [],
        selectedOnlyModels: [],
        modelLoadError: null
      })
    });
    await expect(wired.zcc.sdk.threads.stop({ threadId: 't1' })).resolves.toEqual({ ok: true });
    await expect(wired.zcc.sdk.threads.output({ threadId: 't1' })).resolves.toEqual({ output: 'done' });
    await expect(wired.zcc.sdk.threads.defaultExecutionOptions({ threadId: 't1' })).resolves.toMatchObject({
      model: 'opus'
    });
    await expect(wired.zcc.sdk.environments.get({ environmentId: 'e1' })).resolves.toMatchObject({
      path: '/tmp/ws'
    });
    await expect(wired.zcc.sdk.files.read({
      hostId: 'h1',
      path: '/tmp/ws/.zcc/workflows/a.js',
      rootPath: '/tmp/ws'
    })).resolves.toMatchObject({ contentEncoding: 'utf8' });
    await expect(wired.zcc.sdk.providers.list()).resolves.toEqual([{ id: 'claude-code', available: true }]);
  });
});
