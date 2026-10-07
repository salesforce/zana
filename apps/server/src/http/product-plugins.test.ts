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
  productPushInbox,
  productRegisterPersonas,
  productRegisterTeams,
  startAttachedProductPluginService
} from './product-plugins.js';
import { createInboxStore } from '../services/inbox/inbox-store.js';
import { createProjectStore } from '../project-store.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { getThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { buildPluginHost } from '@zana-ai/zcc-plugin-build';

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
  it('projects the host-owned Default Project marker only when true, independently of its display name', () => {
    const projects = { list: () => [
      {id:'default', name:'Renamed scratch', path:'/tmp/default', quickAgent:true},
      {id:'named', name:'Default Project', path:'/tmp/named'},
      {id:'ordinary', name:'Other', path:'/tmp/ordinary', quickAgent:false}
    ] } as any;
    expect(productListProjects({projects})).toEqual([
      {id:'default', name:'Renamed scratch', path:'/tmp/default', quickAgent:true},
      {id:'named', name:'Default Project', path:'/tmp/named'},
      {id:'ordinary', name:'Other', path:'/tmp/ordinary'}
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
    expect(productListProjects(ctx)).toEqual([{ id: project.id, name: project.name, path: project.path }]);
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
