/**
 * Copy the curated, PUBLIC docs from the parent repo into ./content/docs/ so the
 * website is self-contained — the Docker build context is only website/, and
 * Next can't reach ../docs at build time. This is the single source of truth for
 * which repo docs are published; lib/docs.ts reads the generated manifest + md.
 *
 * Run automatically via the `predev` / `prebuild` npm hooks. Re-run by hand with
 * `node scripts/sync-docs.mjs`. If a source file is missing it's skipped with a
 * warning (so a partial checkout still builds).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = join(HERE, '..');
const REPO_ROOT = join(WEBSITE, '..');
const OUT_DIR = join(WEBSITE, 'content', 'docs');

/** slug → { title, source (relative to repo root), group }. Edit to publish a doc. */
// NOTE: "getting-started" and "using-zana" are PUBLIC, site-authored onboarding
// docs (docs/getting-started.md, docs/using-zana.md) — NOT copies of the repo
// README. They describe the product from the end user's side and point at the
// site's own /download page, so they don't drift from the source README.
const DOCS = [
  { slug: 'getting-started', title: 'Getting started', source: 'docs/getting-started.md', group: 'Start' },
  { slug: 'using-zana', title: 'Using Zana Command Center', source: 'docs/using-zana.md', group: 'Start' },
  { slug: 'cli', title: 'The zcc CLI', source: 'docs/cli.md', group: 'Start' },
  { slug: 'extensions-quickstart', title: 'Build your first extension', source: 'docs/extensions-quickstart.md', group: 'Extensions' },
  { slug: 'extensions', title: 'Extensions overview', source: 'docs/extensions.md', group: 'Extensions' },
  { slug: 'extensions-authoring', title: 'Authoring extensions', source: 'docs/extensions-authoring.md', group: 'Extensions' },
  { slug: 'extensions-sdk-reference', title: 'Extension SDK reference', source: 'docs/extensions-sdk-reference.md', group: 'Extensions' }
];

// If the parent repo's docs aren't reachable (e.g. inside the Docker build
// context, which is only website/), DON'T clobber an already-synced content/
// dir — the committed copy is the source of truth there. Only resync when the
// real repo docs are present (host dev / CI checkout of the full repo).
const repoDocsPresent = existsSync(join(REPO_ROOT, 'docs')) || existsSync(join(REPO_ROOT, 'README.md'));
if (!repoDocsPresent && existsSync(join(OUT_DIR, '_manifest.json'))) {
  console.log('sync-docs: repo docs not reachable; keeping committed content/docs/ as-is');
  process.exit(0);
}

await mkdir(OUT_DIR, { recursive: true });

const manifest = [];
for (const d of DOCS) {
  const src = join(REPO_ROOT, d.source);
  if (!existsSync(src)) {
    console.warn(`sync-docs: SKIP ${d.slug} — missing ${d.source}`);
    continue;
  }
  const md = await readFile(src, 'utf-8');
  await writeFile(join(OUT_DIR, `${d.slug}.md`), md);
  manifest.push({ slug: d.slug, title: d.title, group: d.group });
}

await writeFile(join(OUT_DIR, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`sync-docs: wrote ${manifest.length} docs → content/docs/`);
