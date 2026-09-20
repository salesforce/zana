/**
 * Website hook: build the official marketplace feed from marketplace/entries.
 *
 * Kept as `scripts/generate-marketplace.mjs` so website predev/prebuild paths
 * stay stable. Entry authorship lives under repo-root `marketplace/`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const BUILD_SCRIPT = join(REPO_ROOT, 'marketplace', 'scripts', 'build.mjs');
const COMMITTED_CATALOG = join(HERE, '..', 'content', 'marketplace', 'marketplace.json');

export function runOfficialMarketplaceBuild() {
  // The Docker context contains only website/, with its already-generated feed.
  // Match the docs and plugin-guide sync hooks by preserving that committed copy.
  if (!existsSync(BUILD_SCRIPT) && existsSync(COMMITTED_CATALOG)) {
    return 'generate-marketplace: repo marketplace not reachable; keeping committed content/marketplace/';
  }
  const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `marketplace build exited ${result.status}`);
  }
  return (result.stdout || '').trim();
}

function isMain() {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(invoked);
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    const out = runOfficialMarketplaceBuild();
    if (out) console.log(out);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
