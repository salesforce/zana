import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachProductPluginService,
  bundledPluginsRootFromDataDir,
  createAttachedProductPluginService,
  pluginAssetRootFromService,
  productListProjects,
  productListProviders,
  productProjectHarnessDefault,
  productPushInbox,
  productRegisterPersonas,
  productRegisterTeams,
  startAttachedProductPluginService
} from './product-plugins.js';
import { createInboxStore } from '../services/inbox/inbox-store.js';
import { createProjectStore } from '../project-store.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { getThreadProvider, registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { buildPluginHost } from '@zana-ai/zcc-plugin-build';
import { HostUnavailableError } from './host-hub.js';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';

let server: ProductServer | null = null;
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-attach-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  const plugins = server?.ctx.plugins;
  if (plugins) {
    for (const row of plugins.list()) {
      await plugins.remove(row.id).catch(() => undefined);
    }
  }
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function writeProviderPlugin(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-plugin-provider-acp',
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'ACP providers',
        description: 'ACP thread providers',
        branding: { icon: 'Puzzle' },
        server: './server.mjs',
        host: './host.ts'
      }
    })
  );
  writeFileSync(join(dir, 'host.ts'), 'export default { ready: true };\n');
  writeFileSync(
    join(dir, 'server.mjs'),
    `export default function plugin(zcc) {
      zcc.agents.experimental_registerProvider({
        id: 'acp-opencode',
        displayName: 'OpenCode',
        capabilities: {
          supportsServiceTier: true,
          fork: 'tip',
          supportsManualCompaction: true,
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ['accept-edits', 'full']
        },
        composerActions: []
      });
    }\n`
  );
  // Bundled installs ship prebuilt artifacts and never compile on startup.
  await buildPluginHost(dir, '2.3.1');
}

function writeAppPlugin(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-plugin-notes',
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'Notes',
        description: 'Notes',
        branding: { icon: 'StickyNote' },
        app: './app.js'
      }
    })
  );
  writeFileSync(join(dir, 'app.js'), 'export default { __zccPluginApp: true, setup() {} }\n');
}

describe('attachProductPluginService', () => {
  it('attaches without activating plugins until explicitly started', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    await writeProviderPlugin(join(bundled, 'provider-acp'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });

    const plugins = createAttachedProductPluginService(server.ctx, { bundledRoot: bundled });
    expect(server.ctx.plugins).toBe(plugins);
    expect(getThreadProvider('acp-opencode')).toBeUndefined();

    await startAttachedProductPluginService(server.ctx, plugins);
    expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode');
  });

  it('does not register providers when shutdown cancels activation', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    await writeProviderPlugin(join(bundled, 'provider-acp'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });

    const plugins = createAttachedProductPluginService(server.ctx, { bundledRoot: bundled });
    plugins.stop();
    await startAttachedProductPluginService(server.ctx, plugins);

    expect(getThreadProvider('acp-opencode')).toBeUndefined();
  });

  it('starts bundled plugins so thread create can resolve acp-opencode', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    await writeProviderPlugin(join(bundled, 'provider-acp'));
    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode');
    expect(server.ctx.plugins?.get('provider-acp')?.status).toBe('running');
    expect(server.ctx.pluginHostArtifacts.get('provider-acp')?.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('serves only declared branding for headless and disabled plugins', async () => {
    const bundled = tempDir();
    const root = join(bundled, 'branding-test');
    mkdirSync(join(root, 'icons'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'zcc-plugin-branding-test', version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: 'Branding test', description: 'A headless logo', branding: { icon: './icons/My Logo.svg' }, server: './server.mjs' } }));
    writeFileSync(join(root, 'server.mjs'), 'export default () => {};');
    writeFileSync(join(root, 'icons/My Logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#d97757" d="M0 0h24v24H0z"/></svg>');
    server = await startProductServer({ dataDir: tempDir(), origins: { serverPort: 0, devAppPort: 5173 } });
    await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    await server.ctx.plugins!.install(root);
    for (const enabled of [true, false]) {
      await server.ctx.plugins![enabled ? 'enable' : 'disable']('branding-test');
      const response = await fetch(`${server.url}plugins/branding-test/assets/icons/My%20Logo.svg`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/svg+xml');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await response.text()).toContain('#d97757');
      expect(await fetch(`${server.url}plugins/branding-test/assets/server.mjs`).then(r => r.status)).toBe(404);
      expect(pluginAssetRootFromService(server.ctx.plugins, 'branding-test')).toBeNull();
    }
    expect(pluginAssetRootFromService(undefined, 'branding-test', 'icons/My Logo.svg')).toBeNull();
  });

  it('does not require an icon before serving a plugin app asset', () => {
    const row = { enabled: true, appEntry: './app.js', rootDir: '/plugin' };
    const plugins = {
      get: () => row,
      appUrl: () => '/plugins/notes/assets/app.js'
    };
    expect(pluginAssetRootFromService(plugins as never, 'notes', 'app.js')).toBe('/plugin');
  });

  it('serves contained plugin renderer assets from the product listener', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    writeAppPlugin(join(bundled, 'notes'));
    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    await server.ctx.plugins!.install(join(bundled, 'notes'));
    const row = server.ctx.plugins?.get('notes');
    expect(pluginAssetRootFromService(server.ctx.plugins, 'notes')).toBe(row?.rootDir);
    await expect(fetch(`${server.url}plugins/notes/assets/app.js`).then((r) => r.text())).resolves.toContain(
      '__zccPluginApp'
    );
    await expect(fetch(`${server.url}plugins/notes/main`).then((r) => r.status)).resolves.toBe(404);
  });
});

