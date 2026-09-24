#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../../../packages/plugin-build/src/build-plugin.ts';

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(pluginRoot, '../..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0';
const { default: postcss } = await import('postcss');
const { default: tailwind } = await import('@tailwindcss/postcss');
const css = await postcss([tailwind({ base: pluginRoot })]).process(readFileSync(join(pluginRoot, 'tailwind.css'), 'utf8'), { from: join(pluginRoot, 'tailwind.css') });
// Scope utilities to this plugin, including Radix portals. Never restyle the host.
css.root.walkRules(rule => {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name))) return;
  }
  if (rule.selector === ':root, :host') { rule.selector = '.bb-tasks, [data-bb-plugin="tasks"]'; return; }
  if (rule.selector.startsWith('.bb-tasks') || rule.selector.startsWith('[data-bb-plugin') || rule.selector.startsWith(':where(.bb-tasks')) return;
  rule.selectors = rule.selectors.map(selector => `:where(.bb-tasks, [data-bb-plugin="tasks"]) ${selector}`);
});
writeFileSync(join(pluginRoot, 'generated.css'), css.root.toString());
await buildPlugin(pluginRoot, String(version));
