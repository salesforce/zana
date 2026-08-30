#!/usr/bin/env node
/**
 * `pnpm dev` / `dev-local.mjs` open SQLite from Node (listen.ts), not Electron.
 * `electron-rebuild` compiles better-sqlite3 for Electron's ABI, which then
 * crashes Node with NODE_MODULE_VERSION mismatch. Rebuild for this process
 * when the addon cannot load.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
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

export function ensureBetterSqlite3ForNode() {
  const loaded = tryLoadBetterSqlite3();
  if (loaded.ok) return;
  if (!isNativeAbiMismatch(loaded.error)) throw loaded.error;
  rebuildBetterSqlite3ForNode();
  const retry = tryLoadBetterSqlite3();
  if (!retry.ok) throw retry.error;
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  ensureBetterSqlite3ForNode();
}
