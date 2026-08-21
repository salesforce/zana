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

  it('lists zero plugins from an empty data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-ls-'));
    dirs.push(dataDir);
    const result = await runPluginCommand(dataDir, 'ls', [], false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/No plugins installed/);
  });
});