describe('listen.ts', () => {
  it('starts the plugin service on the standalone product server', () => {
    const source = readFileSync(new URL('./listen.ts', import.meta.url), 'utf8');
    expect(source).toContain('standaloneModernTeamLaunchSource(');
    expect(source).toContain("process.env.ZCC_E2E_HOME ? join(process.env.ZCC_E2E_HOME, 'electron-user-data') : undefined");
  });

  it('wires sdk thread archive fork and unarchive onto the product plugin service', () => {
    const source = readFileSync(new URL('./product-plugins.ts', import.meta.url), 'utf8');
    expect(source).toContain('archiveConversation');
    expect(source).toContain('forkConversation');
    expect(source).toContain('unarchiveConversation');
    expect(source).toContain('archiveThread:');
    expect(source).toContain('forkThread:');
    expect(source).toContain('unarchiveThread:');
    expect(source).toContain('spawnThread:');
    expect(source).toContain('defaultHarness: ctx.config.getConfig().defaultHarness');
    expect(source).toContain('createConversationFromRequest');
    expect(source).toContain('queryConversationThreads');
    expect(source).toContain('createQueuedMessage');
    expect(source).toContain('listQueuedMessages');
    expect(source).toContain('originPluginId: pluginId');
    expect(source).toContain('pluginMetadata');
    expect(source).toContain('stopThread:');
    expect(source).toContain('threadOutput:');
    expect(source).toContain('defaultExecutionOptions:');
    expect(source).toContain('resolvePluginDefaultExecutionOptions');
    expect(source).toContain('ctx.modelCatalogs.read');
    expect(source).toContain('readLastThreadExecution');
    expect(source).toContain('readWorkspaceFile:');
    expect(source).toContain('conversationThreadOutput');
    expect(source).toContain('visibility');
  });
});

