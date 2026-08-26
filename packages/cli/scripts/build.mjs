#!/usr/bin/env node
/**
 * Bundle the zcc CLI the way BB bundles apps/cli: one ESM file with
 * `conditions: ["source"]` so workspace TypeScript (domain, plugin-sdk,
 * plugin-templates, plugin-build) is inlined. Plain Node then never walks
 * into `src/*.ts` and fails on `./plugin-id.js`.
 *
 * `esbuild` stays external — plugin-build dynamically imports it for
 * `zcc plugin build` / `dev`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(packageRoot, 'dist', 'bin', 'zcc.js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  bundle: true,
  conditions: ['source'],
  entryPoints: [join(packageRoot, 'src', 'bin', 'zcc.ts')],
  external: ['esbuild', 'esbuild/*'],
  format: 'esm',
  legalComments: 'none',
  outfile,
  platform: 'node',
  sourcemap: true,
  target: 'node22'
});

console.log(`[build] wrote ${outfile}`);
