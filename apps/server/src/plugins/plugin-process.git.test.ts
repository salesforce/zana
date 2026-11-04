import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultCloneGit, defaultSpawnNpm, ensureDir } from './plugin-process.js';

const roots: string[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-git-')); roots.push(dir); return dir; }
function repository() {
  const dir = root();
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, timeout: 5000, stdio: 'pipe' }).toString().trim();
  git(['init', '-b', 'main']); writeFileSync(join(dir, 'fixture'), 'first'); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'first']);
  const first = git(['rev-parse', 'HEAD']); git(['tag', 'v1.0.0']);
  writeFileSync(join(dir, 'fixture'), 'second'); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'second']);
  return { url: pathToFileURL(dir).href, first, head: git(['rev-parse', 'HEAD']) };
}
afterEach(() => roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('plugin source materialization commands', () => {
  it('records branch and tag identity and fetches an exact non-HEAD commit', async () => {
    const repo = repository();
    expect(await defaultCloneGit(repo.url, join(root(), 'head'), 'HEAD')).toEqual({ commit: repo.head, refKind: 'branch' });
    expect(await defaultCloneGit(repo.url, join(root(), 'branch'), 'ref:main')).toEqual({ commit: repo.head, refKind: 'branch' });
    expect(await defaultCloneGit(repo.url, join(root(), 'tag'), 'v1.0.0')).toEqual({ commit: repo.first, refKind: 'tag' });
    expect(await defaultCloneGit(repo.url, join(root(), 'sha'), `commit:${repo.first}`)).toEqual({ commit: repo.first, refKind: 'commit' });
    expect(await defaultCloneGit(repo.url, join(root(), 'bare-sha'), repo.first)).toEqual({ commit: repo.first, refKind: 'commit' });
  });
  it('rejects unresolved ranges, invalid commits, missing refs and fetch failures', async () => {
    const repo = repository();
    await expect(defaultCloneGit(repo.url, join(root(), 'range'), 'semver:^1')).rejects.toThrow(/resolved/);
    await expect(defaultCloneGit(repo.url, join(root(), 'invalid'), 'commit:bad-option')).rejects.toThrow(/Invalid/);
    await expect(defaultCloneGit(repo.url, join(root(), 'missing'), 'missing')).rejects.toThrow(/clone failed/);
    await expect(defaultCloneGit(repo.url, join(root(), 'missing-sha'), `commit:${'f'.repeat(40)}`)).rejects.toThrow(/materialize/);
  });
  it('resolves the bundled npm JavaScript entry without shell npm and creates its cwd', async () => {
    const cwd = join(root(), 'npm');
    const result = await defaultSpawnNpm(['--version'], cwd);
    expect(result.code, result.stderr).toBe(0); expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/); expect(existsSync(cwd)).toBe(true);
    const dir = join(root(), 'existing'); ensureDir(dir); ensureDir(dir); expect(existsSync(dir)).toBe(true);
  });
  it('requires fresh npm metadata and reports an offline registry instead of cached success', async () => {
    const registry = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: 'zcc-plugin-fixture', 'dist-tags': { latest: '1.1.0' }, versions: {
        '1.1.0': { name: 'zcc-plugin-fixture', version: '1.1.0', dist: { integrity: 'sha512-fixture' } }
      } }));
    });
    await new Promise<void>(resolve => registry.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(registry.address() as { port: number }).port}`;
    const cwd = root();
    try {
      const args = ['view', 'zcc-plugin-fixture@*', 'version', 'dist.integrity', '--json', '--registry', url];
      const result = await defaultSpawnNpm(args, cwd);
      expect(result.code, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ version: '1.1.0' });
      registry.closeAllConnections(); await new Promise<void>(resolve => registry.close(() => resolve()));
      expect((await defaultSpawnNpm(args, cwd)).code).not.toBe(0);
    } finally { registry.closeAllConnections(); registry.close(); }
  });
});
