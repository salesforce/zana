import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests inject ZCC_CLAUDE_HOME *before* importing the modules under test, so
// that the lazy `getClaudeDir()` resolver picks up the temp dir.
let fakeHome: string;

async function freshImport() {
  // vitest module cache: use dynamic import after env is set, then reset
  // each suite run.
  const plugins = await import('../plugins.js');
  return plugins;
}

describe('plugins', () => {
  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'cc-plugins-test-'));
    process.env.ZCC_CLAUDE_HOME = fakeHome;
    await mkdir(join(fakeHome, '.claude', 'plugins'), { recursive: true });
  });

  afterEach(async () => {
    delete process.env.ZCC_CLAUDE_HOME;
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('lists plugins from installed_plugins.json (legacy flat-map shape)', async () => {
    const claude = join(fakeHome, '.claude');
    const plugins = join(claude, 'plugins');
    const zanaDir = join(plugins, 'marketplaces', 'core', 'plugins', 'zana');
    await mkdir(join(zanaDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(zanaDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'zana', version: '0.2.0', description: 'orchestrator' })
    );
    await writeFile(
      join(plugins, 'installed_plugins.json'),
      JSON.stringify({
        'zana@core': {
          name: 'zana',
          marketplace: 'core',
          version: '0.2.0',
          installPath: zanaDir
        }
      })
    );

    const { listPlugins } = await freshImport();
    const list = await listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'zana@core',
      name: 'zana',
      source: 'marketplace',
      marketplace: 'core',
      version: '0.2.0',
      description: 'orchestrator',
      enabled: true,
      manifestValid: true
    });
  });

  it('parses the v2 wrapped registry shape (current Claude CLI)', async () => {
    const claude = join(fakeHome, '.claude');
    const plugins = join(claude, 'plugins');
    const installPath = join(plugins, 'cache', 'mp', 'demo', '1.0.0');
    await mkdir(join(installPath, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' })
    );
    // Older + newer install for the same id; we should pick the newer one.
    await writeFile(
      join(plugins, 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'demo@mp': [
            {
              scope: 'user',
              installPath: '/nope/old/install',
              version: '0.9.0',
              installedAt: '2025-01-01T00:00:00Z',
              lastUpdated: '2025-01-01T00:00:00Z'
            },
            {
              scope: 'user',
              installPath,
              version: '1.0.0',
              installedAt: '2026-05-01T00:00:00Z',
              lastUpdated: '2026-06-01T00:00:00Z'
            }
          ]
        }
      })
    );

    const { listPlugins } = await freshImport();
    const list = await listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'demo@mp',
      name: 'demo',
      version: '1.0.0',
      source: 'marketplace',
      marketplace: 'mp',
      path: installPath,
      manifestValid: true
    });
  });

  it('skips marketplaces with `.disabled` suffix and `temp_*` staging dirs', async () => {
    const plugins = join(fakeHome, '.claude', 'plugins');
    // Real plugin
    await mkdir(join(plugins, 'marketplaces', 'good', 'plugins', 'real'), {
      recursive: true
    });
    // Disabled marketplace
    await mkdir(join(plugins, 'marketplaces', 'old.disabled', 'plugins', 'real'), {
      recursive: true
    });
    // Staging dir
    await mkdir(join(plugins, 'marketplaces', 'temp_abc123', 'plugins', 'real'), {
      recursive: true
    });
    // No registry — fall back to FS enumeration.

    const { listPlugins } = await freshImport();
    const list = await listPlugins();
    expect(list.map((p) => `${p.name}@${p.marketplace}`).sort()).toEqual([
      'real@good'
    ]);
  });

  it('round-trips setPluginEnabled through enabledPlugins', async () => {
    const claude = join(fakeHome, '.claude');
    const plugins = join(claude, 'plugins');
    const dir = join(plugins, 'foo');
    await mkdir(join(dir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'foo' })
    );
    // No installed_plugins.json — listInstalledPlugins falls back to FS scan,
    // which is enough for this round-trip test.

    const { listPlugins, setPluginEnabled } = await freshImport();

    let list = await listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('foo@user');
    expect(list[0].enabled).toBe(true);

    const r1 = await setPluginEnabled('foo@user', false);
    expect(r1.ok).toBe(true);

    const settingsPath = join(claude, 'settings.json');
    const raw = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(raw.enabledPlugins).toEqual({ 'foo@user': false });

    list = await listPlugins();
    expect(list[0].enabled).toBe(false);

    // Re-enabling deletes the key (keep the file tidy) rather than writing true
    const r2 = await setPluginEnabled('foo@user', true);
    expect(r2.ok).toBe(true);
    const raw2 = JSON.parse(await readFile(settingsPath, 'utf-8'));
    expect(raw2.enabledPlugins).toBeUndefined();
  });

  it('marks manifestValid=false when plugin.json is missing', async () => {
    const claude = join(fakeHome, '.claude');
    const dir = join(claude, 'plugins', 'broken');
    await mkdir(dir, { recursive: true });
    // No .claude-plugin/plugin.json — empty plugin dir.

    const { listPlugins } = await freshImport();
    const list = await listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].manifestValid).toBe(false);
    expect(list[0].id).toBe('broken@user');
  });

  it('rejects an id that is missing the @marketplace suffix', async () => {
    const { setPluginEnabled } = await freshImport();
    const r = await setPluginEnabled('not-a-real-id', false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ID');
  });

  it('computes provides counters from the on-disk plugin layout', async () => {
    const claude = join(fakeHome, '.claude');
    const dir = join(claude, 'plugins', 'multi');
    await mkdir(join(dir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'multi' })
    );
    // Skills under skills/<name>/SKILL.md
    await mkdir(join(dir, 'skills', 'a'), { recursive: true });
    await writeFile(join(dir, 'skills', 'a', 'SKILL.md'), '# a');
    await mkdir(join(dir, 'skills', 'b'), { recursive: true });
    await writeFile(join(dir, 'skills', 'b', 'SKILL.md'), '# b');
    // Commands under commands/<name>.md
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(join(dir, 'commands', 'one.md'), '');
    await writeFile(join(dir, 'commands', 'two.md'), '');
    // MCP under .mcp.json
    await writeFile(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { srv1: { command: 'x' } } })
    );

    const { listPlugins } = await freshImport();
    const list = await listPlugins();
    expect(list[0].provides.skills).toEqual(['a', 'b']);
    expect(list[0].provides.commands).toEqual(['one', 'two']);
    expect(list[0].provides.mcpServers).toEqual(['srv1']);
  });
});
