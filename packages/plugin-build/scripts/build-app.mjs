#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginApp } from '../src/build-plugin.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const pluginRoot = resolve(process.cwd(), process.argv[2] ?? '.');
const version = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
const result = await buildPluginApp(pluginRoot, String(version));
if (!result) {
  throw new Error(`no app.tsx to build in ${pluginRoot}`);
}
