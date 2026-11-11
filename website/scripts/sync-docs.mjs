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
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBSITE = join(HERE, '..');
const REPO_ROOT = join(WEBSITE, '..');

/** source is relative to repo root; site-authored docs omit it. */
// NOTE: "getting-started" and "using-zana" are PUBLIC, site-authored onboarding
// docs (docs/getting-started.md, docs/using-zana.md) — NOT copies of the repo
// README. They describe the product from the end user's side and point at the
// site's own /download page, so they don't drift from the source README.
const DOCS = [
  { slug: 'getting-started', title: 'Getting started', source: 'docs/getting-started.md', group: 'Start' },
  { slug: 'using-zana', title: 'Using Zana Command Center', source: 'docs/using-zana.md', group: 'Start' },
  { slug: 'multiple-devices', title: 'Using Zana on multiple machines', source: 'docs/multiple-devices.md', group: 'Start' },
  { slug: 'cli', title: 'The zcc CLI', source: 'docs/cli.md', group: 'Start' },
  { slug: 'control-sdk', title: 'Control SDK', source: 'docs/control-sdk.md', group: 'Start' },
  { slug: 'squads-start', title: 'Start using Squads', group: 'Squads' },
  { slug: 'squads-catalogue', title: 'Choose a Squad', group: 'Squads' },
  { slug: 'squads-launch', title: 'Ways to start a Squad', group: 'Squads' },
  { slug: 'squads-watch', title: 'Watching a Squad', group: 'Squads' },
  { slug: 'squads-customize', title: 'Personas and custom Squads', group: 'Squads' },
  { slug: 'extensions-quickstart', title: 'Build your first plugin', source: 'docs/extensions-quickstart.md', group: 'Plugins' },
  { slug: 'extensions', title: 'Plugins overview', source: 'docs/extensions.md', group: 'Plugins' },
  { slug: 'extensions-authoring', title: 'Authoring plugins', source: 'docs/extensions-authoring.md', group: 'Plugins' },
  { slug: 'extensions-sdk-reference', title: 'Plugin SDK reference', source: 'docs/extensions-sdk-reference.md', group: 'Plugins' },
  { slug: 'harness-authoring', title: 'Author a harness', source: 'docs/harness-authoring.md', group: 'Harnesses' }
];

// If the parent repo's docs aren't reachable (e.g. inside the Docker build
// context, which is only website/), DON'T clobber an already-synced content/
// dir — the committed copy is the source of truth there. Only resync when the
// real repo docs are present (host dev / CI checkout of the full repo).
export async function syncDocs(repoRoot = REPO_ROOT, website = WEBSITE) {
  const outDir = join(website, 'content', 'docs');
  const repoDocsPresent = existsSync(join(repoRoot, 'docs')) || existsSync(join(repoRoot, 'README.md'));
  if (!repoDocsPresent && existsSync(join(outDir, '_manifest.json'))) {
    console.log('sync-docs: repo docs not reachable; keeping committed content/docs/ as-is');
    return;
  }

  await mkdir(outDir, { recursive: true });
  const manifest = [];
  for (const d of DOCS) {
    const destination = join(outDir, `${d.slug}.md`);
    const src = d.source ? join(repoRoot, d.source) : destination;
    if (!existsSync(src)) {
      console.warn(`sync-docs: SKIP ${d.slug} — missing ${d.source ?? destination}`);
      continue;
    }
    if (d.source) await writeFile(destination, await readFile(src, 'utf-8'));
    manifest.push({ slug: d.slug, title: d.title, group: d.group });
  }

  await writeFile(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sync-docs: wrote ${manifest.length} docs → content/docs/`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await syncDocs();
}
