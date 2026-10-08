import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ esbuild: '' }));
vi.mock('../../../../packages/plugin-build/src/build-plugin.ts', () => ({ buildPlugin: vi.fn() }));
vi.mock('../../../../packages/plugin-build/src/toolchain.ts', () => ({ getPluginBuildToolchain: async () => ({ esbuild: h.esbuild }) }));

const pluginRoot = join(import.meta.dirname, '../..');
const script = join(pluginRoot, 'scripts/build-app.mjs');
const fakeDir = mkdtempSync(join(tmpdir(), 'dd-fake-esbuild-'));
h.esbuild = join(fakeDir, 'esbuild.mjs');
writeFileSync(h.esbuild, 'export async function build(options) { (globalThis.__ddBuilds ??= []).push(options); }');
const argv = process.argv[1];

afterEach(() => {
  process.argv[1] = argv;
  (globalThis as { __ddBuilds?: unknown[] }).__ddBuilds = [];
  vi.resetModules();
});
afterAll(() => rmSync(fakeDir, { recursive: true, force: true }));

it('only builds when run as the plugin build script', async () => {
  const { buildPlugin } = await import('../../../../packages/plugin-build/src/build-plugin.ts');
  await import('../../scripts/build-app.mjs');
  expect(buildPlugin).not.toHaveBeenCalled();
});

it('builds the app with the repo version, then both page assets into the plugin', async () => {
  process.argv[1] = script;
  const { buildPlugin } = await import('../../../../packages/plugin-build/src/build-plugin.ts');
  await import('../../scripts/build-app.mjs');
  expect(buildPlugin).toHaveBeenCalledWith(pluginRoot, expect.stringMatching(/^\d+\.\d+\.\d+/));
  const builds = (globalThis as { __ddBuilds?: Array<{ outfile: string; absWorkingDir: string }> }).__ddBuilds ?? [];
  expect(builds.map((b) => [b.outfile, b.absWorkingDir])).toEqual([
    [join(pluginRoot, 'page-runtime.js'), pluginRoot],
    [join(pluginRoot, 'kit/site.js'), pluginRoot]
  ]);
});
