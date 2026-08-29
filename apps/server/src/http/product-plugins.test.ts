import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachProductPluginService, bundledPluginsRootFromDataDir, pluginAssetRootFromService, productListProjects, productPushInbox } from './product-plugins.js';
import { createInboxStore } from '../services/inbox/inbox-store.js';
import { createProjectStore } from '../project-store.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { getThreadProvider } from '../services/threads/thread-provider-catalog.js';

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

function writeProviderPlugin(dir: string): void {
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
  it('starts bundled plugins so thread create can resolve acp-opencode', async () => {
    const dataDir = tempDir();
    const bundled = tempDir();
    writeProviderPlugin(join(bundled, 'provider-acp'));
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
    expect(source).toContain('attachProductPluginService(host.ctx)');
  });

  it('wires sdk thread archive fork and unarchive onto the product plugin service', () => {
    const source = readFileSync(new URL('./product-plugins.ts', import.meta.url), 'utf8');
    expect(source).toContain('archiveConversation');
    expect(source).toContain('forkConversation');
    expect(source).toContain('unarchiveConversation');
    expect(source).toContain('archiveThread:');
    expect(source).toContain('forkThread:');
    expect(source).toContain('unarchiveThread:');
  });
});

describe('product plugin sdk confinement', () => {
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
