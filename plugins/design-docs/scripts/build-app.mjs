#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlugin } from '../../../packages/plugin-build/src/build-plugin.ts';
import { getPluginBuildToolchain } from '../../../packages/plugin-build/src/toolchain.ts';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '../..');

/**
 * Bundles the scripts rendered pages load, outside the app bundle: the page
 * runtime and the site kit. Each is a self-contained IIFE with no imports.
 */
export async function buildPageAssets(root = pluginRoot, outDir = root) {
  const esbuild = await import((await getPluginBuildToolchain()).esbuild);
  const shared = { bundle: true, format: 'iife', platform: 'browser', legalComments: 'none', logLevel: 'warning' };
  // The page runtime runs inside rendered pages, not in the app.
  await esbuild.build({
    ...shared,
    entryPoints: [join(root, 'src/runtime/entry.ts')],
    outfile: join(outDir, 'page-runtime.js'),
    target: 'chrome120',
    banner: { js: '// Generated from src/runtime by scripts/build-app.mjs; do not edit.' }
  });
  // The site kit's script ships with every page that links zcc-kit/site.js, published or previewed.
  await esbuild.build({
    ...shared,
    entryPoints: [join(root, 'src/kit/entry.ts')],
    outfile: join(outDir, 'kit/site.js'),
    target: ['chrome110', 'firefox115', 'safari16'],
    banner: { js: '// Design Docs site kit. Generated from src/kit by scripts/build-app.mjs; do not edit.' }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
  await buildPlugin(pluginRoot, String(version));
  await buildPageAssets();
}
