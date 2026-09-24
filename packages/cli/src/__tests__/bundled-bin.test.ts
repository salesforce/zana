import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const bundledBin = join(repoRoot, 'packages', 'cli', 'dist', 'bin', 'zcc.js');

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('bundled zcc bin', () => {
  it('scaffolds and builds outside the checkout using only packaged CLI files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-packaged-authoring-'));
    dirs.push(root);
    const copied = join(root, 'cli');
    cpSync(join(repoRoot, 'packages/cli/dist'), copied, { recursive: true, dereference: true });
    const bin = join(copied, 'bin/zcc');
    const env = { ...process.env, ZCC_SKIP_PLUGIN_NPM: '1', NODE_PATH: '', ESBUILD_BINARY_PATH: '' };
    await execFileAsync(process.execPath, [bin, 'plugin', 'new', 'portable', '--app'], { cwd: root, env });
    const plugin = join(root, 'zcc-plugin-portable');
    const { stdout } = await execFileAsync(process.execPath, [bin, 'plugin', 'build'], { cwd: plugin, env });
    expect(stdout).toContain('Built');
    const app = readFileSync(join(plugin, 'app.js'), 'utf8');
    expect(app).toContain('__ZCC_HOST_REACT__');
    expect(app).not.toMatch(/from\s*["'](?:react|@zana-ai)/);
    expect(readFileSync(join(plugin, 'server.mjs'), 'utf8')).toContain('todos');
    expect(readFileSync(join(plugin, 'types/zcc-plugin-sdk.d.ts'), 'utf8')).toBe(
      readFileSync(join(repoRoot, 'packages/plugin-sdk/bundled-types/zcc-plugin-sdk.d.ts'), 'utf8')
    );
    expect(readFileSync(join(plugin, 'AGENTS.md'), 'utf8')).toContain('LIVE_TEST.md');
  }, 30_000);

  it('loads plugin ls under plain Node without walking TypeScript sources', async () => {
    expect(existsSync(bundledBin)).toBe(true);
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-bundled-plugin-ls-'));
    dirs.push(dataDir);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      bundledBin,
      'plugin',
      'ls',
      '--data-dir',
      dataDir
    ]);
    expect(stderr).not.toMatch(/plugin-id\.js/);
    expect(stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(stdout).toMatch(/No plugins installed/);
  });
});
