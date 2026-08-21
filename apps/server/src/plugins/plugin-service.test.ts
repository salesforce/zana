import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginService } from './plugin-service.js';
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
    await service.enable('keep');
    expect(service.get('keep')?.status).toBe('running');
    await service.remove('keep');
    expect(service.get('keep')).toBeUndefined();
    expect(existsSync(pluginDir)).toBe(true);
  });

  it('rejects native addons and npm installs without ignore-scripts would be the spawn contract', async () => {
    expect(containsNativeAddon('/x', ['foo.node'])).toBe(true);
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
  });

  it('rejects a server entry that escapes the plugin root', async () => {
    const { resolveContainedEntry } = await import('./plugin-api.js');
    const dir = root();
    writeFileSync(join(dir, 'ok.mjs'), 'export default function plugin() {}\n');
    expect(() => resolveContainedEntry(dir, '../outside.mjs')).toThrow(/escapes/);
    expect(resolveContainedEntry(dir, 'ok.mjs')).toContain('ok.mjs');
  });
});
