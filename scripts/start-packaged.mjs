#!/usr/bin/env node
/**
 * Open the electron-builder output as a real packaged app (`pnpm start`).
 * This is not Turbo/`electron-vite` — PluginService lives in the app's own
 * utility process, the same as a released .dmg.
 *
 * Requires a prior `pnpm dist` (or `pnpm dist:mac`). Does not rebuild.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ root?: string, platform?: NodeJS.Platform, arch?: string }} [opts]
 * @returns {string[]}
 */
export function packagedAppCandidates(opts = {}) {
  const root = opts.root ?? repoRoot;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  if (platform === 'darwin') {
    const primary = arch === 'arm64' ? 'mac-arm64' : 'mac';
    const secondary = primary === 'mac-arm64' ? 'mac' : 'mac-arm64';
    return [join(root, 'dist', primary, 'Zana.app'), join(root, 'dist', secondary, 'Zana.app')];
  }
  if (platform === 'win32') {
    return [join(root, 'dist', 'win-unpacked', 'Zana.exe')];
  }
  return [join(root, 'dist', 'linux-unpacked', 'zana'), join(root, 'dist', 'linux-unpacked', 'Zana')];
}

/**
 * @param {{ root?: string, platform?: NodeJS.Platform, arch?: string }} [opts]
 * @returns {string | null}
 */
export function resolvePackagedApp(opts = {}) {
  return packagedAppCandidates(opts).find((path) => existsSync(path)) ?? null;
}

/**
 * @param {string} appPath
 * @param {NodeJS.Platform} [platform]
 */
export function startPackagedCommand(appPath, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [appPath] };
  return { command: appPath, args: [] };
}

export function missingPackagedAppMessage(candidates) {
  const listed = candidates.join('\n  ');
  return [
    'No packaged Zana app found. Looked for:',
    `  ${listed}`,
    'Build one with: pnpm dist',
    'Unpackaged production Electron (no .app) is: pnpm preview'
  ].join('\n');
}

function runMain(spawnImpl = spawn, proc = process) {
  const candidates = packagedAppCandidates();
  const appPath = resolvePackagedApp();
  if (!appPath) {
    proc.stderr.write(`${missingPackagedAppMessage(candidates)}\n`);
    proc.exit(1);
    return;
  }
  const { command, args } = startPackagedCommand(appPath);
  proc.stderr.write(`[zcc start] ${appPath}\n`);
  const child = spawnImpl(command, args, { stdio: 'inherit', detached: true });
  child.unref?.();
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) runMain();
