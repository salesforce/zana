import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPluginCommand } from './plugin-commands.js';

function okReloadFetch(seen: string[]): typeof fetch {
  return (async (input, init) => {
    seen.push(`${String(init?.method)} ${String(input)}`);
    return new Response(JSON.stringify(init?.method === 'GET'
      ? { apps: [{ id: 'gus', status: 'running', statusDetail: null }] }
      : { ok: true, value: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('plugin commands', () => {
  it('scaffolds a package.json zcc plugin', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-new-'));
    dirs.push(dest);
    const result = await runPluginCommand(dest, 'new', ['Hello', '--dir', dest], false);
    expect(result.exitCode).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      zcc: { name: string; server: string; app: string; skills?: string[] };
      engines: { zcc: string };
    };
    expect(pkg.zcc.name).toBe('Hello');
    expect(pkg.zcc.server).toBe('./server.ts');
    expect(pkg.engines.zcc).toMatch(/>=/);
    expect(pkg.zcc.skills).toEqual(['skills']);
    expect(readFileSync(join(dest, 'skills', 'hello', 'SKILL.md'), 'utf8')).toMatch(/hello/);
    expect(result.stdout).toMatch(/zcc plugin install \./);
  });

  it('defaults dest to ./zcc-plugin-<id>', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zcc-plugin-cwd-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-data-'));
    dirs.push(cwd, dataDir);
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      const result = await runPluginCommand(dataDir, 'new', ['Hello'], false);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(join(cwd, 'zcc-plugin-hello'));
      expect(readFileSync(join(cwd, 'zcc-plugin-hello', 'package.json'), 'utf8')).toContain('Hello');
    } finally {
      process.chdir(prev);
    }
  });

  it('reloads over product HTTP without a control socket', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-reload-'));
    dirs.push(dataDir);
    const seen: string[] = [];
    const result = await runPluginCommand(dataDir, 'reload', ['gus'], false, {
      fetchImpl: okReloadFetch(seen)
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Reloaded gus/);
    expect(seen.join('\n')).toMatch(/POST .*\/api\/v1\/plugin-apps\/gus\/reload/);
  });

  it('maps a product HTTP connection failure on reload to not running', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-reload-down-'));
    dirs.push(dataDir);
    const result = await runPluginCommand(dataDir, 'reload', ['gus'], false, {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not running/);
  });

  it('plugin dev --once reloads over product HTTP without a control socket', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-devonce-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-devonce-data-'));
    dirs.push(dest, dataDir);
    writeFileSync(
      join(dest, 'package.json'),
      JSON.stringify({
        name: 'zcc-plugin-gus',
        zcc: { name: 'Gus', server: './server.ts' }
      })
    );
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(
      join(dataDir, 'plugins', 'installed.json'),
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: 'gus',
            name: 'Gus',
            version: '1.0.0',
            enabled: true,
            status: 'running',
            source: `path:${dest}`
          }
        ]
      })
    );
    const seen: string[] = [];
    const result = await runPluginCommand(dataDir, 'dev', [dest, '--once'], false, {
      fetchImpl: okReloadFetch(seen)
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Reloaded gus/);
    expect(seen.join('\n')).toMatch(/POST .*\/api\/v1\/plugin-apps\/gus\/reload/);
  });

  it('refuses plugin dev until the directory is installed', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-dev-'));
    dirs.push(dest);
    await runPluginCommand(dest, 'new', ['Devme', '--dir', dest], false);
    const result = await runPluginCommand(dest, 'dev', [dest, '--once'], false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/not installed as a plugin/);
  });

  function installedDevPlugin(app?: string): { dest: string; dataDir: string } {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-dev-check-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-dev-check-data-'));
    dirs.push(dest, dataDir);
    writeFileSync(join(dest, 'package.json'), JSON.stringify({
      name: 'zcc-plugin-gus', zcc: { name: 'Gus', server: './server.ts', app }
    }));
    mkdirSync(join(dataDir, 'plugins'));
    writeFileSync(join(dataDir, 'plugins', 'installed.json'), JSON.stringify({
      version: 1, plugins: [{ id: 'gus', source: `path:${dest}` }]
    }));
    return { dest, dataDir };
  }

  it('accepts --once without a directory and emits machine-readable success', async () => {
    const { dest, dataDir } = installedDevPlugin();
    const previous = process.cwd();
    process.chdir(dest);
    try {
      const result = await runPluginCommand(dataDir, 'dev', ['--once'], true, {
        fetchImpl: okReloadFetch([])
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ pluginId: 'gus', reloaded: true });
    } finally {
      process.chdir(previous);
    }
  });

  it.each([['--bad'], ['one', 'two']])('rejects invalid dev arguments %j', async (...args) => {
    const result = await runPluginCommand('', 'dev', args, false);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Usage:');
  });

  it('returns failure and never reloads when the app cannot compile', async () => {
    const { dest, dataDir } = installedDevPlugin('./app.tsx');
    writeFileSync(join(dest, 'app.tsx'), 'export default <broken');
    const seen: string[] = [];
    const result = await runPluginCommand(dataDir, 'dev', ['--once', dest], false, {
      fetchImpl: okReloadFetch(seen)
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('app failed:');
    expect(result.stdout).not.toContain('Reloaded');
    expect(seen).toEqual([]);
  });

  it('returns failure when the reload request fails', async () => {
    const { dest, dataDir } = installedDevPlugin();
    const result = await runPluginCommand(dataDir, 'dev', [dest, '--once'], false, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'factory failed' }), { status: 400 })
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('factory failed');
    expect(result.stdout).not.toContain('Reloaded');
  });

  it.each([
    { id: 'gus', status: 'running', statusDetail: 'reload failed: broken factory' },
    { id: 'gus', status: 'degraded', statusDetail: 'startup error' },
    { id: 'gus', status: 'needs-configuration', statusDetail: 'Set an API key' },
    { id: 'gus', status: 'disabled' },
    { id: 'different', status: 'running' }
  ])('does not report a verified reload for %j', async (plugin) => {
    const result = await runPluginCommand('', 'reload', ['gus'], false, {
      fetchImpl: async (_input, init) => new Response(JSON.stringify(init?.method === 'POST'
        ? { ok: true, value: true } : { apps: [plugin] }))
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('Reloaded');
  });

  it('propagates an unavailable health snapshot after an acknowledged reload', async () => {
    const result = await runPluginCommand('', 'reload', ['gus'], false, {
      fetchImpl: async (_input, init) => init?.method === 'POST'
        ? new Response(JSON.stringify({ ok: true, value: true }))
        : new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unavailable');
  });

  it('tails plugin logs from disk when the app is not running', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-logs-'));
    dirs.push(dataDir);
    const logDir = join(dataDir, 'plugins', 'hello', 'logs');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'plugin.log'), `${JSON.stringify({ ts: 1, level: 'info', message: 'hi' })}\n`);
    const result = await runPluginCommand(dataDir, 'logs', ['hello', '-n', '10'], false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/hi/);
  });

  it('scaffolds an app-only plugin with --app', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-app-'));
    dirs.push(dest);
    const result = await runPluginCommand(dest, 'new', ['Panel', '--dir', dest, '--app'], false);
    expect(result.exitCode).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      zcc: { app?: string; server?: string };
    };
    expect(pkg.zcc.app).toBe('./app.tsx');
    expect(pkg.zcc.server).toBe('./server.ts');
    const server = readFileSync(join(dest, 'server.ts'), 'utf8');
    expect(server).toContain("zcc.rpc.method('list'");
    expect(readFileSync(join(dest, 'app.tsx'), 'utf8')).toContain('useRpc');
    expect(readFileSync(join(dest, 'app.test.tsx'), 'utf8')).toContain('loadPluginApp');
  });

  it('writes bundled types into a scaffolded plugin', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-types-'));
    dirs.push(dest);
    await runPluginCommand(dest, 'new', ['Typed', '--dir', dest], false);
    const result = await runPluginCommand(dest, 'types', [dest], false);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(dest, 'types', 'zcc-plugin-sdk.d.ts'), 'utf8')).toContain('ZccPluginApi');
  });

  it('rejects search when the app is not running', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-search-'));
    dirs.push(dataDir);
    const result = await runPluginCommand(dataDir, 'search', ['docs'], false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/APP_NOT_RUNNING/);
  });

  it('rejects outdated and update when the app is not running', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-outdated-'));
    dirs.push(dataDir);
    expect((await runPluginCommand(dataDir, 'outdated', [], false)).exitCode).toBe(1);
    expect((await runPluginCommand(dataDir, 'update', ['docs'], false)).exitCode).toBe(1);
  });

  it('lists zero plugins from an empty data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-ls-'));
    dirs.push(dataDir);
    const result = await runPluginCommand(dataDir, 'ls', [], false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No plugins installed/);
  });
});
