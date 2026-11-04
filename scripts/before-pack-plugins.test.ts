import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('./package-migration-runtimes.mjs', () => ({ packageMigrationRuntimes: vi.fn() }));
import beforePack from './before-pack-plugins.mjs';
import { packageMigrationRuntimes } from './package-migration-runtimes.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('replaces the entire runtime catalog, skips non-plugins and aborts packaging on build failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-before-pack-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.3.1' }));
  const plugins = join(root, 'plugins');
  const source = join(plugins, 'fixture');
  for (const dir of [source, join(plugins, 'empty'), join(plugins, 'ordinary'), join(root, 'out/packaged-plugins/stale')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(plugins, 'README.md'), 'not a plugin');
  writeFileSync(join(plugins, 'ordinary/package.json'), '{}');
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'zcc-plugin-fixture', version: '1.0.0', zcc: { name: 'Fixture', description: 'Packaging fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(source, 'server.mjs'), 'export default () => 42;');
  vi.mocked(packageMigrationRuntimes).mockImplementationOnce(async (_definitions, _destination, _version, _prepare, readManifest) => {
    expect(readManifest(source).id).toBe('fixture');
  });
  await beforePack({ packager: { projectDir: root } });
  const runtime = join(root, 'out/packaged-plugins');
  expect(readdirSync(runtime)).toEqual(['fixture']);
  expect(existsSync(join(runtime, 'fixture/server.mjs'))).toBe(true);
  const previous = readFileSync(join(runtime, 'fixture/server.mjs'), 'utf8');
  expect(existsSync(join(root, 'dist'))).toBe(false);
  writeFileSync(join(source, 'server.mjs'), 'import "missing-build-dependency";');
  await expect(beforePack({ packager: { projectDir: root } })).rejects.toThrow('Could not resolve');
  expect(readFileSync(join(runtime, 'fixture/server.mjs'), 'utf8')).toBe(previous);
  expect(readdirSync(join(root, 'out'))).toEqual(['packaged-plugins']);
});
