import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { copyBundledPluginRuntime, copyRecoveryRollbackRuntime } from './plugin-recovery-runtime.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const roots: string[] = [];
afterEach(() => { vi.mocked(fs.copyFile).mockClear(); vi.restoreAllMocks(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'plugin-recovery-')); roots.push(root);
  const bundledRoot = join(root, 'bundle'), source = join(bundledRoot, 'tasks');
  mkdirSync(join(source, 'bin'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{}');
  writeFileSync(join(source, 'bin/run'), 'clean runtime', { mode: 0o700 });
  const controller = new AbortController();
  const args = { dataDir: join(root, 'data'), bundledRoot, name: 'tasks', signal: controller.signal };
  return { root, source, args, controller, recover: () => copyBundledPluginRuntime(args) };
}

it('copies app runtimes into distinct managed generations offline and preserves nested bytes and executable permissions', async () => {
  const { source, args, recover } = fixture();
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  const first = await recover(), second = await recover();
  expect(first).not.toBe(second);
  expect(first.startsWith(join(args.dataDir, 'plugins/generations'))).toBe(true);
  expect(readFileSync(join(first, 'bin/run'), 'utf8')).toBe('clean runtime');
  if (process.platform !== 'win32') expect(statSync(join(first, 'bin/run')).mode & 0o777).toBe(0o700);
  writeFileSync(join(first, 'bin/run'), 'damaged managed copy');
  expect(readFileSync(join(source, 'bin/run'), 'utf8')).toBe('clean runtime');
  expect(readFileSync(join(second, 'bin/run'), 'utf8')).toBe('clean runtime');
  expect(network).not.toHaveBeenCalled();
});

it.each(['../escape', '/absolute', 'a/b', 'a\\b', '', '.'])('refuses unsafe bundle names: %s', async name => {
  const { args } = fixture();
  await expect(copyBundledPluginRuntime({ ...args, name })).rejects.toThrow('Invalid bundled plugin name');
  expect(existsSync(args.dataDir)).toBe(false);
});

it('reports missing app files with reinstall guidance and does not create a generation', async () => {
  const { source, args, recover } = fixture();
  rmSync(source, { recursive: true });
  await expect(recover()).rejects.toThrow('Reinstall Zana');
  expect(existsSync(args.dataDir)).toBe(false);
});

it('refuses a bundled plugin directory linked outside the app resources or back to their root', async () => {
  const { root, source, args, recover } = fixture();
  rmSync(source, { recursive: true });
  const outside = join(root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, source, 'junction');
  await expect(recover()).rejects.toThrow('escapes the app bundle');
  rmSync(source);
  symlinkSync(args.bundledRoot, source, 'junction');
  await expect(recover()).rejects.toThrow('escapes the app bundle');
  expect(existsSync(args.dataDir)).toBe(false);
});

it('rejects escaping descendants and excessive runtime sizes and removes failed generations', async () => {
  const { root, source, args, recover } = fixture();
  const outside = join(root, 'outside'); writeFileSync(outside, 'outside');
  symlinkSync(outside, join(source, 'escape'));
  await expect(recover()).rejects.toThrow('escapes');
  expect(readdirSync(join(args.dataDir, 'plugins/generations'))).toEqual([]);
  rmSync(join(source, 'escape'));
  const large = join(source, 'large'); writeFileSync(large, ''); truncateSync(large, 65 * 1024 * 1024);
  await expect(recover()).rejects.toThrow('size limit');
  expect(readdirSync(join(args.dataDir, 'plugins/generations'))).toEqual([]);
});

it('aborts before copying or midway through a snapshot and cleans partial output', async () => {
  const before = fixture(); before.controller.abort(new Error('stopped'));
  await expect(before.recover()).rejects.toThrow('stopped');
  expect(existsSync(before.args.dataDir)).toBe(false);
  const during = fixture();
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(fs.copyFile).mockImplementationOnce(async (...args) => {
    await actual.copyFile(...args);
    during.controller.abort(new Error('stopped'));
  });
  await expect(during.recover()).rejects.toThrow('stopped');
  expect(readdirSync(join(during.args.dataDir, 'plugins/generations'))).toEqual([]);
});

it('cleans the candidate after a filesystem copy error', async () => {
  const { args, recover } = fixture();
  vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error('disk full'));
  await expect(recover()).rejects.toThrow('disk full');
  expect(readdirSync(join(args.dataDir, 'plugins/generations'))).toEqual([]);
});

it('snapshots rollback files, allows missing old code and rejects escaping or excessive rollback trees', async () => {
  const { root, source } = fixture();
  const backup = await copyRecoveryRollbackRuntime(root, source);
  expect(readFileSync(join(backup, 'bin/run'), 'utf8')).toBe('clean runtime');
  expect(readdirSync(await copyRecoveryRollbackRuntime(root, join(root, 'missing')))).toEqual([]);
  writeFileSync(join(root, 'outside'), 'outside');
  symlinkSync(join(root, 'outside'), join(source, 'escape'));
  await expect(copyRecoveryRollbackRuntime(root, source)).rejects.toThrow('escapes');
  rmSync(join(source, 'escape'));
  writeFileSync(join(source, 'large'), ''); truncateSync(join(source, 'large'), 65 * 1024 * 1024);
  await expect(copyRecoveryRollbackRuntime(root, source)).rejects.toThrow('size limit');
  expect(readdirSync(join(root, 'plugins/generations'))).toHaveLength(2);
});
