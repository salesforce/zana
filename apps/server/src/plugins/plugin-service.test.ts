import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPluginService,
  defaultPluginDataDir,
  installBundledPlugin,
  listBundledPluginCatalog,
  toPluginAppSnapshot
} from './plugin-service.js';
import { containsNativeAddon } from './plugin-api.js';

const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-service-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writePlugin(dir: string, id: string, serverSource?: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `zcc-plugin-${id}`,
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: id,
        description: `${id} plugin`,
        branding: { icon: 'Puzzle' },
        server: './server.mjs',
        app: './app.js'
      }
    })
  );
  writeFileSync(
    join(dir, 'server.mjs'),
    serverSource ??
      `export default function plugin(zcc) {
        zcc.rpc.method('ping', () => ({ ok: true, id: zcc.pluginId }));
      }\n`
  );
  writeFileSync(join(dir, 'app.js'), 'export default { __zccPluginApp: true, setup() {} }\n');
  return dir;
}

describe('PluginService', () => {
  it('installs a path plugin from server.ts and reloads after an edit', async () => {
    const dataDir = root();
    const pluginDir = join(root(), 'typed');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-typed',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'typed',
          description: 'typed plugin',
          branding: { icon: 'Puzzle' },
          server: './server.ts'
        }
      })
    );
    writeFileSync(
      join(pluginDir, 'server.ts'),
      `export default function plugin(zcc: { pluginId: string; log: { info: (m: string) => void }; rpc: { method: (name: string, handler: () => unknown) => void } }) {
        zcc.log.info('typed-loaded');
        zcc.rpc.method('ping', () => ({ ok: true, id: zcc.pluginId, n: 1 }));
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('running');
    await expect(service.callRpc('typed', 'ping', {})).resolves.toEqual({ ok: true, id: 'typed', n: 1 });
    expect((await service.readLogs('typed')).join('\n')).toMatch(/typed-loaded/);
    writeFileSync(
      join(pluginDir, 'server.ts'),
      `export default function plugin(zcc: { pluginId: string; rpc: { method: (name: string, handler: () => unknown) => void } }) {
        zcc.rpc.method('ping', () => ({ ok: true, id: zcc.pluginId, n: 2 }));
      }\n`
    );
    const reloaded = await service.reload('typed');
    expect(reloaded.status).toBe('running');
    await expect(service.callRpc('typed', 'ping', {})).resolves.toEqual({ ok: true, id: 'typed', n: 2 });
    writeFileSync(
      join(pluginDir, 'server.ts'),
      'export default function plugin() { throw new Error("reload-boom"); }\n'
    );
    const kept = await service.reload('typed');
    expect(kept.status).toBe('running');
    expect(kept.statusDetail).toMatch(/reload-boom/);
    await expect(service.callRpc('typed', 'ping', {})).resolves.toEqual({ ok: true, id: 'typed', n: 2 });
  });

  it('installs a path plugin, loads the factory, and answers rpc', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'echo'), 'echo');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.id).toBe('echo');
    expect(row.sourceKind).toBe('path');
    expect(row.status).toBe('running');
    expect(row.provenance).toBe('direct');
    await expect(service.callRpc('echo', 'ping', {})).resolves.toEqual({ ok: true, id: 'echo' });
    expect(service.getSettings('echo')).toEqual({ descriptors: {}, values: {} });
  });

  it('shims a legacy extension.json directory', async () => {
    const dataDir = root();
    const pluginDir = join(root(), 'legacy');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'extension.json'),
      JSON.stringify({
        id: 'legacy',
        version: '0.2.0',
        title: 'Legacy',
        icon: 'Box',
        entry: { renderer: 'renderer.js' }
      })
    );
    writeFileSync(join(pluginDir, 'renderer.js'), 'export default {}\n');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.id).toBe('legacy');
    expect(row.appEntry).toBe('renderer.js');
    expect(row.status).toBe('running');
  });

  it('disables, reloads, and keeps path sources on remove', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'keep'), 'keep');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    await service.disable('keep');
    expect(service.get('keep')?.status).toBe('disabled');
    expect(service.snapshot().find((row) => row.id === 'keep')).toMatchObject({
      enabled: false,
      provenance: 'direct',
      status: 'disabled'
    });
    expect(toPluginAppSnapshot(service.snapshot().find((row) => row.id === 'keep')!)).not.toHaveProperty('rootDir');
    expect(toPluginAppSnapshot(service.snapshot().find((row) => row.id === 'keep')!)).not.toHaveProperty('source');
    await service.enable('keep');
    expect(service.get('keep')?.status).toBe('running');
    await service.remove('keep');
    expect(service.get('keep')).toBeUndefined();
    expect(existsSync(pluginDir)).toBe(true);
  });

  it('rejects native addons and npm installs without ignore-scripts would be the spawn contract', async () => {
    expect(containsNativeAddon('/x', ['foo.node'])).toBe(true);
    expect(containsNativeAddon('/x', ['node_modules/fsevents/fsevents.node'])).toBe(false);
    expect(containsNativeAddon('/x', ['node_modules/rollup/rollup.darwin-arm64.node'])).toBe(false);
    const dataDir = root();
    const service = createPluginService({
      dataDir,
      bundledRoot: root(),
      spawnNpm: async (args) => {
        expect(args).toContain('--ignore-scripts');
        return { code: 1, stdout: '', stderr: 'nope' };
      }
    });
    await expect(service.install('npm:some-plugin')).rejects.toThrow(/nope|npm install failed/);
  });

  it('degrades a plugin that ships a native addon in its own tree', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'native'), 'native');
    writeFileSync(join(pluginDir, 'binding.node'), '');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('degraded');
    expect(row.statusDetail).toBe('native addons are not allowed');
  });

  it('loads a plugin whose node_modules contains a native addon', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'devtools'), 'devtools');
    mkdirSync(join(pluginDir, 'node_modules', 'fsevents'), { recursive: true });
    writeFileSync(join(pluginDir, 'node_modules', 'fsevents', 'fsevents.node'), '');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('running');
  });

  it('degrades when the factory throws', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'boom'),
      'boom',
      'export default function plugin() { throw new Error("boom"); }\n'
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('degraded');
    expect(row.statusDetail).toMatch(/boom/);
  });

  it('keeps the previous running generation when a reload factory throws', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'sticky'), 'sticky');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    expect(service.get('sticky')?.status).toBe('running');
    writeFileSync(
      join(pluginDir, 'server.mjs'),
      'export default function plugin() { throw new Error("reload-boom"); }\n'
    );
    const reloaded = await service.reload('sticky');
    expect(reloaded.status).toBe('running');
    expect(reloaded.statusDetail).toMatch(/reload-boom/);
    await expect(service.callRpc('sticky', 'ping', {})).resolves.toEqual({ ok: true, id: 'sticky' });
  });

  it('keeps a registered thread provider after a successful reload', async () => {
    const { getThreadProvider } = await import('../services/threads/thread-provider-catalog.js');
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'provider-acp'),
      'provider-acp',
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
    const service = createPluginService({ dataDir, bundledRoot: root() });
    try {
      await service.install(pluginDir);
      expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode');
      writeFileSync(
        join(pluginDir, 'server.mjs'),
        `export default function plugin(zcc) {
          zcc.agents.experimental_registerProvider({
            id: 'acp-opencode',
            displayName: 'OpenCode reloaded',
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
      const reloaded = await service.reload('provider-acp');
      expect(reloaded.status).toBe('running');
      expect(getThreadProvider('acp-opencode')?.displayName).toBe('OpenCode reloaded');
    } finally {
      await service.remove('provider-acp').catch(() => undefined);
    }
  });

  it('adds a marketplace catalog of provenance pointers', async () => {
    const dataDir = root();
    const service = createPluginService({
      dataDir,
      bundledRoot: root(),
      fetchJson: async () => ({
        schemaVersion: 1,
        name: 'official',
        displayName: 'Official',
        plugins: [
          {
            id: 'from-catalog',
            displayName: 'From Catalog',
            description: 'pointer',
            author: { name: 'zana' },
            source: { npm: { package: '@zana/from-catalog', range: '1.0.0' } }
          }
        ]
      })
    });
    const row = await service.addMarketplace('https://example.test/index.json');
    expect(row.name).toBe('official');
    expect(service.listMarketplaces()).toHaveLength(1);
    const hits = await service.searchCatalog('from');
    expect(hits.some((h) => h.id === 'from-catalog' && h.marketplace === 'official')).toBe(true);
  });

  it('keeps the last-good catalog when refresh fails', async () => {
    const dataDir = root();
    let fail = false;
    const service = createPluginService({
      dataDir,
      bundledRoot: root(),
      fetchJson: async () => {
        if (fail) throw new Error('catalog unreachable');
        return {
          schemaVersion: 1,
          name: 'community',
          displayName: 'Community',
          plugins: [
            {
              id: 'kept',
              displayName: 'Kept',
              description: 'cached',
              author: { name: 'zana' },
              source: { npm: { package: '@zana/kept', range: '1.0.0' } }
            }
          ]
        };
      }
    });
    await service.addMarketplace('https://example.test/community.json');
    fail = true;
    const refreshed = await service.refreshMarketplace('https://example.test/community.json');
    expect(refreshed.lastError).toMatch(/unreachable/);
    expect(refreshed.cachedIndex?.plugins[0]?.id).toBe('kept');
    const hits = await service.searchCatalog('kept');
    expect(hits.some((h) => h.id === 'kept')).toBe(true);
  });

  it('exposes skill names, mcpServers without env values, and extra on snapshot', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'docs'), 'docs');
    mkdirSync(join(pluginDir, 'skills', 'hello'), { recursive: true });
    writeFileSync(join(pluginDir, 'skills', 'hello', 'SKILL.md'), '# Hello\n');
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-docs',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'Docs',
          description: 'Docs plugin',
          branding: { icon: 'Library' },
          server: './server.mjs',
          app: './app.js',
          skills: ['skills'],
          mcpServers: {
            library: {
              type: 'stdio',
              command: 'node',
              args: ['./server.mjs'],
              env: { TOKEN: 'secret' },
              alwaysOn: true
            }
          },
          extra: { notes: 'Host route, not a plugin MCP.' }
        }
      })
    );
    const seen: unknown[] = [];
    const service = createPluginService({
      dataDir,
      bundledRoot: root(),
      onAgentCapabilitiesChanged: (contribs) => {
        seen.push(contribs);
      }
    });
    await service.install(pluginDir);
    const snap = service.snapshot()[0];
    expect(snap?.skillNames).toEqual(['hello']);
    expect(snap?.mcpServers).toEqual([
      {
        name: 'library',
        type: 'stdio',
        command: 'node',
        args: ['./server.mjs'],
        envKeys: ['TOKEN'],
        alwaysOn: true
      }
    ]);
    expect(snap).not.toHaveProperty('mcpServers.0.env');
    expect(snap?.extra).toEqual({ notes: 'Host route, not a plugin MCP.' });
    expect(service.agentContributions()[0]?.mcpServers[0]?.env?.TOKEN).toBe('secret');
    expect(seen.length).toBeGreaterThan(0);
  });

  it('keeps nested app entry paths in the static asset URL', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'nested'), 'nested');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeFileSync(join(pluginDir, 'dist', 'app.js'), 'export default { __zccPluginApp: true, setup() {} }\n');
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-nested',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'Nested',
          description: 'Nested plugin',
          branding: { icon: 'Puzzle' },
          app: './dist/app.js'
        }
      })
    );
    const service = createPluginService({ dataDir, bundledRoot: root(), now: () => 42 });
    await service.install(pluginDir);

    expect(service.snapshot()[0]?.appUrl).toBe('/plugins/nested/assets/dist/app.js?v=42');
    expect(service.snapshot()[0]?.provenance).toBe('direct');
    expect(toPluginAppSnapshot(service.snapshot()[0]!)).toMatchObject({
      id: 'nested',
      name: 'Nested',
      description: 'Nested plugin',
      icon: 'Puzzle',
      enabled: true,
      provenance: 'direct',
      status: 'running',
      appUrl: '/plugins/nested/assets/dist/app.js?v=42'
    });
    expect(toPluginAppSnapshot(service.snapshot()[0]!)).not.toHaveProperty('rootDir');
    expect(toPluginAppSnapshot(service.snapshot()[0]!)).not.toHaveProperty('source');
  });

  it('reconcileBuiltins auto-installs docs from bundledRoot/docs', async () => {
    const dataDir = root();
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    const installed = await service.reconcileBuiltins();
    expect(installed.map((row) => row.id)).toEqual(['docs']);
    expect(service.get('docs')?.provenance).toBe('builtin');
    expect(service.get('docs')?.sourceKind).toBe('builtin');
    expect(service.snapshot()[0]?.provenance).toBe('builtin');
    expect(service.snapshot()[0]?.enabled).toBe(true);
  });

  it('rejects a server entry that escapes the plugin root', async () => {
    const { resolveContainedEntry } = await import('./plugin-api.js');
    const dir = root();
    writeFileSync(join(dir, 'ok.mjs'), 'export default function plugin() {}\n');
    expect(() => resolveContainedEntry(dir, '../outside.mjs')).toThrow(/escapes/);
    expect(resolveContainedEntry(dir, 'ok.mjs')).toContain('ok.mjs');
  });

  it('registers zcc CLI contributions, writes plugin-commands, and runs by name', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'hello'),
      'hello',
      `export default function plugin(zcc) {
        zcc.cli.register({
          name: 'hello',
          summary: 'Say hello',
          commands: [{ name: 'world', summary: 'Greet', usage: 'zcc hello world' }],
          async run(argv) {
            return { exitCode: 0, stdout: 'hello ' + argv.join(' ') + '\\n' };
          }
        });
        zcc.agents.contributeInstructions('Be kind.');
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    expect(service.cliContributions()).toEqual([
      {
        pluginId: 'hello',
        name: 'hello',
        summary: 'Say hello',
        commands: [{ name: 'world', summary: 'Greet', usage: 'zcc hello world' }]
      }
    ]);
    await expect(service.runCliCommand('hello', ['world'])).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'hello world\n'
    });
    const generated = join(dataDir, 'skills-generated', 'plugin-commands', 'SKILL.md');
    expect(existsSync(generated)).toBe(true);
    expect(readFileSync(generated, 'utf8')).toContain('zcc hello');
    expect(readFileSync(join(dataDir, 'skills-generated', 'plugin-instructions', 'SKILL.md'), 'utf8')).toContain(
      'Be kind.'
    );
    await service.disable('hello');
    expect(existsSync(join(dataDir, 'skills-generated', 'plugin-commands'))).toBe(false);
  });

  it('reconcileBuiltins skips official autoInstall:false plugins such as tasks', async () => {
    const dataDir = root();
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    writePlugin(join(bundled, 'tasks'), 'tasks');
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    const installed = await service.reconcileBuiltins();
    expect(installed.map((row) => row.id)).toContain('docs');
    expect(installed.map((row) => row.id)).not.toContain('tasks');
    expect(service.get('tasks')).toBeUndefined();
  });
});

describe('defaultPluginDataDir', () => {
  const prevData = process.env.ZCC_DATA_DIR;
  const prevCenter = process.env.ZCC_CENTER_DIR;

  afterEach(() => {
    if (prevData === undefined) delete process.env.ZCC_DATA_DIR;
    else process.env.ZCC_DATA_DIR = prevData;
    if (prevCenter === undefined) delete process.env.ZCC_CENTER_DIR;
    else process.env.ZCC_CENTER_DIR = prevCenter;
  });

  it('prefers ZCC_DATA_DIR so Browse joins the same store the host writes', () => {
    process.env.ZCC_DATA_DIR = '/tmp/zcc-data-dir';
    process.env.ZCC_CENTER_DIR = '/tmp/zcc-center-dir';
    expect(defaultPluginDataDir()).toBe('/tmp/zcc-data-dir');
  });
});

describe('listBundledPluginCatalog', () => {
  it('returns [] when the root is missing', () => {
    expect(listBundledPluginCatalog(join(root(), 'no-such'))).toEqual([]);
  });

  it('enumerates package.json zcc plugins and skips junk dirs', () => {
    const bundled = root();
    writePlugin(join(bundled, 'echo'), 'echo');
    mkdirSync(join(bundled, 'empty'), { recursive: true });
    writeFileSync(join(bundled, 'README.md'), 'not a plugin\n');
    const out = listBundledPluginCatalog(bundled);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'echo',
      version: '0.1.0',
      title: 'echo',
      icon: 'Puzzle',
      description: 'echo plugin',
      apiRange: '',
      permissions: []
    });
  });

  it('skips a dir whose package name derives a different id', () => {
    const bundled = root();
    const dir = join(bundled, 'other');
    writePlugin(dir, 'echo');
    expect(listBundledPluginCatalog(bundled)).toEqual([]);
  });

  it('never throws on a malformed package.json', () => {
    const bundled = root();
    mkdirSync(join(bundled, 'broken'), { recursive: true });
    writeFileSync(join(bundled, 'broken', 'package.json'), '{not json');
    expect(listBundledPluginCatalog(bundled)).toEqual([]);
  });

  it('catalogues first-party plugins from the repo plugins/ tree', () => {
    const pluginsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugins');
    const out = listBundledPluginCatalog(pluginsRoot);
    expect(out.some((entry) => entry.id === 'docs' && entry.title === 'Docs')).toBe(true);
    expect(out.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['docs', 'tasks', 'custom-instructions', 'ask-user-question', 'salesforce'])
    );
  });
});

describe('installBundledPlugin', () => {
  it('returns null when the id is not a plugin package in the bundled root', async () => {
    expect(await installBundledPlugin('echo', { dataDir: root(), bundledRoot: root() })).toBeNull();
  });

  it('installs a bundled plugin and is idempotent once installed', async () => {
    const dataDir = root();
    const bundled = root();
    writePlugin(join(bundled, 'echo'), 'echo');
    const first = await installBundledPlugin('echo', { dataDir, bundledRoot: bundled });
    expect(first).toEqual({ ok: true, value: { id: 'echo' } });
    const second = await installBundledPlugin('echo', { dataDir, bundledRoot: bundled });
    expect(second).toEqual({ ok: true, value: { id: 'echo' } });
  });

  it('installs a registered builtin by builtin: source', async () => {
    const dataDir = root();
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    const res = await installBundledPlugin('docs', { dataDir, bundledRoot: bundled });
    expect(res).toEqual({ ok: true, value: { id: 'docs' } });
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    expect(service.get('docs')?.sourceKind).toBe('builtin');
  });
});