describe('product plugin sdk confinement', () => {
  it('marks SSH and secondary-host projects unavailable to local SDK execution', () => {
    const projects = { list: () => [
      { id: 'local', name: 'Local', path: '/tmp/local', local: true },
      { id: 'ssh', name: 'SSH', path: '/tmp/local', remote: { host: 'other' } },
      { id: 'host', name: 'Host', path: '/tmp/local', hostId: 'secondary' }
    ] } as any;
    expect(productListProjects({ projects })).toEqual([
      { id: 'local', name: 'Local', path: '/tmp/local', local: true },
      { id: 'ssh', name: 'SSH', path: '/tmp/local', local: false },
      { id: 'host', name: 'Host', path: '/tmp/local', local: false }
    ]);
  });
  it('permits the registered primary host and rejects a secondary host with the same local path', async () => {
    server = await startProductServer({ dataDir: tempDir(), origins: { serverPort: 0, devAppPort: 5173 } });
    const { upsertHost } = await import('@zana-ai/zcc-db');
    const primary = upsertHost(server.ctx.db, { name: 'Primary', hostKeyHash: 'primary', isPrimary: true });
    const secondary = upsertHost(server.ctx.db, { name: 'Secondary', hostKeyHash: 'secondary', isPrimary: false });
    const projects = { list: () => [
      { id: 'primary', name: 'Primary', path: '/tmp/same', hostId: primary.id },
      { id: 'secondary', name: 'Secondary', path: '/tmp/same', hostId: secondary.id }
    ] } as any;
    expect(productListProjects({ projects, db: server.ctx.db })).toEqual([
      { id: 'primary', name: 'Primary', path: '/tmp/same', local: true },
      { id: 'secondary', name: 'Secondary', path: '/tmp/same', local: false }
    ]);
  });
  it('projects the host-owned Default Project marker only when true, independently of its display name', () => {
    const projects = { list: () => [
      {id:'default', name:'Renamed scratch', path:'/tmp/default', quickAgent:true, local:true},
      {id:'named', name:'Default Project', path:'/tmp/named'},
      {id:'ordinary', name:'Other', path:'/tmp/ordinary', quickAgent:false}
    ] } as any;
    expect(productListProjects({projects})).toEqual([
      {id:'default', name:'Renamed scratch', path:'/tmp/default', quickAgent:true, local:true},
      {id:'named', name:'Default Project', path:'/tmp/named', local:true},
      {id:'ordinary', name:'Other', path:'/tmp/ordinary', local:true}
    ]);
  });
  it('lists projects and rejects inbox pushes for unknown project ids', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.zcc'), { recursive: true });
    const projectDir = join(dir, 'alpha');
    mkdirSync(projectDir);
    const projects = createProjectStore({ projectsFile: join(dir, '.zcc', 'projects.json') });
    const project = await projects.add(projectDir);
    const inbox = createInboxStore({ filePath: join(dir, '.zcc', 'inbox', 'entries.jsonl') });
    const ctx = { projects, inbox };
    expect(productListProjects(ctx)).toEqual([{ id: project.id, name: project.name, path: project.path, local:true }]);
    await projects.update(project.id, { icon: 'Cloud' });
    expect(productListProjects(ctx)[0].icon).toBe('Cloud');
    await expect(
      productPushInbox(ctx, { pluginId: 'pr-monitor', projectId: 'missing', comments: 'nope' })
    ).rejects.toThrow(/unrecognized projectId/);
    const pushed = await productPushInbox(ctx, {
      pluginId: 'pr-monitor',
      projectId: project.id,
      comments: 'PR turned green'
    });
    expect(pushed.id).toBeTruthy();
    const { entries } = await inbox.read({ projectId: project.id });
    expect(entries[0]?.comments).toBe('PR turned green');
    expect(entries[0]?.extensionSource).toEqual({ extensionId: 'pr-monitor' });
  });

  it('resolves the bundled plugins root from dataDir unless overridden', () => {
    expect(bundledPluginsRootFromDataDir('/tmp/zcc-data/product')).toBe(join('/tmp/zcc-data/product', '..', 'plugins'));
    expect(bundledPluginsRootFromDataDir('/tmp/zcc-data/product', '/opt/plugins')).toBe('/opt/plugins');
  });
});

