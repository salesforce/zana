import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPluginCommand } from './plugin-commands.js';

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
    expect(pkg.zcc.server).toBe('./server.mjs');
    expect(pkg.engines.zcc).toMatch(/>=/);
    expect(pkg.zcc.skills).toEqual(['skills']);
    expect(readFileSync(join(dest, 'skills', 'hello', 'SKILL.md'), 'utf8')).toMatch(/hello/);
  });

  it('scaffolds an app-only plugin with --app', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'zcc-plugin-app-'));
    dirs.push(dest);
    const result = await runPluginCommand(dest, 'new', ['Panel', '--dir', dest, '--app'], false);
    expect(result.exitCode).toBe(0);
    const pkg = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')) as {
      zcc: { app?: string; server?: string };
    };
    expect(pkg.zcc.app).toBe('./app.js');
    expect(pkg.zcc.server).toBeUndefined();
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
