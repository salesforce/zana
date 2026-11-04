import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { packageMigrationRuntimes } from './package-migration-runtimes.mjs';
import { preparePluginRuntime } from '../packages/plugin-build/src/prepare-plugin-runtime';
import { loadManifestFromDir } from '../apps/server/src/plugins/plugin-service';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'migration-pack-')); roots.push(root);
  const repo = join(root, 'repository'); mkdirSync(repo);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'zcc-plugin-example', version: '1.0.0', zcc: { name: 'Example', description: 'Fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(repo, 'server.mjs'), 'export default () => {};');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  for (const args of [['init', '-b', 'runtime'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'runtime']]) execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  return { root, destination: join(root, 'packaged'), definition: { name: 'example', pluginId: 'example', url: repo, ref: 'runtime' } };
}
it('packages compiled independent runtimes outside the fresh-install catalogue', async () => {
  const f = fixture();
  await packageMigrationRuntimes([f.definition], f.destination, '2.5.0', preparePluginRuntime, loadManifestFromDir);
  const runtime = join(f.destination, 'migration-runtimes/example');
  expect(existsSync(join(runtime, 'server.mjs'))).toBe(true);
  expect(existsSync(join(runtime, '.git'))).toBe(false);
  expect(JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')).zcc.server).toBe('./server.mjs');
  expect(readdirSync(f.destination)).toEqual(['migration-runtimes']);
});
it('rejects a mismatched identity before building and fails packaging when the source is unavailable', async () => {
  const f = fixture(); const prepare = vi.fn();
  await expect(packageMigrationRuntimes([{ ...f.definition, pluginId: 'different' }], f.destination, '2.5.0', prepare, loadManifestFromDir)).rejects.toThrow('identity mismatch');
  expect(prepare).not.toHaveBeenCalled();
  await expect(packageMigrationRuntimes([{ ...f.definition, url: join(f.root, 'missing') }], f.destination, '2.5.0', prepare, loadManifestFromDir)).rejects.toThrow();
  expect(existsSync(f.destination)).toBe(false);
});
it('propagates a build failure and does nothing when there are no externalized plugins', async () => {
  const f = fixture(); const prepare = vi.fn().mockRejectedValue(new Error('build failed'));
  await expect(packageMigrationRuntimes([f.definition], f.destination, '2.5.0', prepare, loadManifestFromDir)).rejects.toThrow('build failed');
  await packageMigrationRuntimes([], f.destination, '2.5.0', prepare, loadManifestFromDir);
  expect(prepare).toHaveBeenCalledOnce();
});
