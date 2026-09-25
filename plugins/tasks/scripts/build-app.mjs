#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../../packages/plugin-build/src/build-plugin.ts';
import { scopeTaskStyles } from './scope-styles.mjs';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '../..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
const { default: postcss } = await import('postcss');
const { default: tailwind } = await import('@tailwindcss/postcss');
const css = await postcss([tailwind({ base: pluginRoot })]).process(readFileSync(join(pluginRoot, 'tailwind.css'), 'utf8'), { from: join(pluginRoot, 'tailwind.css') });
// Scope utilities to this plugin, including Radix portals. Never restyle the host.
scopeTaskStyles(css.root);
writeFileSync(join(pluginRoot, 'generated.css'), css.root.toString());
await buildPlugin(pluginRoot, String(version));
