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
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';

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

  it('reloads the live package.json server entry instead of a stale stored path', async () => {
    const dataDir = root();
    const pluginDir = join(root(), 'stale-entry');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-stale-entry',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'stale-entry',
          description: 'stale entry',
          branding: { icon: 'Puzzle' },
          server: './server.ts'
        }
      })
    );
    writeFileSync(
      join(pluginDir, 'server.ts'),
      `export default function plugin(zcc: { rpc: { method: (name: string, handler: () => unknown) => void } }) {
        zcc.rpc.method('ping', () => ({ from: 'ts' }));
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('running');
    expect(row.serverEntry).toBe('./server.ts');
    await expect(service.callRpc('stale-entry', 'ping', {})).resolves.toEqual({ from: 'ts' });
    writeFileSync(
      join(pluginDir, 'server.mjs'),
      `export default function plugin(zcc) {
        zcc.rpc.method('ping', () => ({ from: 'mjs' }));
      }\n`
    );
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-stale-entry',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'stale-entry',
          description: 'stale entry',
          branding: { icon: 'Puzzle' },
          server: './server.mjs'
        }
      })
    );
    const reloaded = await service.reload('stale-entry');
    expect(reloaded.status).toBe('running');
    expect(reloaded.serverEntry).toBe('./server.mjs');
    await expect(service.callRpc('stale-entry', 'ping', {})).resolves.toEqual({ from: 'mjs' });
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

  it('resolves mention providers and stamps contributions with label and triggers', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'notes'),
      'notes',
      `export default function plugin(zcc) {
        zcc.ui.registerMentionProvider({
          id: 'note',
          label: 'Notes',
          triggers: ['@', '#'],
          search: ({ query }) => [{ id: '1', label: query || 'One' }],
          resolve: (itemId) => ({ context: 'body for ' + itemId })
        });
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    expect(service.mentionProviders()).toEqual([
      { pluginId: 'notes', id: 'note', label: 'Notes', trigger: '@', triggers: ['@', '#'] }
    ]);
    await expect(
      service.resolveMention({ pluginId: 'notes', itemId: 'note:1' })
    ).resolves.toEqual({ ok: true, context: 'body for 1' });
    await expect(
      service.resolveMention({ pluginId: 'notes', itemId: 'missing:1' })
    ).resolves.toMatchObject({ ok: false });
    await expect(
      service.resolveMention({ pluginId: 'gone', itemId: 'note:1' })
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/not running/) });
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

  it('installs a catalog git plugin from subdir and refuses an escaping subdir', async () => {
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
            id: 'notes',
            displayName: 'Notes',
            description: 'notes plugin',
            author: { name: 'zana' },
            source: {
              git: {
                url: 'https://example.test/zana.git',
                subdir: 'plugins/notes',
                ref: 'HEAD'
              }
            }
          },
          {
            id: 'evil',
            displayName: 'Evil',
            description: 'escape',
            author: { name: 'zana' },
            source: {
              git: {
                url: 'https://example.test/zana.git',
                subdir: '../outside',
                ref: 'HEAD'
              }
            }
          }
        ]
      }),
      cloneGit: async (_url, dest) => {
        mkdirSync(dest, { recursive: true });
        writePlugin(join(dest, 'plugins', 'notes'), 'notes');
        return { commit: 'abc1234' };
      }
    });
    await service.addMarketplace('https://example.test/marketplace.json');
    const row = await service.install('notes@official');
    expect(row.id).toBe('notes');
    expect(row.provenance).toBe('catalog');
    expect(row.rootDir).toMatch(/plugins[\\/]notes$/);
    expect(row.gitResolvedCommit).toBe('abc1234');
    await expect(service.install('evil@official')).rejects.toThrow(/not contained/);
  });

  it('seeds an official marketplace from ZCC_OFFICIAL_MARKETPLACE_URL and stays up if fetch fails', async () => {
    const dataDir = root();
    const previous = process.env.ZCC_OFFICIAL_MARKETPLACE_URL;
    process.env.ZCC_OFFICIAL_MARKETPLACE_URL = 'https://example.test/marketplace/v1/marketplace.json';
    try {
      const ok = createPluginService({
        dataDir,
        bundledRoot: root(),
        fetchJson: async () => ({
          schemaVersion: 1,
          name: 'official',
          displayName: 'Zana official plugins',
          plugins: [
            {
              id: 'tasks',
              displayName: 'Tasks',
              description: 'tasks',
              author: { name: 'Zana' },
              source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/tasks', ref: 'HEAD' } }
            }
          ]
        })
      });
      await ok.start();
      const catalogs = ok.listMarketplaces();
      expect(catalogs).toHaveLength(1);
      expect(catalogs[0]?.official).toBe(true);
      expect(catalogs[0]?.name).toBe('official');
      await expect(ok.removeMarketplace(catalogs[0]!.source)).rejects.toThrow(/cannot be removed/);

      const failing = createPluginService({
        dataDir: root(),
        bundledRoot: root(),
        fetchJson: async () => {
          throw new Error('unreachable');
        }
      });
      await expect(failing.start()).resolves.toBeUndefined();
      expect(failing.listMarketplaces()).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.ZCC_OFFICIAL_MARKETPLACE_URL;
      else process.env.ZCC_OFFICIAL_MARKETPLACE_URL = previous;
    }
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
    expect(toPluginAppSnapshot({
      ...service.snapshot()[0]!,
      availableVersion: '9.9.9'
    })).toMatchObject({ availableVersion: '9.9.9' });
  });

  it('serves a compiled JS sibling for app.tsx and never a raw TypeScript URL', async () => {
    const dataDir = root();
    const pluginDir = join(root(), 'tsx-app');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-tsx-app',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'tsx-app',
          description: 'tsx app',
          branding: { icon: 'Puzzle' },
          app: './app.tsx'
        }
      })
    );
    writeFileSync(join(pluginDir, 'app.tsx'), 'export default { __zccPluginApp: true, setup() {} }\n');
    const service = createPluginService({ dataDir, bundledRoot: root(), now: () => 7 });
    await service.install(pluginDir);
    expect(service.snapshot()[0]?.appUrl).toBeNull();

    writeFileSync(join(pluginDir, 'app.js'), 'export default { __zccPluginApp: true, setup() {} }\n');
    expect(service.snapshot()[0]?.appUrl).toBe('/plugins/tsx-app/assets/app.js?v=7');
    expect(service.snapshot()[0]?.appUrl).not.toMatch(/\.tsx(\?|$)/);
  });

  it('reads name and description from the live manifest, not a stale install snapshot', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'claude'), 'provider-claude-code');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    expect(service.snapshot()[0]?.description).toBe('provider-claude-code plugin');

    const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')) as {
      zcc: { name: string; description: string };
    };
    pkg.zcc.name = 'Claude Code provider';
    pkg.zcc.description = 'Run Zana threads with Claude Code.';
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify(pkg));

    expect(service.snapshot()[0]).toMatchObject({
      name: 'Claude Code provider',
      description: 'Run Zana threads with Claude Code.'
    });
    expect(service.get('provider-claude-code')?.description).toBe('provider-claude-code plugin');
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

  it('rebases a builtin plugin onto the current bundledRoot', async () => {
    const dataDir = root();
    const firstBundled = root();
    const nextBundled = root();
    writePlugin(join(firstBundled, 'docs'), 'docs');
    writePlugin(join(nextBundled, 'docs'), 'docs');
    const first = createPluginService({ dataDir, bundledRoot: firstBundled });
    await first.reconcileBuiltins();
    expect(first.get('docs')?.rootDir).toBe(join(firstBundled, 'docs'));
    const next = createPluginService({ dataDir, bundledRoot: nextBundled });
    await next.reconcileBuiltins();
    expect(next.get('docs')?.rootDir).toBe(join(nextBundled, 'docs'));
  });

  it('does not auto-reinstall a builtin after uninstall', async () => {
    const dataDir = root();
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    await service.reconcileBuiltins();
    expect(service.get('docs')?.id).toBe('docs');
    await service.remove('docs');
    expect(service.get('docs')).toBeUndefined();
    const again = await service.reconcileBuiltins();
    expect(again).toEqual([]);
    expect(service.get('docs')).toBeUndefined();
    await service.install(join(bundled, 'docs'));
    expect(service.get('docs')?.id).toBe('docs');
  });

  it('auto-uninstalls retired first-party leftovers instead of migrating them', async () => {
    const dataDir = root();
    const sidecar = join(dataDir, 'extensions', 'zana');
    writePlugin(sidecar, 'zana');
    const leftover = writePlugin(join(root(), 'consensus'), 'consensus');
    const keep = writePlugin(join(root(), 'keep'), 'keep');
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    await service.install(leftover);
    await service.install(keep);
    await service.start();
    expect(service.get('zana')).toBeUndefined();
    expect(service.get('consensus')).toBeUndefined();
    expect(existsSync(sidecar)).toBe(false);
    expect(service.get('keep')?.id).toBe('keep');
  });

  it('leaves a local-authored retired id in place', async () => {
    const dataDir = root();
    const sidecar = join(dataDir, 'extensions', 'zana');
    writePlugin(sidecar, 'zana');
    mkdirSync(join(dataDir, 'extensions'), { recursive: true });
    writeFileSync(
      join(dataDir, 'extensions', 'local.json'),
      JSON.stringify({ zana: { workingDir: sidecar } })
    );
    const bundled = root();
    writePlugin(join(bundled, 'docs'), 'docs');
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    await service.start();
    expect(existsSync(sidecar)).toBe(true);
    expect(service.get('zana')).toBeUndefined();
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
      expect.arrayContaining(['docs', 'tasks', 'custom-instructions', 'ask-user-question', 'salesforce', 'pr-monitor', 'plugin-guide'])
    );
  });

  it('auto-installs plugin-guide from the repo plugins tree with a compiled app', async () => {
    const pluginsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugins');
    const service = createPluginService({ dataDir: root(), bundledRoot: pluginsRoot });
    try {
      await service.start();
      const snap = service.snapshot().find((row) => row.id === 'plugin-guide');
      expect(snap?.status).toBe('running');
      expect(snap?.appUrl).toMatch(/\/plugins\/plugin-guide\/assets\/app\.js/);
    } finally {
      service.stop();
    }
  });

  it('lists and invokes plugin agent tools after configure()', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'sf-tools'),
      'sf-tools',
      `export default function plugin(zcc) {
        zcc.agents.registerTool({
          name: 'echo_tool',
          description: 'Echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          execute: async (input) => ({ ok: true, input })
        });
        zcc.agents.registerTool({
          name: 'hidden_tool',
          description: 'Hidden',
          execute: async () => ({ ok: true })
        });
        zcc.agents.configure(({ projectId }) => {
          if (projectId === 'skip') return {};
          return { tools: ['echo_tool'], instructions: 'Use echo_tool.' };
        });
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    await service.install(pluginDir);
    const configured = await service.sessionTools({ threadId: 'thr-1', projectId: 'proj-1' });
    expect(configured.tools.map((row) => row.name)).toEqual(['echo_tool']);
    expect(configured.instructions).toBe('Use echo_tool.');
    const skipped = await service.sessionTools({ threadId: 'thr-1', projectId: 'skip' });
    expect(skipped.tools).toEqual([]);
    const invoked = await service.invokeAgentTool({
      name: 'echo_tool',
      input: { text: 'hi' },
      ctx: { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    });
    expect(invoked.success).toBe(true);
    expect(invoked.contentItems[0]?.text).toContain('"text":"hi"');
    const missing = await service.invokeAgentTool({
      name: 'hidden_tool',
      input: {},
      ctx: { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    });
    expect(missing.success).toBe(true);
    const unknown = await service.invokeAgentTool({
      name: 'nope',
      input: {},
      ctx: { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    });
    expect(unknown.success).toBe(false);
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

  it('publishes a packed host artifact on load and drops it on disable', async () => {
    const dataDir = root();
    const pluginDir = join(root(), 'hosty');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-hosty',
        version: '0.1.0',
        engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
        zcc: {
          name: 'hosty',
          description: 'host plugin',
          branding: { icon: 'Puzzle' },
          server: './server.mjs',
          host: './host.ts'
        }
      })
    );
    writeFileSync(join(pluginDir, 'server.mjs'), 'export default function plugin() {}\n');
    writeFileSync(join(pluginDir, 'host.ts'), 'export default { ready: true };\n');
    const pluginHostArtifacts = new PluginHostArtifactRegistry();
    const service = createPluginService({ dataDir, bundledRoot: root(), pluginHostArtifacts });
    const row = await service.install(pluginDir);
    expect(row.status).toBe('running');
    const snapshot = pluginHostArtifacts.get('hosty');
    expect(snapshot?.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(snapshot?.path).toBe(join(pluginDir, 'dist', 'host.js'));
    await service.disable('hosty');
    expect(pluginHostArtifacts.get('hosty')).toBeUndefined();
  });

  it('hot-reloads a watched builtin plugin when a source file changes', async () => {
    const dataDir = root();
    const bundled = root();
    const pluginDir = writePlugin(join(bundled, 'docs'), 'docs');
    writeFileSync(join(pluginDir, 'notes.md'), 'v1\n');
    const service = createPluginService({
      dataDir,
      bundledRoot: bundled,
      watchBuiltinPluginSources: true
    });
    await service.start();
    const before = service.get('docs')?.updatedAt ?? 0;
    writeFileSync(join(pluginDir, 'notes.md'), 'v2\n');
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline && (service.get('docs')?.updatedAt ?? 0) <= before) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(service.get('docs')?.updatedAt ?? 0).toBeGreaterThan(before);
    service.stop();
  });
});
