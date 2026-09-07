#!/usr/bin/env node
/**
 * Wipe the electron-builder output directory so a local `package` / `dist:mac`
 * does not accumulate historic dmg/zip pairs (observed ~4 GB of leftover
 * 2.0.0–2.0.5 artifacts beside a single current `.app`).
 *
 * Safe: electron-builder recreates `dist/` on the next pack. Does not touch
 * GitHub release artifacts.
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} [dir] */
export function cleanDist(dir = join(repoRoot, 'dist')) {
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const removed = cleanDist();
  console.log(removed ? `[clean-dist] removed ${join(repoRoot, 'dist')}` : '[clean-dist] nothing to remove');
}
