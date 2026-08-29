import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '@zana-ai/zcc-domain/product';

let fakeHome: string;
let projectPath: string;

const projectFixture = (path: string): Project => ({
  id: 'proj-1',
  name: 'demo',
  path,
  tag: 'demo',
  defaultAgents: [],
  createdAt: Date.now(),
  lastActiveAt: Date.now()
});

async function freshImport() {
  return await import('./mcp-catalogue.js');
}

describe('mcp-catalogue', () => {
  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'cc-mcp-test-'));
    projectPath = await mkdtemp(join(tmpdir(), 'cc-mcp-proj-'));
    process.env.ZCC_CLAUDE_HOME = fakeHome;
    await mkdir(join(fakeHome, '.claude', 'plugins'), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.ZCC_CLAUDE_HOME;
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectPath, { recursive: true, force: true });
  });

  it('merges user, plugin, and project sources', async () => {
    // 1. User: ~/.claude.json
    await writeFile(
      join(fakeHome, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          uone: { command: 'node', args: ['user.js'] }
        }
      })
    );

    // 2. Plugin: registry + sibling .mcp.json
    const pluginPath = join(fakeHome, '.claude', 'plugins', 'my-plugin');
    await mkdir(pluginPath, { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        'my-plugin@user': {
          name: 'my-plugin',
          marketplace: 'user',
          installPath: pluginPath
        }
      })
    );
    await writeFile(
      join(pluginPath, '.mcp.json'),
      JSON.stringify({
        mcpServers: { pone: { url: 'http://localhost:9999' } }
      })
    );

    // 3. Project: <proj>/.mcp.json
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({
        mcpServers: { jone: { command: 'sh', args: ['-c', 'echo project'] } }
      })
    );

    const { listMcpServersAll } = await freshImport();
    const list = await listMcpServersAll([projectFixture(projectPath)]);
    const ids = list.map((e) => e.id).sort();
    expect(ids).toContain('user:uone');
    // plugin id includes the marketplace-qualified plugin id ("name@user")
    expect(ids).toContain('plugin:my-plugin@user:pone');
    expect(ids).toContain('project:proj-1:jone');

    const plug = list.find((e) => e.id === 'plugin:my-plugin@user:pone')!;
    expect(plug.transport).toBe('http');
    expect(plug.url).toBe('http://localhost:9999');
    expect(plug.enabledLockedBy).toBe('plugin');
    expect(plug.pluginName).toBe('my-plugin');
  });

  it('exposes MCP credential names but never their values', async () => {
    await writeFile(
      join(fakeHome, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          protected: {
            command: 'node',
            env: { API_TOKEN: 'do-not-expose' },
            headers: { Authorization: 'Bearer do-not-expose' }
          }
        }
      })
    );

    const { listMcpServersAll } = await freshImport();
    const entry = (await listMcpServersAll([])).find((item) => item.id === 'user:protected');
    expect(entry).toMatchObject({ envKeys: ['API_TOKEN'], headerKeys: ['Authorization'] });
    expect(JSON.stringify(entry)).not.toContain('do-not-expose');
  });

  it('toggles a user-scope server via disabledMcpServers', async () => {
    await writeFile(
      join(fakeHome, '.claude.json'),
      JSON.stringify({ mcpServers: { srv: { command: 'x' } } })
    );

    const { listMcpServersAll, setMcpServerEnabledById } = await freshImport();
    const before = await listMcpServersAll([]);
    expect(before.find((e) => e.id === 'user:srv')?.enabled).toBe(true);

    const r = await setMcpServerEnabledById('user:srv', false, []);
    expect(r.ok).toBe(true);

    const settingsPath = join(fakeHome, '.claude', 'settings.json');
    const raw = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(raw.disabledMcpServers).toEqual(['srv']);

    const after = await listMcpServersAll([]);
    expect(after.find((e) => e.id === 'user:srv')?.enabled).toBe(false);

    // Re-enable removes the entry rather than leaving stale empty list
    await setMcpServerEnabledById('user:srv', true, []);
    const raw2 = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(raw2.disabledMcpServers).toBeUndefined();
  });

  it('refuses to toggle a plugin-source server, returns LOCKED_BY_PLUGIN', async () => {
    const pluginPath = join(fakeHome, '.claude', 'plugins', 'p');
    await mkdir(pluginPath, { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'p@user': { name: 'p', marketplace: 'user', installPath: pluginPath } })
    );
    await writeFile(
      join(pluginPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { svc: { command: 'x' } } })
    );

    const { setMcpServerEnabledById } = await freshImport();
    const r = await setMcpServerEnabledById('plugin:p@user:svc', false, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('LOCKED_BY_PLUGIN');
  });

  it('disambiguates plugin-source servers by marketplace when names collide', async () => {
    // Two plugins share the same name "shared" across different marketplaces;
    // both ship a server named "svc". Ids must not collide.
    const plugA = join(fakeHome, '.claude', 'plugins', 'marketplaces', 'core', 'plugins', 'shared');
    const plugB = join(fakeHome, '.claude', 'plugins', 'marketplaces', 'extras', 'plugins', 'shared');
    await mkdir(plugA, { recursive: true });
    await mkdir(plugB, { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'shared@core': [{ scope: 'user', installPath: plugA, lastUpdated: '2026-01-01T00:00:00Z' }],
          'shared@extras': [{ scope: 'user', installPath: plugB, lastUpdated: '2026-01-01T00:00:00Z' }]
        }
      })
    );
    await writeFile(
      join(plugA, '.mcp.json'),
      JSON.stringify({ mcpServers: { svc: { command: 'a' } } })
    );
    await writeFile(
      join(plugB, '.mcp.json'),
      JSON.stringify({ mcpServers: { svc: { command: 'b' } } })
    );

    const { listMcpServersAll } = await freshImport();
    const list = await listMcpServersAll([]);
    const ids = list.map((e) => e.id).sort();
    expect(ids).toEqual([
      'plugin:shared@core:svc',
      'plugin:shared@extras:svc'
    ]);
  });

  it('toggles a project-scope server via .claude/settings.local.json', async () => {
    await writeFile(
      join(projectPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { svc: { command: 'x' } } })
    );

    const { listMcpServersAll, setMcpServerEnabledById } = await freshImport();
    const project = projectFixture(projectPath);

    const before = await listMcpServersAll([project]);
    expect(before.find((e) => e.id === 'project:proj-1:svc')?.enabled).toBe(true);

    const r = await setMcpServerEnabledById('project:proj-1:svc', false, [project]);
    expect(r.ok).toBe(true);

    const localPath = join(projectPath, '.claude', 'settings.local.json');
    const raw = JSON.parse(await readFile(localPath, 'utf-8'));
    expect(raw.mcpServers.svc.disabled).toBe(true);

    const after = await listMcpServersAll([project]);
    expect(after.find((e) => e.id === 'project:proj-1:svc')?.enabled).toBe(false);
  });

  it('plugin-source server is `enabled: false` when its plugin is disabled', async () => {
    const pluginPath = join(fakeHome, '.claude', 'plugins', 'p');
    await mkdir(pluginPath, { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ 'p@user': { name: 'p', marketplace: 'user', installPath: pluginPath } })
    );
    await writeFile(
      join(pluginPath, '.mcp.json'),
      JSON.stringify({ mcpServers: { svc: { command: 'x' } } })
    );
    // Disable the plugin via settings.json.enabledPlugins.
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
    await writeFile(
      join(fakeHome, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'p@user': false } })
    );

    const { listMcpServersAll } = await freshImport();
    const list = await listMcpServersAll([]);
    const entry = list.find((e) => e.id === 'plugin:p@user:svc');
    expect(entry?.enabled).toBe(false);
  });
});
