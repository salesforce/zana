import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertCompleteBuild, buildElectron, prepareElectronRuntime, runCommand, validateMainSyntax, withBuildLock } from './electron-build-workspace.mjs';
import { ensureBetterSqlite3ForElectron } from './ensure-better-sqlite3.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zcc-build-test-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), '{}');
  mkdirSync(join(root, 'resources'));
  writeFileSync(join(root, 'resources', 'asset'), 'original');
  mkdirSync(join(root, 'node_modules'));
  const require = createRequire(import.meta.url);
  for (const name of ['better-sqlite3', 'node-pty']) {
    symlinkSync(dirname(require.resolve(`${name}/package.json`)), join(root, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  writeFileSync(join(root, 'node_modules', 'metadata'), 'immutable');
  mkdirSync(join(root, 'plugins', 'sample'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'sample', 'app.js'), 'plugin');
  mkdirSync(join(root, 'packages', 'cli', 'dist'), { recursive: true });
  writeFileSync(join(root, 'packages', 'cli', 'dist', 'bin.js'), 'cli');
  writeFileSync(join(root, 'packages', 'cli', 'package.json'), '{}');
  writeFileSync(join(root, 'packages', 'cli', 'source.ts'), 'source');
  mkdirSync(join(root, 'packages', 'other'));
  writeFileSync(join(root, 'README.md'), 'readme');
  completeBuild(join(root, 'out'));
  return root;
}
function completeBuild(out: string) {
  for (const file of ['main/index.js', 'main/server-runtime.js', 'preload/index.js', 'renderer/index.html']) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), 'original');
  }
}

describe('Electron verification workspace', () => {
  // Cold native compilation is setup, not part of the snapshot/concurrency
  // deadline. Match the bounded compiler budget on clean CI machines.
  beforeAll(() => { ensureBetterSqlite3ForElectron(); }, 11 * 60_000);

  it('serializes shared build preparation and releases on errors', async () => {
    const root = fixture();
    const order: string[] = [];
    await Promise.all([
      withBuildLock(root, async () => {
        order.push('start');
        await new Promise((resolve) => setTimeout(resolve, 100));
        order.push('end');
      }),
      withBuildLock(root, async () => { order.push('next'); })
    ]);
    expect(order).toEqual(['start', 'end', 'next']);
    await expect(withBuildLock(root, () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(withBuildLock(root, () => 42)).resolves.toBe(42);
  });

  it('marks failed builds unusable until a complete build succeeds', async () => {
    const root = fixture();
    const out = join(root, 'out');
    const run = vi.fn().mockResolvedValueOnce(1);
    expect(await buildElectron(root, out, run)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(() => assertCompleteBuild(out)).toThrow('incomplete');
    run.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(2);
    expect(await buildElectron(root, out, run)).toBe(2);
    expect(() => assertCompleteBuild(out)).toThrow('incomplete');
    run.mockReset().mockResolvedValue(0);
    expect(await buildElectron(root, out, run)).toBe(0);
    expect(run.mock.calls[1][2].env.ZCC_BUILD_OUT_DIR).toBe(out);
    expect(() => assertCompleteBuild(out)).not.toThrow();
    rmSync(join(out, 'renderer/index.html'));
    expect(() => assertCompleteBuild(out)).toThrow('renderer/index.html');
  });

  it('gives concurrent runs independent outputs and native packages', async () => {
    const root = fixture();
    const [a, b] = await Promise.all([prepareElectronRuntime({ root }), prepareElectronRuntime({ root })]);
    roots.push(a.root, b.root);
    expect(a.root).not.toBe(b.root);
    rmSync(join(root, 'out'), { recursive: true });
    rmSync(join(root, 'plugins'), { recursive: true });
    rmSync(join(root, 'packages', 'cli', 'dist'), { recursive: true });
    writeFileSync(join(root, 'resources', 'asset'), 'changed');
    for (const runtime of [a, b]) {
      expect(readFileSync(join(runtime.root, 'out/renderer/index.html'), 'utf8')).toBe('original');
      expect(readFileSync(join(runtime.root, 'resources/asset'), 'utf8')).toBe('original');
      expect(readFileSync(join(runtime.root, 'plugins/sample/app.js'), 'utf8')).toBe('plugin');
      expect(readFileSync(join(runtime.root, 'packages/cli/dist/bin.js'), 'utf8')).toBe('cli');
      expect(existsSync(join(runtime.root, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'))).toBe(true);
    }
    a.dispose();
    expect(existsSync(a.root)).toBe(false);
    expect(existsSync(join(b.root, 'out/renderer/index.html'))).toBe(true);
    expect(existsSync(join(root, 'package.json'))).toBe(true);
    b.dispose();
  }, 60_000);

  it('builds directly into its private directory and cleans a failed build', async () => {
    const root = fixture();
    let stage = '';
    const runtime = await prepareElectronRuntime({ root, build: true, buildApp: async (_root: string, out: string) => {
      stage = dirname(out);
      completeBuild(out);
      return 0;
    } });
    expect(runtime.root).toBe(stage);
    runtime.dispose();
    await expect(prepareElectronRuntime({ root, build: true, buildApp: async (_root: string, out: string) => {
      stage = dirname(out);
      return 7;
    } })).rejects.toThrow('exit 7');
    expect(existsSync(stage)).toBe(false);
    rmSync(join(root, 'out'), { recursive: true });
    await expect(prepareElectronRuntime({ root })).rejects.toThrow('incomplete');
  }, 60_000);

  it('reports exit codes and spawn failures without leaking signal listeners', async () => {
    const int = process.listenerCount('SIGINT');
    const term = process.listenerCount('SIGTERM');
    expect(await runCommand(process.execPath, ['-e', 'process.exit(7)'])).toBe(7);
    await expect(runCommand('/missing-zcc-test-command', [])).rejects.toThrow();
    expect(process.listenerCount('SIGINT')).toBe(int);
    expect(process.listenerCount('SIGTERM')).toBe(term);
  });

  it('rejects syntactically invalid generated chunks before publishing a successful build', async () => {
    const root = fixture();
    const out = join(root, 'out');
    mkdirSync(join(out, 'main', 'chunks'));
    writeFileSync(join(out, 'main', 'chunks', 'bad.js'), 'const require = 1; const require = 2;');
    await expect(validateMainSyntax(out)).rejects.toThrow('Invalid generated Electron JavaScript');
    writeFileSync(join(out, 'main', 'chunks', 'bad.js'), 'const sqliteRequire = 1;');
    writeFileSync(join(out, 'main', 'debug.map'), '{}');
    await expect(validateMainSyntax(out)).resolves.toBeUndefined();
  });
});
