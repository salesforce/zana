import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_FS, resolveWindowsSf, type ResolverFs } from '../lib/sf-windows-resolver.js';

function fs(files: string[], dirs: Record<string, string[]> = {}, texts: Record<string, string> = {}): ResolverFs {
  const set = new Set(files.map((file) => file.toLowerCase()));
  return { isFile: (file) => set.has(file.toLowerCase()), readdir: (dir) => dirs[dir] ?? [], readText: (file) => texts[file] ?? '' };
}

const LOCAL = 'C:\\Users\\me\\AppData\\Local';
const CLIENT = `${LOCAL}\\sf\\client`;
const INSTALLER = ['C:\\sf\\bin\\sf.cmd', 'C:\\sf\\client\\bin\\node.exe', 'C:\\sf\\client\\bin\\run.js'];
const STAGED_ENV = { SF_REDIRECTED: '1', SF_BINPATH: `${CLIENT}\\bin\\sf` };
const forwardsTo = (version: string) => ({
  [`${CLIENT}\\bin\\sf.cmd`]: `@echo off\r\nset SF_REDIRECTED=1\r\nset SF_BINPATH=%~dp0sf\r\n"%~dp0..\\${version}\\bin\\sf.cmd" %*\r\n`
});

describe('resolveWindowsSf', () => {
  it('runs the installer client node.exe directly', () => {
    expect(resolveWindowsSf({ PATH: 'C:\\sf\\bin' }, fs(INSTALLER))).toEqual({
      command: 'C:\\sf\\client\\bin\\node.exe',
      args: ['--no-deprecation', 'C:\\sf\\client\\bin\\run.js'],
      env: { SF_BINPATH: 'C:\\sf\\bin\\sf.cmd' }
    });
    expect(resolveWindowsSf({ Path: 'C:\\sf\\client\\bin' }, fs(['C:\\sf\\client\\bin\\sf.cmd', ...INSTALLER.slice(1)]))?.command)
      .toBe('C:\\sf\\client\\bin\\node.exe');
  });

  it('accepts the extensionless run entry of older installs', () => {
    const files = ['C:\\sf\\bin\\sf.cmd', 'C:\\sf\\client\\bin\\node.exe', 'C:\\sf\\client\\bin\\run'];
    expect(resolveWindowsSf({ PATH: 'C:\\sf\\bin' }, fs(files))?.args).toEqual(['--no-deprecation', 'C:\\sf\\client\\bin\\run']);
    const run = 'C:\\npm\\node_modules\\@salesforce\\cli\\bin\\run';
    expect(resolveWindowsSf({ PATH: 'C:\\npm;C:\\node' }, fs(['C:\\npm\\sf.cmd', run, 'C:\\node\\node.exe']))?.args)
      .toEqual(['--no-deprecation', run]);
  });

  it('follows the auto-updater to the newest complete staged client', () => {
    const staged = [
      `${CLIENT}\\bin\\sf.cmd`,
      `${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`, `${CLIENT}\\2.153.5-577d18f\\bin\\run.js`,
      `${CLIENT}\\2.99.0-aaaa\\bin\\node.exe`, `${CLIENT}\\2.99.0-aaaa\\bin\\run.js`,
      `${CLIENT}\\2.160.0-broken\\bin\\node.exe`
    ];
    const listing = { [CLIENT]: ['bin', '2.99.0-aaaa', '2.160.0-broken', '2.153.5-577d18f', '2.153.0-bbbb'] };
    const env = { PATH: 'C:\\sf\\bin', LOCALAPPDATA: LOCAL };
    expect(resolveWindowsSf(env, fs([...INSTALLER, ...staged], listing))).toEqual({
      command: `${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`,
      args: ['--no-deprecation', `${CLIENT}\\2.153.5-577d18f\\bin\\run.js`],
      env: STAGED_ENV
    });
    expect(resolveWindowsSf(env, fs([...INSTALLER, `${CLIENT}\\bin\\sf.cmd`], listing))?.command).toBe('C:\\sf\\client\\bin\\node.exe');
    expect(resolveWindowsSf({ PATH: 'C:\\sf\\bin', LOCALAPPDATA: 'relative' }, fs(INSTALLER))?.command).toBe('C:\\sf\\client\\bin\\node.exe');
    expect(resolveWindowsSf({ PATH: 'C:\\sf\\bin', LOCALAPPDATA: LOCAL }, fs(INSTALLER))?.command).toBe('C:\\sf\\client\\bin\\node.exe');
  });

  it('runs the staged client the updater shim forwards to, such as after a rollback', () => {
    const staged = [
      `${CLIENT}\\bin\\sf.cmd`,
      `${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`, `${CLIENT}\\2.153.5-577d18f\\bin\\run.js`,
      `${CLIENT}\\2.150.6-c049970\\bin\\node.exe`, `${CLIENT}\\2.150.6-c049970\\bin\\run.js`,
      `${CLIENT}\\2.140.0-broken\\bin\\node.exe`
    ];
    const listing = { [CLIENT]: ['bin', '2.140.0-broken', '2.150.6-c049970', '2.153.5-577d18f'] };
    const env = { PATH: 'C:\\sf\\bin', LOCALAPPDATA: LOCAL };
    const resolve = (texts: Record<string, string>) => resolveWindowsSf(env, fs([...INSTALLER, ...staged], listing, texts));
    expect(resolve(forwardsTo('2.150.6-C049970'))).toEqual({
      command: `${CLIENT}\\2.150.6-c049970\\bin\\node.exe`,
      args: ['--no-deprecation', `${CLIENT}\\2.150.6-c049970\\bin\\run.js`],
      env: STAGED_ENV
    });
    expect(resolve(forwardsTo('2.140.0-broken'))?.command).toBe(`${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`);
    expect(resolve(forwardsTo('2.999.0-gone'))?.command).toBe(`${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`);
    expect(resolve({ [`${CLIENT}\\bin\\sf.cmd`]: '@echo off\r\n' })?.command).toBe(`${CLIENT}\\2.153.5-577d18f\\bin\\node.exe`);
  });

  it('keeps listing order between staged clients of the same version', () => {
    const staged = [
      `${CLIENT}\\bin\\sf.cmd`,
      `${CLIENT}\\2.1.0-a\\bin\\node.exe`, `${CLIENT}\\2.1.0-a\\bin\\run.js`,
      `${CLIENT}\\2.1.0-b\\bin\\node.exe`, `${CLIENT}\\2.1.0-b\\bin\\run.js`
    ];
    const env = { PATH: 'C:\\empty;C:\\sf\\bin', LOCALAPPDATA: LOCAL };
    expect(resolveWindowsSf(env, fs([...INSTALLER, ...staged], { [CLIENT]: ['2.1.0-a', '2.1.0-b'] }))?.command)
      .toBe(`${CLIENT}\\2.1.0-a\\bin\\node.exe`);
  });

  it('runs an npm global install with its own or the PATH node.exe', () => {
    const run = 'C:\\npm\\node_modules\\@salesforce\\cli\\bin\\run.js';
    const npm = ['C:\\npm\\sf.cmd', run];
    expect(resolveWindowsSf({ PATH: 'C:\\npm;C:\\node' }, fs([...npm, 'C:\\node\\node.exe'])))
      .toEqual({ command: 'C:\\node\\node.exe', args: ['--no-deprecation', run], env: {} });
    expect(resolveWindowsSf({ PATH: 'C:\\npm;C:\\node' }, fs([...npm, 'C:\\npm\\node.exe', 'C:\\node\\node.exe']))?.command).toBe('C:\\npm\\node.exe');
    expect(resolveWindowsSf({ PATH: 'C:\\npm' }, fs(npm))).toBeNull();
  });

  it('skips forwarding shims and relative entries, unquotes entries, and prefers a native sf.exe', () => {
    const files = ['C:\\wrap\\sf.cmd', 'sf\\bin\\sf.cmd', ...INSTALLER];
    expect(resolveWindowsSf({ PATH: ' C:\\wrap ;sf\\bin;;"C:\\sf\\bin"' }, fs(files))?.command).toBe('C:\\sf\\client\\bin\\node.exe');
    expect(resolveWindowsSf({ PATH: 'C:\\scoop\\shims;C:\\sf\\bin' }, fs(['C:\\scoop\\shims\\sf.exe', ...INSTALLER])))
      .toEqual({ command: 'C:\\scoop\\shims\\sf.exe', args: [], env: {} });
    expect(resolveWindowsSf({ PATH: 'C:\\wrap' }, fs(['C:\\wrap\\sf.cmd']))).toBeNull();
    expect(resolveWindowsSf({}, fs(INSTALLER))).toBeNull();
  });
});

describe('NODE_FS', () => {
  it('reports regular files, directory entries and file text, and treats missing paths as absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sf-resolver-'));
    try {
      mkdirSync(path.join(root, 'bin'));
      writeFileSync(path.join(root, 'run.js'), 'entry');
      expect(NODE_FS.isFile(path.join(root, 'run.js'))).toBe(true);
      expect(NODE_FS.isFile(path.join(root, 'bin'))).toBe(false);
      expect(NODE_FS.isFile(path.join(root, 'missing'))).toBe(false);
      expect(NODE_FS.readdir(root).sort()).toEqual(['bin', 'run.js']);
      expect(NODE_FS.readdir(path.join(root, 'missing'))).toEqual([]);
      expect(NODE_FS.readText(path.join(root, 'run.js'))).toBe('entry');
      expect(NODE_FS.readText(path.join(root, 'missing'))).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
