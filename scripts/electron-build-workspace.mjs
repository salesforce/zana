import { spawn } from 'node:child_process';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { cp as copyTree } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lockfile from 'proper-lockfile';
import { ensureBetterSqlite3ForElectron, replaceFileAtomic, sqliteAddonPath } from './ensure-better-sqlite3.mjs';

import { ensureNodePtyForElectron } from './ensure-node-pty-helper.mjs';

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const copyOptions = { recursive: true, mode: constants.COPYFILE_FICLONE };

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    const interrupt = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    };
    child.once('error', (error) => { cleanup(); reject(error); });
    child.once('exit', (code) => { cleanup(); resolve(code ?? 1); });
  });
}

/** Shared production builds and snapshots coordinate only while preparing files, never for the test run. */
export async function withBuildLock(root, work) {
  const lockPath = join(root, 'node_modules', '.cache', 'zcc-electron-build');
  mkdirSync(dirname(lockPath), { recursive: true });
  const release = await lockfile.lock(lockPath, {
    realpath: false, stale: 120_000, update: 5_000,
    retries: { retries: 600, factor: 1, minTimeout: 1000, maxTimeout: 1000 }
  });
  try { return await work(); } finally { await release(); }
}

export async function buildElectron(root, outDir, run = runCommand) {
  // Mark incomplete before Vite empties any output directory. A failed build
  // must not be mistaken for a usable previous build by test:e2e:only.
  mkdirSync(outDir, { recursive: true });
  const pending = join(outDir, '.build-in-progress');
  writeFileSync(pending, String(process.pid));
  const env = { ...process.env, ZCC_BUILD_OUT_DIR: outDir };
  const prepare = await run('pnpm', ['run', 'build:prepare'], {
    cwd: root, env, shell: process.platform === 'win32'
  });
  if (prepare !== 0) return prepare;
  const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js');
  const result = await run(process.execPath, [cli, 'build'], { cwd: root, env });
  if (result === 0) {
    await validateMainSyntax(outDir, run);
    rmSync(pending, { force: true });
  }
  return result;
}

/** Bundler-injected CommonJS shims can collide with source bindings after TS has passed. */
export async function validateMainSyntax(outDir, run = runCommand) {
  const main = join(outDir, 'main');
  for (const entry of readdirSync(main, { recursive: true })) {
    if (!String(entry).endsWith('.js')) continue;
    const file = join(main, String(entry));
    const status = await run(process.execPath, ['--check', file], { timeout: 30_000 });
    if (status !== 0) throw new Error(`Invalid generated Electron JavaScript: ${file}`);
  }
}

export function assertCompleteBuild(outDir) {
  const missing = ['main/index.js', 'main/server-runtime.js', 'preload/index.js', 'renderer/index.html']
    .filter((file) => !existsSync(join(outDir, file)));
  if (existsSync(join(outDir, '.build-in-progress')) || missing.length) {
    throw new Error(`Electron build is incomplete${missing.length ? ` (${missing.join(', ')})` : ''}. Run pnpm test:e2e -- <spec> to build an isolated copy.`);
  }
}

export async function copyNativePackage(source, destination) {
  await copyTree(source, destination, {
    ...copyOptions,
    filter: (path) => path !== join(source, 'node_modules')
  });
  symlinkSync(dirname(source), join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}

function linkEntry(source, destination) {
  if (statSync(source).isDirectory()) {
    symlinkSync(realpathSync(source), destination, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    // File symlinks need Developer Mode/admin on Windows; small loose files
    // are inexpensive to copy and then cannot change underneath the runtime.
    copyFileSync(source, destination, constants.COPYFILE_FICLONE);
  }
}

async function copyCliWorkspace(source, destination) {
  mkdirSync(destination);
  for (const entry of readdirSync(source)) {
    if (entry !== 'cli') { linkEntry(join(source, entry), join(destination, entry)); continue; }
    const cli = join(destination, entry);
    mkdirSync(cli);
    for (const file of readdirSync(join(source, entry))) {
      const path = join(source, entry, file);
      if (['dist', 'package.json'].includes(file)) await copyTree(path, join(cli, file), copyOptions);
      else linkEntry(path, join(cli, file));
    }
  }
}

/** Private output and native dependencies; ordinary JS dependencies are shared read-only. */
export async function populateRuntime(root, runtime, sqliteBinding) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (['out', 'node_modules', '.git', '.zcc', '.env', '.env.local', 'e2e', 'artifacts', 'dist'].includes(entry.name)) continue;
    const source = join(root, entry.name);
    const destination = join(runtime, entry.name);
    if (['resources', 'plugins', 'package.json'].includes(entry.name)) await copyTree(source, destination, copyOptions);
    else if (entry.name === 'packages') await copyCliWorkspace(source, destination);
    else linkEntry(source, destination);
  }
  const modules = join(runtime, 'node_modules');
  mkdirSync(modules, { recursive: true });
  for (const entry of readdirSync(join(root, 'node_modules'))) {
    if (['better-sqlite3', 'node-pty'].includes(entry)) continue;
    // A dangling optional dependency is not needed to launch the runtime.
    const source = join(root, 'node_modules', entry);
    if (existsSync(source)) linkEntry(source, join(modules, entry));
  }
  for (const name of ['better-sqlite3', 'node-pty']) {
    const source = dirname(createRequire(join(root, 'package.json')).resolve(`${name}/package.json`));
    await copyNativePackage(source, join(modules, name));
  }
  replaceFileAtomic(sqliteBinding, sqliteAddonPath(join(modules, 'better-sqlite3')));
}

export async function prepareElectronRuntime({ root = REPO_ROOT, build = false, buildApp = buildElectron } = {}) {
  const runtime = mkdtempSync(join(tmpdir(), 'zcc-electron-test-'));
  try {
    // Native preparation is independent of the build lock and never switches the install.
    const sqliteBinding = ensureBetterSqlite3ForElectron();
    await withBuildLock(root, async () => {
      if (build) {
        const status = await buildApp(root, join(runtime, 'out'));
        if (status !== 0) throw new Error(`Electron build failed (exit ${status})`);
      } else {
        assertCompleteBuild(join(root, 'out'));
        await copyTree(join(root, 'out'), join(runtime, 'out'), copyOptions);
      }
      assertCompleteBuild(join(runtime, 'out'));
      await populateRuntime(root, runtime, sqliteBinding);
    });
    ensureNodePtyForElectron(join(runtime, 'node_modules', 'node-pty'), runtime);
    return { root: runtime, dispose: () => rmSync(runtime, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(runtime, { recursive: true, force: true });
    throw error;
  }
}
