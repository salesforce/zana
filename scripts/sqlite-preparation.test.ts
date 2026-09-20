import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import {
  prepareSqliteBinding, sqliteAddonPath, ensureBetterSqlite3ForElectron,
  probeBetterSqlite3InChild, probeBetterSqlite3InElectronChild
} from './ensure-better-sqlite3.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'zcc-abi-test-'));
  roots.push(root);
  const packageRoot = join(root, 'package');
  const addonPath = sqliteAddonPath(packageRoot);
  const cachePath = join(root, 'cache.node');
  mkdirSync(dirname(addonPath), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), '{}');
  writeFileSync(addonPath, 'node');
  const probe = vi.fn((path: string) => readFileSync(path, 'utf8') === 'electron'
    ? { ok: true } : { ok: false, error: new Error('wrong ABI') });
  const rebuild = vi.fn((source: string) => {
    mkdirSync(dirname(sqliteAddonPath(source)), { recursive: true });
    writeFileSync(sqliteAddonPath(source), 'electron');
  });
  return { abi: '148', packageRoot, addonPath, cachePath, probe, rebuild };
}

describe('native preparation isolation', () => {
  // A clean checkout can compile SQLite for Electron. Give setup the compiler's
  // bounded budget; the concurrent-load test still has its own short deadline.
  beforeAll(() => { ensureBetterSqlite3ForElectron(); }, 11 * 60_000);

  it('reuses a verified cache without writing the installed binary', () => {
    const f = fixture();
    writeFileSync(f.cachePath, 'electron');
    expect(prepareSqliteBinding(f)).toBe(f.cachePath);
    expect(f.rebuild).not.toHaveBeenCalled();
    expect(readFileSync(f.addonPath, 'utf8')).toBe('node');
  });

  it('copies the candidate before probing so another writer cannot poison publication', () => {
    const f = fixture();
    writeFileSync(f.addonPath, 'electron');
    f.probe.mockImplementation((candidate: string) => {
      expect(candidate).not.toBe(f.addonPath);
      writeFileSync(f.addonPath, 'node');
      return { ok: readFileSync(candidate, 'utf8') === 'electron' };
    });
    prepareSqliteBinding(f);
    expect(readFileSync(f.cachePath, 'utf8')).toBe('electron');
    expect(readFileSync(f.addonPath, 'utf8')).toBe('node');
    expect(f.rebuild).not.toHaveBeenCalled();
    expect(existsSync(dirname(f.probe.mock.calls[0][0]))).toBe(false);
  });

  it('repairs corrupt caches by compiling privately and publishes only after a successful SQL probe', () => {
    const f = fixture();
    writeFileSync(f.cachePath, 'corrupt');
    let buildRoot = '';
    f.rebuild.mockImplementation((source: string) => {
      buildRoot = source;
      expect(source).not.toBe(f.packageRoot);
      expect(existsSync(join(source, 'build'))).toBe(false);
      expect(readFileSync(f.cachePath, 'utf8')).toBe('corrupt');
      mkdirSync(dirname(sqliteAddonPath(source)), { recursive: true });
      writeFileSync(sqliteAddonPath(source), 'electron');
    });
    prepareSqliteBinding(f);
    expect(readFileSync(f.cachePath, 'utf8')).toBe('electron');
    expect(readFileSync(f.addonPath, 'utf8')).toBe('node');
    expect(existsSync(dirname(buildRoot))).toBe(false);
  });

  it.each(['compiler failure', 'invalid output'])('cleans staging and preserves cache on %s', (failure) => {
    const f = fixture();
    writeFileSync(f.cachePath, 'corrupt');
    let buildRoot = '';
    f.rebuild.mockImplementation((source: string) => {
      buildRoot = source;
      if (failure === 'compiler failure') throw new Error(failure);
      mkdirSync(dirname(sqliteAddonPath(source)), { recursive: true });
      writeFileSync(sqliteAddonPath(source), 'bad');
    });
    expect(() => prepareSqliteBinding(f)).toThrow();
    expect(readFileSync(f.cachePath, 'utf8')).toBe('corrupt');
    expect(existsSync(dirname(buildRoot))).toBe(false);
  });

  it('rebuilds a missing default without creating build output in the installed package', () => {
    const f = fixture();
    rmSync(f.addonPath);
    prepareSqliteBinding(f);
    expect(existsSync(f.addonPath)).toBe(false);
    expect(readdirSync(dirname(f.cachePath)).sort()).toEqual(['cache.node', 'package']);
  });

  it('opens databases in Node and Electron concurrently without switching the installed addon', async () => {
    const checksum = () => createHash('sha256').update(readFileSync(sqliteAddonPath())).digest('hex');
    const before = checksum();
    const binding = ensureBetterSqlite3ForElectron();
    await Promise.all(['--electron', ''].map((arg) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/ensure-better-sqlite3.mjs', ...(arg ? [arg] : [])], { stdio: 'pipe' });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
    expect(probeBetterSqlite3InChild()).toEqual({ ok: true });
    expect(probeBetterSqlite3InElectronChild(binding)).toEqual({ ok: true });
    expect(checksum()).toBe(before);
  }, 60_000);
});
