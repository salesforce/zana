import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error -- the build script is plain ESM without type declarations.
import { buildPageAssets } from '../../scripts/build-app.mjs';

const pluginRoot = join(import.meta.dirname, '../..');
const outDirs: string[] = [];
afterEach(() => { for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('bundles the page runtime and site kit as standalone scripts matching the shipped ones', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'dd-page-assets-'));
  outDirs.push(outDir);
  await buildPageAssets(pluginRoot, outDir);
  for (const [file, banner] of [['page-runtime.js', '// Generated from src/runtime'], ['kit/site.js', '// Design Docs site kit.']] as const) {
    const built = readFileSync(join(outDir, file), 'utf8');
    expect(built.startsWith(banner)).toBe(true);
    expect(built).toContain('(() => {');
    expect(built).not.toMatch(/^\s*import\s/m);
    expect(built).toBe(readFileSync(join(pluginRoot, file), 'utf8'));
  }
}, 60_000);
