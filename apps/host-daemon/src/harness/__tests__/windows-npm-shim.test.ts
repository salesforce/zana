/**
 * Package-manager `.cmd` shims, from real generator output in
 * `fixtures/windows-shims/` (CRLF kept byte for byte):
 * - `npm-codex.cmd`: `npm install -g @openai/codex` (npm 11, cmd-shim 8);
 * - `npm-exe.cmd`, `npm-sh.cmd`: cmd-shim 8 for an exe and a `/bin/sh` script;
 * - `npm6-node.cmd`, `npm6-exe.cmd`: cmd-shim 3 (npm 6);
 * - `pnpm-node-path.cmd`: `pnpm install` (pnpm 11), install folder renamed `C:\proj`;
 * - `pnpm-node.cmd`, `pnpm-exe.cmd`: `@zkochan/cmd-shim` 5 without `NODE_PATH`;
 * - `pnpm-exe-node-path.cmd`: `@zkochan/cmd-shim` 7 for an exe, with `nodePath` set;
 * - `yarn-node.cmd`: `yarn install` (yarn 1.22), `yarn-exe.cmd`: `@zkochan/cmd-shim` 3.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeOnPath, packageManagerShimLaunch, parsePackageManagerShim } from '../windows-npm-shim.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'windows-shims');
const fixture = (name: string) => readFileSync(join(fixtures, name), 'utf8');

const root = mkdtempSync(join(tmpdir(), 'windows-npm-shim-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// A user-profile-like folder: a space and a curly apostrophe.
const shimDir = join(root, 'App Data\u2019s', 'npm');
mkdirSync(shimDir, { recursive: true });

function touch(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'x');
  return path;
}

const PROJ_NODE_PATH = [
  'C:\\proj\\node_modules\\.pnpm\\@fixture+echo-cli@file+..+pkg\\node_modules\\@fixture\\echo-cli\\node_modules',
  'C:\\proj\\node_modules\\.pnpm\\@fixture+echo-cli@file+..+pkg\\node_modules',
  'C:\\proj\\node_modules\\.pnpm\\node_modules'
].join(';');

describe('parsePackageManagerShim on real generator output', () => {
  it.each([
    ['npm-codex.cmd', ['node_modules', '@openai', 'codex', 'bin', 'codex.js']],
    ['npm6-node.cmd', ['..', 'src', 'cli.js']],
    ['pnpm-node.cmd', ['..', 'src', 'cli.js']],
    ['yarn-node.cmd', ['..', '@fixture', 'echo-cli', 'bin', 'echo-cli.js']]
  ])('reads %s as node <script>, preferring the shim folder node.exe', (name, script) => {
    expect(parsePackageManagerShim(fixture(name), shimDir)).toEqual({
      kind: 'node',
      script: join(shimDir, ...script),
      nodeArgs: [],
      localNode: join(shimDir, 'node.exe')
    });
  });

  it('reads the pnpm NODE_PATH block', () => {
    expect(parsePackageManagerShim(fixture('pnpm-node-path.cmd'), shimDir)).toEqual({
      kind: 'node',
      script: join(shimDir, '..', '@fixture', 'echo-cli', 'bin', 'echo-cli.js'),
      nodeArgs: [],
      localNode: join(shimDir, 'node.exe'),
      nodePath: PROJ_NODE_PATH
    });
  });

  it.each(['npm-exe.cmd', 'npm6-exe.cmd', 'pnpm-exe.cmd', 'yarn-exe.cmd'])('reads %s as the exe it runs', (name) => {
    expect(parsePackageManagerShim(fixture(name), shimDir)).toEqual({
      kind: 'exe',
      command: join(shimDir, '..', 'src', 'tool.exe')
    });
  });

  it('keeps the NODE_PATH block of a pnpm shim whose target is an exe', () => {
    expect(parsePackageManagerShim(fixture('pnpm-exe-node-path.cmd'), shimDir)).toEqual({
      kind: 'exe',
      command: join(shimDir, '..', 'src', 'tool.exe'),
      nodePath: 'C:\\proj\\node_modules\\.pnpm\\tool@1.0.0\\node_modules;C:\\proj\\node_modules\\.pnpm\\node_modules'
    });
  });

  it('accepts LF line endings', () => {
    const lf = fixture('npm-codex.cmd').replace(/\r\n/g, '\n');
    expect(parsePackageManagerShim(lf, shimDir)).toMatchObject({ kind: 'node' });
  });

  it('keeps shebang node arguments', () => {
    const text = fixture('npm-codex.cmd').replace('"%_prog%"  "', '"%_prog%" --no-warnings --stack-size=4096 "');
    expect(parsePackageManagerShim(text, shimDir)).toMatchObject({ nodeArgs: ['--no-warnings', '--stack-size=4096'] });
  });

  it('reads a pnpm shim with a fixed node (nodeExecPath)', () => {
    const text = '@SETLOCAL\r\n@"C:\\Program Files\\nodejs\\node.exe"  "%~dp0\\..\\src\\cli.js" %*\r\n';
    expect(parsePackageManagerShim(text, shimDir)).toEqual({
      kind: 'node',
      script: join(shimDir, '..', 'src', 'cli.js'),
      nodeArgs: [],
      node: 'C:\\Program Files\\nodejs\\node.exe'
    });
  });

  const codex = fixture('npm-codex.cmd');
  const pnpm = fixture('pnpm-node-path.cmd');
  it.each([
    ['a /bin/sh program (cmd-shim 8)', fixture('npm-sh.cmd')],
    ['a python program', codex.replace(/node\.exe/g, 'python.exe').replace('"_prog=node"', '"_prog=python"')],
    ['an extra command', codex.replace('CALL :find_dp0\r\n', 'CALL :find_dp0\r\ncalc\r\n')],
    ['a changed line', codex.replace('SET PATHEXT=%PATHEXT:;.JS;=;%', 'SET PATHEXT=.EXE')],
    ['an environment variable in the target', codex.replace('\\node_modules\\@openai', '\\%USERPROFILE%\\@openai')],
    ['delayed expansion in the target', codex.replace('\\node_modules\\@openai', '\\!X!\\@openai')],
    ['cmd syntax in a node argument', codex.replace('"%_prog%"  "', '"%_prog%" a&calc "')],
    ['a quoted node argument', codex.replace('"%_prog%"  "', '"%_prog%" "--x" "')],
    ['no %* forwarding', codex.replace('codex.js" %*', 'codex.js"')],
    ['a redirect', codex.replace('codex.js" %*', 'codex.js" %* > log')],
    ['branches running different scripts', fixture('yarn-node.cmd').replace('echo-cli.js" %*\r\n) ELSE', 'other.js" %*\r\n) ELSE')],
    ['NODE_PATH branches that differ', pnpm.replace(';C:\\proj\\node_modules\\.pnpm\\node_modules;%NODE_PATH%', ';%NODE_PATH%')],
    ['a percent in NODE_PATH', pnpm.replace(/C:\\proj/g, 'C:\\%TEMP%')],
    ['a relative fixed node', '@SETLOCAL\r\n@"node.exe"  "%~dp0\\..\\src\\cli.js" %*\r\n'],
    ['an exe shim whose target is not an exe', fixture('npm-exe.cmd').replace('tool.exe', 'tool.ps1')],
    ['a one-line forwarder (handled by parseForwardingShim)', '@"C:\\x\\claude.exe" %*\r\n'],
    ['an empty file', '']
  ])('rejects %s', (_name, text) => {
    expect(parsePackageManagerShim(text, shimDir)).toBeNull();
  });
});

describe('nodeOnPath', () => {
  const pathDir = (name: string) => join(root, 'path', name);

  it('returns the first node.exe on PATH, skipping folders without one', () => {
    const exe = touch(join(pathDir('b node'), 'node.exe'));
    expect(nodeOnPath({ PATH: `${pathDir('empty')};"${pathDir('b node')}"`, PATHEXT: '.COM;.EXE;.BAT;.CMD' })).toBe(exe);
  });

  it('returns null when a node.cmd comes first, so the shim keeps running through cmd.exe', () => {
    touch(join(pathDir('nvm'), 'node.cmd'));
    touch(join(pathDir('real'), 'node.exe'));
    expect(nodeOnPath({ PATH: `${pathDir('nvm')};${pathDir('real')}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' })).toBeNull();
  });

  it('follows PATHEXT order within a folder', () => {
    touch(join(pathDir('both'), 'node.bat'));
    const exe = touch(join(pathDir('both'), 'node.exe'));
    expect(nodeOnPath({ PATH: pathDir('both'), PATHEXT: '.EXE;.BAT' })).toBe(exe);
    expect(nodeOnPath({ PATH: pathDir('both'), PATHEXT: '.BAT;.EXE' })).toBeNull();
  });

  it('drops .JS from PATHEXT as the shim does, reads Path/Pathext case-insensitively, and defaults PATHEXT', () => {
    touch(join(pathDir('js'), 'node.js'));
    const exe = touch(join(pathDir('js'), 'node.exe'));
    expect(nodeOnPath({ Path: pathDir('js'), PathExt: '.COM;.JS;.EXE' })).toBe(exe);
    expect(nodeOnPath({ Path: pathDir('js') })).toBe(exe);
  });

  it('skips relative PATH entries, which cmd.exe would resolve against the launch folder', () => {
    const cwd = process.cwd();
    const rel = join(root, 'rel');
    touch(join(rel, 'bin', 'node.exe'));
    const exe = touch(join(pathDir('abs'), 'node.exe'));
    process.chdir(rel);
    try {
      expect(nodeOnPath({ PATH: `bin;.;${pathDir('abs')}`, PATHEXT: '.EXE' })).toBe(exe);
      expect(nodeOnPath({ PATH: 'bin', PATHEXT: '.EXE' })).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });

  it('returns null with no PATH or no node', () => {
    expect(nodeOnPath({})).toBeNull();
    expect(nodeOnPath({ PATH: `;${pathDir('empty')};` })).toBeNull();
  });
});

describe('packageManagerShimLaunch', () => {
  const dir = join(root, 'launch');
  const script = touch(join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  const pathNode = touch(join(root, 'nodejs', 'node.exe'));
  const env = { PATH: join(root, 'nodejs'), PATHEXT: '.EXE;.CMD' };
  const args = ['-c', 'developer_instructions="a & b | c %PATH% ^ \u2019x\u2019"', 'say hi'];

  it('runs node from PATH on the script with every argument verbatim', () => {
    const shim = parsePackageManagerShim(fixture('npm-codex.cmd'), dir)!;
    expect(packageManagerShimLaunch(shim, args, env)).toEqual({ command: pathNode, args: [script, ...args] });
  });

  it('prefers the node.exe next to the shim', () => {
    const local = join(root, 'launch-local');
    const localScript = touch(join(local, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    const localNode = touch(join(local, 'node.exe'));
    const shim = parsePackageManagerShim(fixture('npm-codex.cmd'), local)!;
    expect(packageManagerShimLaunch(shim, ['x'], env)).toEqual({ command: localNode, args: [localScript, 'x'] });
  });

  it('puts shebang node arguments before the script', () => {
    const shim = { kind: 'node' as const, script, nodeArgs: ['--no-warnings'], localNode: join(dir, 'node.exe') };
    expect(packageManagerShimLaunch(shim, ['x'], env)?.args).toEqual(['--no-warnings', script, 'x']);
  });

  it('prepends the pnpm NODE_PATH to an existing one, keeping its key spelling', () => {
    const shim = { kind: 'node' as const, script, nodeArgs: [], nodePath: 'C:\\a;C:\\b' };
    expect(packageManagerShimLaunch(shim, [], env)?.env).toEqual({ NODE_PATH: 'C:\\a;C:\\b' });
    expect(packageManagerShimLaunch(shim, [], { ...env, node_path: 'C:\\old' })?.env).toEqual({ node_path: 'C:\\a;C:\\b;C:\\old' });
    expect(packageManagerShimLaunch(shim, [], { ...env, NODE_PATH: '' })?.env).toEqual({ NODE_PATH: 'C:\\a;C:\\b' });
  });

  it('uses a fixed node when it exists', () => {
    const shim = { kind: 'node' as const, script, nodeArgs: [], node: pathNode };
    expect(packageManagerShimLaunch(shim, [], { PATH: '' })?.command).toBe(pathNode);
    expect(packageManagerShimLaunch({ ...shim, node: join(root, 'gone', 'node.exe') }, [], env)).toBeNull();
  });

  it('runs the target of an exe shim', () => {
    const exe = touch(join(root, 'src', 'tool.exe'));
    expect(packageManagerShimLaunch({ kind: 'exe', command: exe }, ['-p'], env)).toEqual({ command: exe, args: ['-p'] });
  });

  it('carries the pnpm NODE_PATH of an exe shim into its env', () => {
    const exe = touch(join(root, 'src', 'tool.exe'));
    const shim = parsePackageManagerShim(fixture('pnpm-exe-node-path.cmd'), join(root, 'bin'))!;
    expect(packageManagerShimLaunch(shim, ['-p'], { ...env, NODE_PATH: 'C:\\old' })).toEqual({
      command: exe,
      args: ['-p'],
      env: { NODE_PATH: 'C:\\proj\\node_modules\\.pnpm\\tool@1.0.0\\node_modules;C:\\proj\\node_modules\\.pnpm\\node_modules;C:\\old' }
    });
  });

  it('returns null when the script, the exe target or node is missing', () => {
    const missing = join(root, 'missing', 'cli.js');
    expect(packageManagerShimLaunch({ kind: 'node', script: missing, nodeArgs: [] }, [], env)).toBeNull();
    expect(packageManagerShimLaunch({ kind: 'exe', command: join(root, 'missing', 'x.exe') }, [], env)).toBeNull();
    expect(packageManagerShimLaunch({ kind: 'node', script, nodeArgs: [], localNode: join(dir, 'node.exe') }, [], { PATH: '' })).toBeNull();
  });
});
