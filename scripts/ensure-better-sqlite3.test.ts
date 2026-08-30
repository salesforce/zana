import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isNativeAbiMismatch, sqlitePackageRoot } from './ensure-better-sqlite3.mjs';

const repoRoot = dirname(fileURLToPath(new URL('.', import.meta.url)));

describe('ensure-better-sqlite3', () => {
  it('treats Electron-vs-Node ABI failures as a rebuild, not a crash', () => {
    expect(isNativeAbiMismatch(Object.assign(new Error('NODE_MODULE_VERSION 148'), { code: 'ERR_DLOPEN_FAILED' }))).toBe(true);
    expect(isNativeAbiMismatch(new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 148'))).toBe(true);
    expect(isNativeAbiMismatch(new Error('sqlite is locked'))).toBe(false);
  });

  it('resolves the workspace better-sqlite3 install', () => {
    expect(sqlitePackageRoot()).toContain('better-sqlite3');
  });

  it('runs before local Node servers so Electron rebuilds cannot empty pnpm dev', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.predev).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts.prestart).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts.prepare).toContain('ensure-better-sqlite3.mjs');
    expect(pkg.scripts.rebuild).toBe('electron-rebuild -f -w node-pty && node scripts/ensure-better-sqlite3.mjs');
  });
});
