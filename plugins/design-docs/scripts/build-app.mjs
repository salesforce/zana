#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../../packages/plugin-build/src/build-plugin.ts';
import { getPluginBuildToolchain } from '../../../packages/plugin-build/src/toolchain.ts';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '../..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
await buildPlugin(pluginRoot, String(version));

// The page runtime runs inside rendered pages, not in the app: its own bundle, no imports.
const esbuild = await import((await getPluginBuildToolchain()).esbuild);
await esbuild.build({
  entryPoints: [join(pluginRoot, 'src/runtime/entry.ts')],
  outfile: join(pluginRoot, 'page-runtime.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: '// Generated from src/runtime by scripts/build-app.mjs; do not edit.' }
});

// The site kit's script ships with every page that links zcc-kit/site.js, published or previewed.
await esbuild.build({
  entryPoints: [join(pluginRoot, 'src/kit/entry.ts')],
  outfile: join(pluginRoot, 'kit/site.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16'],
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: '// Design Docs site kit. Generated from src/kit by scripts/build-app.mjs; do not edit.' }
});
