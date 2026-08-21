#!/usr/bin/env node
/**
 * Dev watcher for the zana disk extension — closes the edit→see loop.
 *
 * The app loads the extension from `~/.zcc/extensions/zana/` (a COPY seeded by
 * package.mjs), NOT from the repo. So editing `extensions/zana/src` does nothing
 * in a running app until the bundle is rebuilt AND reseeded. This watcher removes
 * that gap: one build+package up front, then watch the source tree and re-run
 * build+package (debounced) on every change. The renderer bundle is blob-imported
 * per panel mount, so reopening the Zana tab picks up new renderer code; a main
 * change requires the host to re-spawn the extension utilityProcess (hot-reload).
 *
 * Run alongside `npm run dev` at the repo root (in a second terminal):
 *   cd extensions/zana && npm run dev
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '..');

// Source tree that feeds both bundles: the extension's own src (main + renderer
// + shims). A change anywhere under it rebuilds.
const WATCH_DIRS = [join(extRoot, 'src')].filter(existsSync);

const DEBOUNCE_MS = 200;
let timer = null;
let running = false;
let queued = false;

/** Run `npm run build && npm run package` in the extension dir. */
function rebuild() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const t0 = Date.now();
  const child = spawn('npm', ['run', 'build', '--silent'], { cwd: extRoot, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (code !== 0) {
      running = false;
      console.error(`[zana:dev] build failed (exit ${code}) — fix and save again`);
      return;
    }
    const pkg = spawn('npm', ['run', 'package', '--silent'], { cwd: extRoot, stdio: 'inherit' });
    pkg.on('exit', (pcode) => {
      running = false;
      if (pcode === 0) console.log(`[zana:dev] rebuilt + reseeded in ${Date.now() - t0}ms`);
      else console.error(`[zana:dev] package failed (exit ${pcode})`);
      if (queued) {
        queued = false;
        rebuild();
      }
    });
  });
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(rebuild, DEBOUNCE_MS);
}

console.log('[zana:dev] initial build…');
rebuild();
for (const dir of WATCH_DIRS) {
  watch(dir, { recursive: true }, schedule);
  console.log(`[zana:dev] watching ${dir}`);
}
console.log('[zana:dev] ready — reopen the Zana tab after a rebuild to see changes');
