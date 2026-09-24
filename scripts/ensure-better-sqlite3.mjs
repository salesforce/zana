#!/usr/bin/env node
/** Prepare independent, verified binaries for Node and Electron. Never compile in the installed package. */
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, cpSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { sqliteAbiCachePath as cachePathFor } from '../packages/db/src/native-binding.mjs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  return fileURLToPath(new URL('../node_modules/.cache/zcc-native-abi', import.meta.url));
}

export function sqliteAbiCachePath(abi, {
  cacheRoot = nativeAbiCacheRoot(),
  packageVersion = sqlitePackageVersion(),
  platform = process.platform,
  arch = process.arch
} = {}) {
  return cachePathFor(abi, { cacheRoot, packageVersion, platform, arch });
}

export function replaceFileAtomic(src, dest) {
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = join(dirname(dest), `.${basename(dest)}.${process.pid}.${randomUUID()}.tmp`);
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
export function probeBetterSqlite3InChild(nativeBinding) {
  const script = `
    const { createRequire } = require('node:module');
    const requireFrom = createRequire(${JSON.stringify(import.meta.url)});
    const Database = requireFrom('better-sqlite3');
    const db = new Database(':memory:', ${JSON.stringify(nativeBinding ? { nativeBinding } : {})});
    if (db.prepare('SELECT 42 AS value').get().value !== 42) throw new Error('SQLite probe failed');
    db.close();
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
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
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
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

export function probeBetterSqlite3InElectronChild(nativeBinding) {
  const script = `
    const { createRequire } = require('node:module');
    const requireFrom = createRequire(${JSON.stringify(import.meta.url)});
    const Database = requireFrom('better-sqlite3');
    const db = new Database(':memory:', ${JSON.stringify(nativeBinding ? { nativeBinding } : {})});
    if (db.prepare('SELECT 42 AS value').get().value !== 42) throw new Error('SQLite probe failed');
    db.close();
  `;
  const result = spawnSync(electronBinaryPath(), ['-e', script], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });
  return decodeProbeResult(result, 'better-sqlite3 failed to load in Electron child process');
}

function decodeProbeResult(result, fallback) {
  if (result.error) return { ok: false, error: result.error };
  if (result.status === 0) return { ok: true };
  const message = `${result.stderr || ''}${result.stdout || ''}`.trim() || fallback;
  const error = new Error(message);
  if (/ERR_DLOPEN_FAILED|NODE_MODULE_VERSION|did not self-register/.test(message)) {
    error.code = 'ERR_DLOPEN_FAILED';
  }
  return { ok: false, error };
}

export function rebuildBetterSqlite3ForNode(cwd) {
  if (!cwd || resolve(cwd) === resolve(sqlitePackageRoot())) throw new Error('Native rebuild requires a private staging directory');
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [sqlitePackageRoot()] });
  process.stderr.write(
    `[ensure-better-sqlite3] rebuilding for Node ${process.version} (ABI ${process.versions.modules})\n`
  );
  const result = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
    cwd,
    stdio: 'inherit',
    timeout: 10 * 60_000,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`better-sqlite3 rebuild failed with exit ${result.status ?? 'null'}`);
  }
}

export function rebuildBetterSqlite3ForElectron(cwd) {
  if (!cwd || resolve(cwd) === resolve(sqlitePackageRoot())) throw new Error('Native rebuild requires a private staging directory');
  const nodeGyp = require.resolve('node-gyp/bin/node-gyp.js', { paths: [sqlitePackageRoot()] });
  const electronVersion = require('electron/package.json').version;
  const abi = electronModulesAbi();
  process.stderr.write(
    `[ensure-better-sqlite3] rebuilding for Electron ${electronVersion} (ABI ${abi})\n`
  );
  // Compile only the private staging package. `electron-rebuild -w better-sqlite3`
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
      timeout: 10 * 60_000,
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

/**
 * Each attempt owns a staging directory. Only a binary that opened a database
 * in the target runtime is atomically published; concurrent preparers cannot
 * expose a partial compile or cache a binary another runtime just replaced.
 */
export function prepareSqliteBinding({ abi, cachePath, addonPath, probe, rebuild, packageRoot = sqlitePackageRoot() }) {
  if (existsSync(cachePath) && probe(cachePath).ok) return cachePath;
  const stage = mkdtempSync(join(tmpdir(), 'zcc-sqlite-'));
  try {
    const candidate = join(stage, 'candidate.node');
    if (replaceFileAtomic(addonPath, candidate) && probe(candidate).ok) {
      replaceFileAtomic(candidate, cachePath);
      return cachePath;
    }
    const source = join(stage, 'source');
    cpSync(packageRoot, source, {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      filter: (path) => !['build', 'node_modules'].includes(path.slice(packageRoot.length + 1).split(/[\\/]/)[0])
    });
    // pnpm keeps node-gyp dependencies beside the resolved package.
    symlinkSync(dirname(packageRoot), join(source, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    rebuild(source);
    const built = sqliteAddonPath(source);
    const checked = probe(built);
    if (!checked.ok) throw checked.error;
    replaceFileAtomic(built, cachePath);
    process.stderr.write(`[ensure-better-sqlite3] prepared ABI ${abi} at ${cachePath}\n`);
    return cachePath;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function ensureBetterSqlite3ForNode({ cachePath = sqliteAbiCachePath(process.versions.modules), addonPath = sqliteAddonPath() } = {}) {
  const abi = process.versions.modules;
  prepareSqliteBinding({
    abi, cachePath, addonPath,
    probe: probeBetterSqlite3InChild, rebuild: rebuildBetterSqlite3ForNode
  });
  // Third-party tooling still uses the package default. Only Node preparation
  // repairs that default; our running product connections use the ABI cache.
  if (!probeBetterSqlite3InChild().ok) {
    replaceFileAtomic(cachePath, addonPath);
    const checked = probeBetterSqlite3InChild();
    if (!checked.ok) throw checked.error;
  }
  return cachePath;
}

export function ensureBetterSqlite3ForElectron() {
  const abi = electronModulesAbi();
  return prepareSqliteBinding({
    abi, cachePath: sqliteAbiCachePath(abi), addonPath: sqliteAddonPath(),
    probe: probeBetterSqlite3InElectronChild, rebuild: rebuildBetterSqlite3ForElectron
  });
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  if (process.argv.includes('--electron')) ensureBetterSqlite3ForElectron();
  else ensureBetterSqlite3ForNode();
}
