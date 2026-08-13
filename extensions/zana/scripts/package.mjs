#!/usr/bin/env node
/**
 * Package the built zana extension into its committed, runnable artifact dir and
 * (best-effort) seed it into the dev install dir so a fresh `npm run dev` shows
 * the Zana tickets tab through the disk pipeline.
 *
 * Sources:  extensions/zana/extension.json + extensions/zana/dist/{main.mjs,renderer.js}
 * Targets:
 *   1. bundled-extensions/zana/ — COMMITTED runnable artifact.
 *   2. ~/.zcc/extensions/zana/   — the dev/runtime install dir the discovery
 *      scanner reads (unless ZCC_EXTENSIONS_DIR overrides it).
 *
 * DUAL build: unlike the former renderer-only zana-tickets, this extension is a
 * MERGE of main + renderer — the ticket/sprint/artifact/profile DATA now flows
 * through the host MCP pool (brokered `ctx.mcp('zana', …)`), so the capability
 * provider lives in this extension's OWN main.mjs rather than a core built-in.
 * Both files ship.
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

// Dual build (main + renderer). main.mjs is the capability provider; renderer.js
// is the blob-imported per-project Tickets board.
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

  // Build provenance stamped into each copied manifest.
  const build = { sha: gitSha(), at: new Date().toISOString() };

  // 1. Committed artifact.
  const bundledDir = join(repoRoot, 'bundled-extensions', 'zana');
  await copyInto(bundledDir, build);
  console.log(`packaged → ${bundledDir}`);

  // 2. Dev install dir (best-effort).
  const installRoot = process.env.ZCC_EXTENSIONS_DIR ?? join(homedir(), '.zcc', 'extensions');
  try {
    await copyInto(join(installRoot, 'zana'), build);
    console.log(`seeded   → ${join(installRoot, 'zana')}`);
  } catch (err) {
    console.warn(`skipped dev seed (${err instanceof Error ? err.message : String(err)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
