import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  electronModulesAbi,
  ensureBetterSqlite3ForElectron,
  prepareSqliteBinding,
  isNativeAbiMismatch,
  probeBetterSqlite3InChild,
  replaceFileAtomic,
  restoreSqliteAbiCache,
  saveSqliteAbiCache,
  sqliteAbiCachePath,
  sqlitePackageRoot,
  sqlitePackageVersion,
  tryLoadBetterSqlite3
} from './ensure-better-sqlite3.mjs';

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));

function workspacePackageJsons(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules'
      || entry.name === 'dist'
      || entry.name === 'out'
      || entry.name === '.git'
      || entry.name.startsWith('.')
    ) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) workspacePackageJsons(path, acc);
    else if (entry.name === 'package.json') acc.push(path);
  }
  return acc;
}

describe('ensure-better-sqlite3', () => {
  it('treats Electron-vs-Node ABI failures as a rebuild, not a crash', () => {
    expect(isNativeAbiMismatch(Object.assign(new Error('NODE_MODULE_VERSION 148'), { code: 'ERR_DLOPEN_FAILED' }))).toBe(true);
    expect(isNativeAbiMismatch(new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 148'))).toBe(true);
    expect(isNativeAbiMismatch(new Error('sqlite is locked'))).toBe(false);
  });

  it('resolves the workspace better-sqlite3 install', () => {
    expect(sqlitePackageRoot()).toContain('better-sqlite3');
  });

  it('can load better-sqlite3 in a fresh child after this process has already required it', () => {
    expect(tryLoadBetterSqlite3()).toEqual({ ok: true });
    expect(probeBetterSqlite3InChild()).toEqual({ ok: true });
  });

  it('runs before local Node servers so Electron rebuilds cannot empty pnpm dev', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['dev:prepare']).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts['build:prepare']).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts.prepare).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts.prestart).toBeUndefined();
    expect(pkg.scripts.rebuild).toBe(
      'node scripts/ensure-node-pty-helper.mjs --electron && node scripts/ensure-better-sqlite3.mjs'
    );
    expect(pkg.scripts['rebuild:electron']).toBe(
      'node scripts/ensure-node-pty-helper.mjs --electron && node scripts/ensure-better-sqlite3.mjs --electron'
    );
  });

  it('keys the ABI cache by package version, platform, arch, and NODE_MODULE_VERSION', () => {
    const path = sqliteAbiCachePath('148', {
      cacheRoot: '/tmp/cache',
      packageVersion: '12.11.1',
      platform: 'darwin',
      arch: 'arm64'
    });
    expect(path).toBe('/tmp/cache/better-sqlite3/12.11.1/darwin-arm64/abi-148.node');
    expect(sqlitePackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('restores a cached ABI binary by copying instead of compiling', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-sqlite-abi-'));
    try {
      const addonPath = join(root, 'build', 'Release', 'better_sqlite3.node');
      const cachePath = sqliteAbiCachePath('137', {
        cacheRoot: join(root, 'cache'),
        packageVersion: '12.11.1',
        platform: 'darwin',
        arch: 'arm64'
      });
      mkdirSync(dirname(addonPath), { recursive: true });
      writeFileSync(addonPath, 'node-abi');
      expect(saveSqliteAbiCache('137', { addonPath, cachePath })).toBe(true);
      writeFileSync(addonPath, 'electron-abi');
      expect(restoreSqliteAbiCache('137', { addonPath, cachePath })).toBe(true);
      expect(readFileSync(addonPath, 'utf8')).toBe('node-abi');
      expect(restoreSqliteAbiCache('148', {
        addonPath,
        cachePath: sqliteAbiCachePath('148', {
          cacheRoot: join(root, 'cache'),
          packageVersion: '12.11.1',
          platform: 'darwin',
          arch: 'arm64'
        })
      })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not copy when the ABI source is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-sqlite-abi-missing-'));
    try {
      const missing = join(root, 'missing.node');
      const dest = join(root, 'dest.node');
      expect(replaceFileAtomic(missing, dest)).toBe(false);
      expect(saveSqliteAbiCache('137', {
        addonPath: missing,
        cachePath: join(root, 'cache', 'abi-137.node')
      })).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads Electron NODE_MODULE_VERSION without opening a window', () => {
    expect(electronModulesAbi()).toMatch(/^\d+$/);
  });

  it('pins one better-sqlite3 specifier so leftover pnpm copies cannot shadow the resolved install', () => {
    const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const expected = rootPkg.dependencies['better-sqlite3'];
    expect(expected).toBeTruthy();
    const drifted: string[] = [];
    for (const pkgPath of workspacePackageJsons(repoRoot)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
        const spec = pkg[field]?.['better-sqlite3'];
        if (spec && spec !== expected) drifted.push(`${pkgPath}: ${field}=${spec}`);
      }
    }
    expect(drifted).toEqual([]);
  });
});
