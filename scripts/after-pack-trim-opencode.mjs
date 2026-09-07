#!/usr/bin/env node
/**
 * electron-builder afterPack hook: drop the unused OpenCode arch from
 * extraResources so each artifact ships only `opencode/<this-arch>/`.
 *
 * `scripts/fetch-opencode-binaries.mjs` still stages both mac arches into
 * `vendor/opencode/` (dev + the Intel/Apple Silicon CI matrix). extraResources
 * copies that whole tree; this hook then deletes the other arch using
 * `context.arch`. Runtime `resolveOpencodeBinDir` still reads
 * `resourcesPath/opencode/<process.arch>/opencode` — the path contract is
 * unchanged.
 *
 * Universal mac builds keep both arches. Missing `opencode/` is a no-op
 * (linux/win, or a build that skipped fetch:opencode).
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** electron-builder `Arch` enum (app-builder-lib). */
const ARCH_BY_CODE = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
};

/**
 * @param {string | number} arch
 * @returns {string}
 */
export function archName(arch) {
  if (typeof arch === 'string') return arch;
  return ARCH_BY_CODE[arch] ?? String(arch);
}

/**
 * @param {string} appOutDir
 * @param {string} electronPlatformName
 * @returns {string | null}
 */
export function resolveOpencodeResourceDir(appOutDir, electronPlatformName) {
  if (electronPlatformName === 'darwin') {
    if (!existsSync(appOutDir)) return null;
    const appBundle = readdirSync(appOutDir).find((name) => name.endsWith('.app'));
    if (!appBundle) return null;
    return join(appOutDir, appBundle, 'Contents', 'Resources', 'opencode');
  }
  return join(appOutDir, 'resources', 'opencode');
}

/**
 * @param {string} appOutDir
 * @param {string} electronPlatformName
 * @param {string | number} arch
 * @returns {string[]} removed arch directory names
 */
export function trimOtherOpencodeArches(appOutDir, electronPlatformName, arch) {
  const keep = archName(arch);
  if (keep === 'universal') return [];

  const opencodeDir = resolveOpencodeResourceDir(appOutDir, electronPlatformName);
  if (!opencodeDir || !existsSync(opencodeDir)) return [];

  const removed = [];
  for (const name of readdirSync(opencodeDir)) {
    if (name === keep) continue;
    const candidate = join(opencodeDir, name);
    rmSync(candidate, { recursive: true, force: true });
    removed.push(name);
  }
  return removed.sort();
}

/** @param {import('app-builder-lib').AfterPackContext} context */
export default async function afterPack(context) {
  const removed = trimOtherOpencodeArches(
    context.appOutDir,
    context.electronPlatformName,
    context.arch
  );
  if (removed.length > 0) {
    console.log(
      `[after-pack-trim-opencode] kept ${archName(context.arch)}; removed ${removed.join(', ')}`
    );
  }
}