it('awaits the shared queue store through the live plugin SDK callback', async () => {
  const dataDir = tempDir(), pluginRoot = tempDir(), bundledRoot = tempDir();
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'queue-reader', version: '0.1.0', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Queue reader', description: 'Queue SDK regression', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(pluginRoot, 'server.mjs'), `export default api => { api.rpc.method('queue', args => api.sdk.threads.queuedMessages.list({ threadId: args.threadId })); };`);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  const { createQueuedMessage } = await import('../services/threads/queued-messages.js');
  const queued = await createQueuedMessage(dataDir, 'thread', [{ type: 'text', text: 'queued', mentions: [] }]);
  const plugins = await attachProductPluginService(server.ctx, { bundledRoot });
  await plugins.install(pluginRoot);
  await expect(plugins.callRpc('queue-reader', 'queue', { threadId: 'thread' })).resolves.toEqual([{ id: queued.id }]);
});

it('authorizes plugin queue writes against the registered thread and normalizes attachment provenance', async () => {
  const dataDir = tempDir(), pluginRoot = tempDir(), bundledRoot = tempDir();
  writeFileSync(join(pluginRoot, 'package.json'), JSON.stringify({ name: 'queue-writer', version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Queue writer', description: 'Queue write regression', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(pluginRoot, 'server.mjs'), `export default api => {
    api.rpc.method('create', args => api.sdk.threads.queuedMessages.create(args));
  };`);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  const { createConversationThread, createEnvironment, upsertHost } = await import('@zana-ai/zcc-db');
  const host = upsertHost(server.ctx.db, { name: 'Queue host', hostKeyHash: 'queue-host' });
  const environment = createEnvironment(server.ctx.db, { projectId: 'queue-project', hostId: host.id,
    path: tempDir(), workspaceProvisionType: 'unmanaged', status: 'ready' });
  const thread = createConversationThread(server.ctx.db, { projectId: 'queue-project', hostId: host.id,
    environmentId: environment.id, providerId: 'codex' });
  const plugins = await attachProductPluginService(server.ctx, { bundledRoot });
  await plugins.install(pluginRoot);
  await expect(plugins.callRpc('queue-writer', 'create', { threadId: 'missing', input: [{ type: 'text', text: 'Do work' }] }))
    .rejects.toThrow('Thread is not registered');
  await expect(plugins.callRpc('queue-writer', 'create', { threadId: thread.id,
    input: [{ type: 'localImage', path: '/tmp/foreign.png', hostId: 'other-machine' }] }))
    .rejects.toThrow('belongs to another machine');
  const created = await plugins.callRpc('queue-writer', 'create', { threadId: thread.id,
    input: [{ type: 'localImage', path: '/tmp/owned.png', hostId: host.id }] });
  expect(created).toMatchObject({ id: expect.any(String) });
  const { listQueuedMessages } = await import('../services/threads/queued-messages.js');
  const queue = await listQueuedMessages(dataDir, thread.id);
  expect(queue).toHaveLength(1);
  expect(queue[0].content).toEqual([{ type: 'localImage', path: '/tmp/owned.png' }]);
});

function writeInteractionsPlugin(dir: string, pluginId: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `zcc-plugin-${pluginId}`,
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: 'Interactions demo',
        description: 'Interactions demo',
        branding: { icon: 'Puzzle' },
        server: './server.mjs'
      }
    })
  );
  writeFileSync(
    join(dir, 'server.mjs'),
    `export default function plugin(zcc) {
      zcc.rpc.method('upsert', (input) => zcc.ui.interactions.upsert(input));
      zcc.rpc.method('get', (id) => zcc.ui.interactions.get(id));
      zcc.rpc.method('acknowledge', (req) => zcc.ui.interactions.acknowledge(req));
      zcc.rpc.method('cancel', (req) => zcc.ui.interactions.cancel(req));
    }\n`
  );
}

describe('plugin ui.interactions bridge', () => {
  it('upserts, gets, acknowledges, and cancels through InteractionService, scoped by pluginId', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    writeInteractionsPlugin(join(bundled, 'interactions-demo'), 'interactions-demo');
    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const plugins = await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    await plugins.install(join(bundled, 'interactions-demo'));

    const created = await plugins.callRpc('interactions-demo', 'upsert', {
      projectId: 'proj-1',
      correlationId: 'corr-1',
      kind: 'confirm',
      payload: { message: 'hi' }
    });
    expect(created).toMatchObject({
      pluginId: 'interactions-demo',
      projectId: 'proj-1',
      correlationId: 'corr-1',
      kind: 'confirm',
      status: 'pending',
      generation: 1
    });

    await expect(plugins.callRpc('interactions-demo', 'get', created.id)).resolves.toMatchObject({
      id: created.id,
      status: 'pending'
    });

    const acknowledged = await plugins.callRpc('interactions-demo', 'acknowledge', {
      interactionId: created.id,
      generation: created.generation
    });
    expect(acknowledged).toMatchObject({ id: created.id, status: 'acknowledged', generation: 2 });

    const cancelled = await plugins.callRpc('interactions-demo', 'cancel', {
      interactionId: created.id,
      generation: acknowledged.generation
    });
    expect(cancelled).toMatchObject({ id: created.id, status: 'cancelled', generation: 3 });
  });

  it('does not let one plugin see or act on another plugin interaction', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    writeInteractionsPlugin(join(bundled, 'owner'), 'owner');
    writeInteractionsPlugin(join(bundled, 'intruder'), 'intruder');
    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const plugins = await attachProductPluginService(server.ctx, { bundledRoot: bundled });
    await plugins.install(join(bundled, 'owner'));
    await plugins.install(join(bundled, 'intruder'));

    const created = await plugins.callRpc('owner', 'upsert', {
      projectId: 'proj-1',
      correlationId: 'corr-owned',
      kind: 'confirm',
      payload: {}
    });

    await expect(plugins.callRpc('intruder', 'get', created.id)).resolves.toBeNull();
    await expect(
      plugins.callRpc('intruder', 'acknowledge', { interactionId: created.id, generation: created.generation })
    ).rejects.toThrow(/no interaction/);
    await expect(
      plugins.callRpc('intruder', 'cancel', { interactionId: created.id, generation: created.generation })
    ).rejects.toThrow(/no interaction/);
  });
});

describe('plugin persona/team registration bridge', () => {
  it('logs when no control-plane is reachable, without throwing', async () => {
    const dir = tempDir();
    const ctx = { dataDir: dir };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    productRegisterPersonas(ctx, 'pr-monitor', [{ id: 'reviewer', name: 'Reviewer' } as any]);
    productRegisterTeams(ctx, 'pr-monitor', [{ id: 'squad', name: 'Squad', slots: [] } as any]);
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(2));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[plugin:pr-monitor] registerPersonas failed:')
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[plugin:pr-monitor] registerTeams failed:')
    );
    errorSpy.mockRestore();
});
});

describe('plugin spawn harness helpers', () => {
  const status = (rows: Array<{ family: string; installed: boolean; enabled: boolean }>) => ({
    providers: rows.map((row) => ({ ...row, label: row.family, binary: row.family, alwaysEnabled: false, installHint: '' }))
  });
  const hubWith = (call: (input: { hostId: string }) => Promise<unknown>) => ({
    resolveHostId: (hostId?: string) => hostId ?? 'local-host',
    callHostOnlineRpc: vi.fn(call)
  });
  const baseConfig = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };

  it('resolves the project effective default on the project host with personas from disk', async () => {
    const dataDir = tempDir();
    const hub = hubWith(async () => status([{ family: 'claude', installed: true, enabled: true }, { family: 'codex', installed: true, enabled: true }]));
    const ctx = {
      dataDir,
      hostHub: hub,
      config: { getConfig: () => ({ ...baseConfig, defaultHarness: 'codex', harnessCodexEnabled: true }) },
      toProjects: () => [{ id: 'p1', name: 'P', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0, hostId: 'remote-1' }]
    } as never;
    await expect(productProjectHarnessDefault(ctx, 'p1')).resolves.toMatchObject({ ok: true, family: 'codex' });
    expect(hub.callHostOnlineRpc).toHaveBeenLastCalledWith({ hostId: 'remote-1', command: { type: 'provider.status' } });
    await productProjectHarnessDefault(ctx, 'p1', 'explicit-host');
    expect(hub.callHostOnlineRpc).toHaveBeenLastCalledWith({ hostId: 'explicit-host', command: { type: 'provider.status' } });
    await expect(productProjectHarnessDefault(ctx, 'missing')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('reports UNAVAILABLE_DEFAULT when the host is not connected', async () => {
    const db = openDatabase(join(tempDir(), 'hosts.sqlite'));
    upsertHost(db, { id: 'primary', name: 'Primary', hostKeyHash: 'primary' });
    const ctx = {
      db,
      dataDir: tempDir(),
      hostHub: hubWith(async () => { throw new HostUnavailableError(); }),
      config: { getConfig: () => baseConfig },
      toProjects: () => [{ id: 'p1', name: 'P', path: '/tmp/p1', createdAt: 0, lastActiveAt: 0 }]
    } as never;
    await expect(productProjectHarnessDefault(ctx, 'p1')).resolves.toMatchObject({ ok: false, code: 'UNAVAILABLE_DEFAULT' });
    db.close();
  });

  it('probes the primary host for local projects without a host binding, never an arbitrary connected host', async () => {
    const db = openDatabase(join(tempDir(), 'hosts.sqlite'));
    upsertHost(db, { id: 'primary', name: 'Primary', hostKeyHash: 'primary' });
    const resolve = vi.fn((id?: string) => { if (!id) throw new Error('ambiguous-host'); return id; });
    const hub = { resolveHostId: resolve, callHostOnlineRpc: vi.fn(async () => status([{ family: 'codex', enabled: true, installed: true }])) };
    const ctx = { db, dataDir: tempDir(), hostHub: hub, config: { getConfig: () => ({ ...baseConfig, defaultHarness: 'codex', harnessCodexEnabled: true }) }, toProjects: () => [{ id: 'p1', path: '/local', name: 'Local' }] } as never;
    try {
      await expect(productProjectHarnessDefault(ctx, 'p1')).resolves.toMatchObject({ ok: true, family: 'codex' });
      expect(hub.callHostOnlineRpc).toHaveBeenLastCalledWith({ hostId: 'primary', command: { type: 'provider.status' } });
      resolve.mockImplementation(() => { throw new HostUnavailableError('Primary offline'); });
      expect(() => productProjectHarnessDefault(ctx, 'p1')).toThrow('Primary offline');
      expect(hub.callHostOnlineRpc).toHaveBeenCalledTimes(1);
    } finally { db.close(); }
  });

  it('lists providers with availability from the host probe, or bridge state when unprobeable', async () => {
    const declaration = (id: string) => ({
      id,
      displayName: id,
      capabilities: {
        fork: 'tip' as const,
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits' as const]
      },
      composerActions: []
    });
    const handles = [
      registerThreadProvider('test-claude', declaration('claude-code')),
      registerThreadProvider('test-codex', declaration('codex')),
      registerThreadProvider('test-broken', declaration('acp-grok'), null, 'bridge failed')
    ];
    try {
      const offline = { db: {} as never, hostHub: hubWith(async () => { throw new HostUnavailableError(); }) } as never;
      const offlineRows = await productListProviders(offline);
      expect(offlineRows.find((row) => row.id === 'claude-code')).toMatchObject({ available: true, capabilities: { permissionModes: ['accept-edits'] } });
      expect(offlineRows.find((row) => row.id === 'acp-grok')?.available).toBe(false);
      const probed = { db: {} as never, hostHub: hubWith(async () => status([
        { family: 'claude', installed: false, enabled: true },
        { family: 'codex', installed: true, enabled: true }
      ])) } as never;
      const rows = await productListProviders(probed);
      expect(rows.find((row) => row.id === 'claude-code')?.available).toBe(false);
      expect(rows.find((row) => row.id === 'codex')?.available).toBe(true);
    } finally {
      for (const handle of handles) handle.unregister();
    }
  });
});
