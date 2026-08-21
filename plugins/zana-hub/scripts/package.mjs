#!/usr/bin/env node
/**
 * Package the built zana-hub extension into its committed, runnable artifact
 * dir and (best-effort) seed it into the dev install dir so a fresh
 * `npm run dev` shows the global Zana dashboard through the disk pipeline.
 * Mirrors extensions/consensus/scripts/package.mjs.
 *
 * Sources:  extensions/zana-hub/extension.json + dist/{main.mjs,renderer.js}
 * Targets:
 *   1. bundled-extensions/zana-hub/  — COMMITTED runnable artifact (the
 *      canonical shipped form, seeded on boot by seedBundledExtensions).
 *   2. ~/.zcc/extensions/zana-hub/    — the dev/runtime install dir the
 *      discovery scanner reads (unless ZCC_EXTENSIONS_DIR overrides it).
 *      Skipped if the home dir isn't writable (e.g. CI).
 *
 * Run after `npm run build` (the package.json `package` script does both).
 */
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '..');
const repoRoot = join(extRoot, '..', '..');
const dist = join(extRoot, 'dist');
const manifest = join(extRoot, 'extension.json');

// main.mjs (unambiguous ESM — see vite.config.ts), renderer.js (blob-imported).
const FILES = ['main.mjs', 'renderer.js'];

/** Short git SHA of the repo HEAD, or null if unavailable (shallow CI, etc.). */
function gitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf-8'
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Copy the artifact into a target dir, stamping build provenance into the
 * COPIED manifest (the source extension.json stays clean — version only).
 */
async function copyInto(targetDir, build) {
  await mkdir(targetDir, { recursive: true });
  const raw = JSON.parse(await readFile(manifest, 'utf-8'));
  raw.build = build;
  await writeFile(join(targetDir, 'extension.json'), JSON.stringify(raw, null, 2) + '\n');
  for (const f of FILES) {
    await cp(join(dist, f), join(targetDir, f));
  }
}

async function main() {
  // Verify the build ran.
  for (const f of FILES) {
    try {
      await access(join(dist, f));
    } catch {
      console.error(`missing dist/${f} — run \`npm run build\` first`);
      process.exit(1);
    }
  }

  const build = { sha: gitSha(), at: new Date().toISOString() };

  // 1. Committed artifact.
  const bundledDir = join(repoRoot, 'bundled-extensions', 'zana-hub');
  await copyInto(bundledDir, build);
  console.log(`packaged → ${bundledDir}`);

  // 2. Dev install dir (best-effort).
  const installRoot = process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
  try {
    await copyInto(join(installRoot, 'zana-hub'), build);
    console.log(`seeded   → ${join(installRoot, 'zana-hub')}`);
  } catch (err) {
    console.warn(`skipped dev seed (${err instanceof Error ? err.message : String(err)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
