import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import beforePack from './before-pack-plugins.mjs';

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
  await beforePack({ packager: { projectDir: root } });
  const runtime = join(root, 'out/packaged-plugins');
  expect(readdirSync(runtime)).toEqual(['fixture']);
  expect(existsSync(join(runtime, 'fixture/server.mjs'))).toBe(true);
  const previous = readFileSync(join(runtime, 'fixture/server.mjs'), 'utf8');
  const nativeIndex = JSON.parse(readFileSync(join(root, 'dist', `plugin-recovery-${process.platform}-${process.arch}.json`), 'utf8'));
  expect(nativeIndex).toMatchObject({ zccVersion: '2.3.1', plugins: [{ id: 'fixture' }] });
  expect(existsSync(join(root, 'dist', nativeIndex.plugins[0].file))).toBe(true);
  await beforePack({ packager: { projectDir: root }, electronPlatformName: 'win32', arch: 1 });
  const windowsIndex = JSON.parse(readFileSync(join(root, 'dist/plugin-recovery-win32-x64.json'), 'utf8'));
  expect(windowsIndex.plugins[0].file).toBe('plugin-recovery-2.3.1-win32-x64-fixture.json.gz');
  writeFileSync(join(source, 'server.mjs'), 'import "missing-build-dependency";');
  await expect(beforePack({ packager: { projectDir: root } })).rejects.toThrow('Could not resolve');
  expect(readFileSync(join(runtime, 'fixture/server.mjs'), 'utf8')).toBe(previous);
  expect(readdirSync(join(root, 'out'))).toEqual(['packaged-plugins']);
});
