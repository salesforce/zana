#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPluginHost } from '../packages/plugin-build/src/build-plugin-host.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsRoot = join(repoRoot, 'plugins');
const zccVersion = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')).version;

async function isDirectory(path) {
  const stats = await stat(path).catch(() => null);
  return stats?.isDirectory() === true;
}

const names = await readdir(pluginsRoot);
for (const name of names) {
  const dir = join(pluginsRoot, name);
  if (!(await isDirectory(dir))) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (typeof pkg?.zcc?.host !== 'string') continue;
  process.stdout.write(`building plugin host ${name}\n`);
  await buildPluginHost(dir, zccVersion);
}
