#!/usr/bin/env node
/**
 * Bundle @zana-ai/zcc-plugin-sdk runtime entries the way BB does: esbuild
 * with `conditions: ["source"]` so `@zana-ai/zcc-domain` is inlined. Plain
 * Node loading `default: ./dist/*.js` then never walks into domain
 * `src/plugin-id.js`.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  { source: 'src/index.ts', output: 'dist/index.js', external: [] },
  { source: 'src/app.ts', output: 'dist/app.js', external: ['react', 'react/*'] },
  {
    source: 'src/server.ts',
    output: 'dist/server.js',
    external: []
  },
  {
    source: 'src/provider-bridge.ts',
    output: 'dist/provider-bridge.js',
    external: ['zod', 'zod/*']
  },
  {
    source: 'src/testing/index.ts',
    output: 'dist/testing/index.js',
    external: []
  },
  {
    source: 'src/testing/app.ts',
    output: 'dist/testing/app.js',
    external: ['react', 'react/*']
  }
];

await rm(path.join(packageRoot, 'dist'), { force: true, recursive: true });

for (const entry of entries) {
  await build({
    bundle: true,
    conditions: ['source'],
    entryPoints: [path.join(packageRoot, entry.source)],
    external: entry.external,
    format: 'esm',
    legalComments: 'none',
    outfile: path.join(packageRoot, entry.output),
    platform: 'node',
    target: 'node22'
  });
}

process.stdout.write(`Built ${entries.length} @zana-ai/zcc-plugin-sdk runtime entries.\n`);
