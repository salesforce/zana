#!/usr/bin/env node
/**
 * Copy the Docs plugin's installable bits (manifest, server, skills) into the
 * committed bundled-extensions/docs artifact so packaged builds seed it the
 * same way as zana.
 */
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '..');
const repoRoot = join(extRoot, '..', '..');

async function copyTree(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
}

async function main() {
  await access(join(extRoot, 'package.json'));
  await access(join(extRoot, 'server.mjs'));
  await access(join(extRoot, 'skills', 'library-curator', 'SKILL.md'));

  const target = join(repoRoot, 'bundled-extensions', 'docs');
  await mkdir(target, { recursive: true });
  await copyTree(join(extRoot, 'package.json'), join(target, 'package.json'));
  await copyTree(join(extRoot, 'server.mjs'), join(target, 'server.mjs'));
  await copyTree(join(extRoot, 'skills'), join(target, 'skills'));
  const pkg = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  pkg.build = { at: new Date().toISOString() };
  await writeFile(join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  console.log(`packaged → ${target}`);

  const installRoot = process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
  try {
    const dest = join(installRoot, 'docs');
    await mkdir(dest, { recursive: true });
    await copyTree(join(target, 'package.json'), join(dest, 'package.json'));
    await copyTree(join(target, 'server.mjs'), join(dest, 'server.mjs'));
    await copyTree(join(target, 'skills'), join(dest, 'skills'));
    console.log(`seeded   → ${dest}`);
  } catch (err) {
    console.warn(`skipped dev seed (${err instanceof Error ? err.message : String(err)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
