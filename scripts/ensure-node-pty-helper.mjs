#!/usr/bin/env node
/**
 * node-pty ships platform prebuilds and also a `build/Release` addon that
 * `electron-rebuild -f` overwrites. Node and Electron can both load the package
 * (Release miss falls through to prebuilds), so force-rebuilding on every
 * `rebuild:electron` is wasted compile time. Probe first; compile only when
 * Electron cannot `require('node-pty')`.
 *
 * Default invocation (prepare / predev) only restores the spawn-helper mode bit.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function nodePtyPackageRoot() {
  return dirname(require.resolve('node-pty/package.json'));
}

export function nodePtySpawnHelperPaths(root = nodePtyPackageRoot()) {
  return [
    join(root, 'build', 'Release', 'spawn-helper'),
    join(root, 'build', 'Debug', 'spawn-helper'),
    join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
  ];
}

export function nodePtySpawnHelperPath(root = nodePtyPackageRoot()) {
  const paths = nodePtySpawnHelperPaths(root);
  return paths.find(existsSync) ?? paths[paths.length - 1];
}

export function ensureNodePtySpawnHelperExecutable(root = nodePtyPackageRoot()) {
  if (process.platform === 'win32') return false;
  let found = false;
  for (const helper of nodePtySpawnHelperPaths(root)) {
    if (!existsSync(helper)) continue;
    chmodSync(helper, 0o755);
    found = true;
  }
  return found;
}

export function probeNodePtyInElectronChild(root = nodePtyPackageRoot()) {
  const script = `
    const { createRequire } = require('node:module');
    const requireFrom = createRequire(${JSON.stringify(import.meta.url)});
    requireFrom(${JSON.stringify(root)});
  `;
  const result = spawnSync(require('electron'), ['-e', script], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  if (result.status === 0) return { ok: true };
  const message = `${result.stderr || ''}${result.stdout || ''}`.trim()
    || 'node-pty failed to load in Electron child process';
  const error = new Error(message);
  if (/ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|did not self-register/.test(message)) {
    error.code = 'ERR_DLOPEN_FAILED';
  }
  return { ok: false, error };
}

export function rebuildNodePtyForElectron(moduleDir = process.cwd()) {
  const rebuildCli = require.resolve('@electron/rebuild/lib/cli.js');
  process.stderr.write('[ensure-node-pty] rebuilding for Electron (probe failed)\n');
  const result = spawnSync(process.execPath, [rebuildCli, '-f', '-w', 'node-pty', '--module-dir', moduleDir, '--version', require('electron/package.json').version], {
    stdio: 'inherit', timeout: 10 * 60_000,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`node-pty Electron rebuild failed with exit ${result.status ?? 'null'}`);
  }
}

export function ensureNodePtyForElectron(root = nodePtyPackageRoot(), moduleDir = process.cwd()) {
  ensureNodePtySpawnHelperExecutable(root);
  const loaded = probeNodePtyInElectronChild(root);
  if (loaded.ok) {
    process.stderr.write('[ensure-node-pty] Electron can already load node-pty; skip rebuild\n');
    return;
  }
  rebuildNodePtyForElectron(moduleDir);
  ensureNodePtySpawnHelperExecutable(root);
  const retry = probeNodePtyInElectronChild(root);
  if (!retry.ok) throw retry.error;
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  if (process.argv.includes('--electron')) ensureNodePtyForElectron();
  else ensureNodePtySpawnHelperExecutable();
}
