#!/usr/bin/env node
/**
 * create-zcc-extension — scaffold a new ZCC extension from the template.
 *
 * Usage:
 *   node tools/create-zcc-extension <target-dir> [--id my-ext] [--title "My Ext"]
 *
 * Copies tools/create-zcc-extension/template/ into <target-dir>, then rewrites
 * the manifest id/title and the `{{TITLE}}` placeholder in README/source. Keeps
 * zero runtime dependencies — it's plain Node fs.
 */
import { cp, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(__dirname, 'template');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') out.id = argv[++i];
    else if (a === '--title') out.title = argv[++i];
    else out._.push(a);
  }
  return out;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function replaceInFile(file, replacements) {
  let text = await readFile(file, 'utf8');
  for (const [from, to] of replacements) text = text.split(from).join(to);
  await writeFile(file, text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args._[0];
  if (!target) {
    console.error(
      'usage: create-zcc-extension <target-dir> [--id my-ext] [--title "My Ext"]'
    );
    process.exit(1);
  }

  const dest = resolve(process.cwd(), target);
  if (await exists(dest)) {
    console.error(`refusing to overwrite existing path: ${dest}`);
    process.exit(1);
  }

  const id = args.id ?? basename(dest);
  const title =
    args.title ??
    id
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  await mkdir(dirname(dest), { recursive: true });
  await cp(TEMPLATE, dest, { recursive: true });

  // Manifest: set id + title; keep the entry/engines/permissions from template.
  const manifestPath = join(dest, 'extension.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.id = id;
  manifest.title = title;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // package.json name → id.
  await replaceInFile(join(dest, 'package.json'), [['"my-extension"', `"${id}"`]]);

  // Main module id → id (template ships id: 'my-extension').
  await replaceInFile(join(dest, 'src', 'main', 'index.ts'), [
    [`id: 'my-extension'`, `id: '${id}'`],
  ]);

  // README placeholder.
  await replaceInFile(join(dest, 'README.md'), [['{{TITLE}}', title]]);

  console.log(`Scaffolded ${id} at ${dest}`);
  console.log('Next:');
  console.log(`  cd ${target}`);
  console.log('  npm install');
  console.log('  npm run build');
  console.log(`  cp extension.json dist/renderer.js dist/main.js ~/.zcc/extensions/${id}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
