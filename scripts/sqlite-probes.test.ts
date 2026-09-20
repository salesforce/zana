import { afterEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  electronModulesAbi, ensureBetterSqlite3ForNode, probeBetterSqlite3InChild,
  probeBetterSqlite3InElectronChild, rebuildBetterSqlite3ForElectron,
  rebuildBetterSqlite3ForNode, replaceFileAtomic, sqlitePackageRoot
} from './ensure-better-sqlite3.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); });
const output = (status: number | null, stderr = '', stdout = '') => ({ status, stderr, stdout, signal: null, pid: 1, output: [] });

describe('bounded native probes and compiler failures', () => {
  it('reports timeout, loader ABI errors and ordinary failures separately', () => {
    const spawn = vi.mocked(childProcess.spawnSync);
    const timeout = new Error('probe timeout');
    spawn.mockReturnValueOnce({ ...output(null), error: timeout });
    expect(probeBetterSqlite3InChild('/cache/node.node')).toEqual({ ok: false, error: timeout });
    spawn.mockReturnValueOnce(output(1, 'NODE_MODULE_VERSION 148'));
    const failed = probeBetterSqlite3InElectronChild('/cache/electron.node');
    expect(failed.error.code).toBe('ERR_DLOPEN_FAILED');
    spawn.mockReturnValueOnce(output(1));
    expect(probeBetterSqlite3InChild().error.message).toContain('failed to load');
    spawn.mockReturnValueOnce(output(1, '', 'SQL failed'));
    expect(probeBetterSqlite3InElectronChild().error.message).toBe('SQL failed');
    expect(spawn.mock.calls[0][2]).toMatchObject({ timeout: 30_000, maxBuffer: 1024 * 1024 });
  });

  it('rejects missing or malformed Electron ABI output', () => {
    const spawn = vi.mocked(childProcess.spawnSync);
    spawn.mockReturnValueOnce(output(null));
    expect(() => electronModulesAbi()).toThrow('exit null');
    spawn.mockReturnValueOnce(output(0, 'bad', 'not-an-abi'));
    expect(() => electronModulesAbi()).toThrow('badnot-an-abi');
  });

  it('compiles only private staging and bounds both compiler runtimes', () => {
    const spawn = vi.mocked(childProcess.spawnSync);
    const stage = join(tmpdir(), 'sqlite-private-stage');
    expect(() => rebuildBetterSqlite3ForNode(sqlitePackageRoot())).toThrow('private staging');
    expect(() => rebuildBetterSqlite3ForElectron()).toThrow('private staging');
    spawn.mockReturnValueOnce(output(0));
    rebuildBetterSqlite3ForNode(stage);
    expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: stage, timeout: 600_000 });
    spawn.mockReturnValueOnce(output(1));
    expect(() => rebuildBetterSqlite3ForNode(stage)).toThrow('exit 1');
    spawn.mockReturnValueOnce(output(0, '', '148')).mockReturnValueOnce(output(0));
    rebuildBetterSqlite3ForElectron(stage);
    expect(spawn.mock.calls[3][2]).toMatchObject({ cwd: stage, env: { npm_config_runtime: 'electron' } });
    expect(spawn.mock.calls[3][1]).toContain('--dist-url=https://electronjs.org/headers');
    spawn.mockReturnValueOnce(output(0, '', '148')).mockReturnValueOnce(output(null));
    expect(() => rebuildBetterSqlite3ForElectron(stage)).toThrow('exit null');
  });

  it('repairs a legacy default from verified Node cache and verifies the repair in a fresh child', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-repair-test-'));
    try {
      const cachePath = join(root, 'cache.node');
      const addonPath = join(root, 'default.node');
      writeFileSync(cachePath, 'node');
      writeFileSync(addonPath, 'electron');
      const spawn = vi.mocked(childProcess.spawnSync);
      spawn.mockReturnValueOnce(output(0)).mockReturnValueOnce(output(1)).mockReturnValueOnce(output(0));
      expect(ensureBetterSqlite3ForNode({ cachePath, addonPath })).toBe(cachePath);
      expect(readFileSync(addonPath, 'utf8')).toBe('node');
      spawn.mockReturnValueOnce(output(0)).mockReturnValueOnce(output(1)).mockReturnValueOnce(output(1, 'still broken'));
      expect(() => ensureBetterSqlite3ForNode({ cachePath, addonPath })).toThrow('still broken');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('cleans incomplete atomic writes and leaves an existing destination intact', () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-copy-test-'));
    try {
      const source = join(root, 'source');
      const directory = join(root, 'directory');
      writeFileSync(source, 'new');
      mkdirSync(directory);
      expect(() => replaceFileAtomic(source, directory)).toThrow();
      expect(readdirSync(root).sort()).toEqual(['directory', 'source']);
      expect(() => replaceFileAtomic(directory, join(root, 'dest'))).toThrow();
      expect(readdirSync(root).sort()).toEqual(['directory', 'source']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
