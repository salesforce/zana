#!/usr/bin/env node
/**
 * `pnpm dev` / `dev-local.mjs` open SQLite from Node (listen.ts), not Electron.
 * Electron's utility process needs the same addon compiled for Electron's ABI.
 * Those two NODE_MODULE_VERSION values cannot share one `.node` file, so builds
 * used to recompile from C on every flip. Cache both binaries and copy the
 * matching one into `build/Release` instead of running node-gyp / electron-rebuild
 * unless the cache is missing or fails to load.
 *
 * Native addons cannot be re-dlopen'd in the same process after a failed load.
 * Probe and post-restore verify always run in a child.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function isNativeAbiMismatch(error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(message);
}

export function sqlitePackageRoot() {
  return dirname(require.resolve('better-sqlite3/package.json'));
}

export function sqlitePackageVersion(root = sqlitePackageRoot()) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

export function sqliteAddonPath(root = sqlitePackageRoot()) {
  return join(root, 'build', 'Release', 'better_sqlite3.node');
}

export function nativeAbiCacheRoot() {
  return join(process.cwd(), 'node_modules', '.cache', 'zcc-native-abi');
}

export function sqliteAbiCachePath(abi, {
  cacheRoot = nativeAbiCacheRoot(),
  packageVersion = sqlitePackageVersion(),
  platform = process.platform,
  arch = process.arch
} = {}) {
  return join(
    cacheRoot,
    'better-sqlite3',
    packageVersion,
    `${platform}-${arch}`,
    `abi-${abi}.node`
  );
}

export function replaceFileAtomic(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = join(dirname(dest), `.${basename(dest)}.${process.pid}.${Date.now()}.tmp`);
  try {
    copyFileSync(src, tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, dest);
    return true;
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // tmp may not exist if copy failed before create
    }
    throw error;
  }
}

export function saveSqliteAbiCache(abi, {
  addonPath = sqliteAddonPath(),
  cachePath = sqliteAbiCachePath(abi)
} = {}) {
  return replaceFileAtomic(addonPath, cachePath);
}

export function restoreSqliteAbiCache(abi, {
  addonPath = sqliteAddonPath(),
  cachePath = sqliteAbiCachePath(abi)
} = {}) {
  if (!existsSync(cachePath)) return false;
  process.stderr.write(`[ensure-better-sqlite3] restoring ABI ${abi} from cache\n`);
  return replaceFileAtomic(cachePath, addonPath);
}

export function tryLoadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Native addons cannot be re-dlopen'd in the same Node process after a failed
 * load. Probe and post-rebuild verify in a child so restore never maps the
 * Electron-built .node (that was failing smoke teardown with
 * "Module did not self-register").
 */
export function probeBetterSqlite3InChild() {
  const script = `
    const { createRequire } = require('node:module');
    const requireFrom = createRequire(${JSON.stringify(import.meta.url)});
    const Database = requireFrom('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return decodeProbeResult(result, 'better-sqlite3 failed to load in child process');
}

export function electronBinaryPath() {
  return require('electron');
}

export function electronModulesAbi() {
  const result = spawnSync(
    electronBinaryPath(),
    ['-e', 'process.stdout.write(String(process.versions.modules))'],
    {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  );
  const abi = (result.stdout || '').trim();
  if (result.status !== 0 || !/^\d+$/.test(abi)) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(
      `failed to read Electron NODE_MODULE_VERSION (exit ${result.status ?? 'null'})${detail ? `: ${detail}` : ''}`
    );
  }
  return abi;
}

export function probeBetterSqlite3InElectronChild() {
  const script = `
    const { createRequire } = require('node:module');
    const requireFrom = createRequire(${JSON.stringify(import.meta.url)});
    const Database = requireFrom('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
  `;
  const result = spawnSync(electronBinaryPath(), ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  return decodeProbeResult(result, 'better-sqlite3 failed to load in Electron child process');
}

function decodeProbeResult(result, fallback) {
  if (result.status === 0) return { ok: true };
  const message = `${result.stderr || ''}${result.stdout || ''}`.trim() || fallback;
  const error = new Error(message);
  if (/ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|did not self-register/.test(message)) {
    error.code = 'ERR_DLOPEN_FAILED';
  }
  return { ok: false, error };
}

export function rebuildBetterSqlite3ForNode() {
  const cwd = sqlitePackageRoot();
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [cwd, process.cwd()] });
  process.stderr.write(
    `[ensure-better-sqlite3] rebuilding for Node ${process.version} (ABI ${process.versions.modules})\n`
  );
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
    cwd,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`better-sqlite3 rebuild failed with exit ${result.status ?? 'null'}`);
  }
}

export function rebuildBetterSqlite3ForElectron() {
  const cwd = sqlitePackageRoot();
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [cwd, process.cwd()] });
  const electronVersion = require('electron/package.json').version;
  const abi = electronModulesAbi();
  process.stderr.write(
    `[ensure-better-sqlite3] rebuilding for Electron ${electronVersion} (ABI ${abi})\n`
  );
  // Compile only the resolved install. `electron-rebuild -w better-sqlite3`
  // walks every pnpm copy; a leftover version without bindings fails the build.
  const result = spawnSync(
    process.execPath,
    [
      nodeGyp,
      'rebuild',
      `--target=${electronVersion}`,
      `--arch=${process.arch}`,
      '--dist-url=https://electronjs.org/headers'
    ],
    {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_runtime: 'electron',
        npm_config_target: electronVersion,
        npm_config_arch: process.arch,
        npm_config_target_arch: process.arch,
        npm_config_disturl: 'https://electronjs.org/headers',
        npm_config_build_from_source: 'true'
      }
    }
  );
  if (result.status !== 0) {
    throw new Error(`better-sqlite3 Electron rebuild failed with exit ${result.status ?? 'null'}`);
  }
}

export function ensureBetterSqlite3ForNode() {
  const loaded = probeBetterSqlite3InChild();
  if (loaded.ok) {
    saveSqliteAbiCache(process.versions.modules);
    return;
  }
  if (!isNativeAbiMismatch(loaded.error)) throw loaded.error;
  if (restoreSqliteAbiCache(process.versions.modules)) {
    const fromCache = probeBetterSqlite3InChild();
    if (fromCache.ok) return;
    process.stderr.write('[ensure-better-sqlite3] cached Node ABI binary failed to load; rebuilding\n');
  }
  rebuildBetterSqlite3ForNode();
  saveSqliteAbiCache(process.versions.modules);
  const retry = probeBetterSqlite3InChild();
  if (!retry.ok) throw retry.error;
}

export function ensureBetterSqlite3ForElectron() {
  const abi = electronModulesAbi();
  const loaded = probeBetterSqlite3InElectronChild();
  if (loaded.ok) {
    saveSqliteAbiCache(abi);
    return;
  }
  if (!isNativeAbiMismatch(loaded.error)) throw loaded.error;
  if (restoreSqliteAbiCache(abi)) {
    const fromCache = probeBetterSqlite3InElectronChild();
    if (fromCache.ok) return;
    process.stderr.write('[ensure-better-sqlite3] cached Electron ABI binary failed to load; rebuilding\n');
  }
  rebuildBetterSqlite3ForElectron();
  saveSqliteAbiCache(abi);
  const retry = probeBetterSqlite3InElectronChild();
  if (!retry.ok) throw retry.error;
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  if (process.argv.includes('--electron')) ensureBetterSqlite3ForElectron();
  else ensureBetterSqlite3ForNode();
}
