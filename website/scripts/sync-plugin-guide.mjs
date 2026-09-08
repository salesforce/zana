/**
 * Copy the in-app Plugin Guide map (ProductMap + CSS) into website/ so
 * /extensions can render the same UI. The Docker build context is only
 * website/, so the copied files are committed and reused when plugins/ is
 * unreachable — same skip-if-missing pattern as sync-docs.mjs.
 *
 * Run from website/ via predev/prebuild, or `node scripts/sync-plugin-guide.mjs`.
 * Edit plugins/plugin-guide sources, then re-run this script. Do not hand-edit
 * website/lib/plugin-guide/.
 */
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = join(HERE, '..');
const REPO_ROOT = join(WEBSITE, '..');
const SRC_ROOT = join(REPO_ROOT, 'plugins/plugin-guide');
const OUT_DIR = join(WEBSITE, 'lib/plugin-guide');
const LEGACY_CATALOG = join(WEBSITE, 'lib/plugin-guide-catalog.json');

/** plugin-relative path → filename under website/lib/plugin-guide/ */
const FILES = [
  ['src/annotation.ts', 'annotation.ts'],
  ['src/chip-position.ts', 'chip-position.ts'],
  ['src/product-map.tsx', 'product-map.tsx'],
  ['src/surface-card.tsx', 'surface-card.tsx'],
  ['src/surfaces.ts', 'surfaces.ts'],
  ['src/wireframes.tsx', 'wireframes.tsx'],
  ['plugin-guide.css', 'plugin-guide.css']
];

const sourcePresent = existsSync(join(SRC_ROOT, 'src/surfaces.ts'));
const committedCopy = existsSync(join(OUT_DIR, 'surfaces.ts'));

if (!sourcePresent) {
  if (committedCopy) {
    console.log('sync-plugin-guide: plugin-guide source not reachable; keeping committed lib/plugin-guide/');
    process.exit(0);
  }
  console.warn('sync-plugin-guide: missing plugins/plugin-guide/src/surfaces.ts');
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });
for (const [from, to] of FILES) {
  const src = join(SRC_ROOT, from);
  if (!existsSync(src)) {
    console.warn(`sync-plugin-guide: SKIP ${to} — missing ${from}`);
    continue;
  }
  const dest = join(OUT_DIR, to);
  if (to.endsWith('.css')) {
    await copyFile(src, dest);
    continue;
  }
  // Next/Turbopack does not map `./foo.js` → `foo.ts`. Plugin sources keep the
  // Node ESM specifier; the website copy drops the suffix.
  const text = await readFile(src, 'utf8');
  await writeFile(dest, text.replace(/(from\s+['"])(\.[^'"]+)\.js(['"])/g, '$1$2$3'));
}

if (existsSync(LEGACY_CATALOG)) {
  await unlink(LEGACY_CATALOG);
}

console.log('sync-plugin-guide: wrote lib/plugin-guide/');
