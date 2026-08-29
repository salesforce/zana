#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginApp } from '../../../packages/plugin-build/src/build-plugin.ts';
import { build } from 'vite';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '../..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
await build({ configFile: join(pluginRoot, 'playground/vite.config.ts') });
await buildPluginApp(pluginRoot, String(version));
