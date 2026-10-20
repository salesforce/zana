import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPLESCRIPT_ALLOWED_CHARS,
  MARKER_FILE,
  buildAppleScript,
  buildPlistEdits,
  helperPaths,
  main,
  register,
  unregister,
  validateDevLink
} from './dev-register-link.mjs';

const dirs: string[] = [];
function tmpHome() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-register-link-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDeps(home: string, overrides: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const errs: string[] = [];
  const exec = vi.fn((_cmd: string, _args: string[]) => '');
  return {
    logs,
    errs,
    exec,
    deps: {
      platform: 'darwin',
      home,
      nodePath: '/opt/node/bin/node',
      repoRoot: '/work/zana',
      exec,
      existsSync: (p: string) => p === '/usr/bin/osacompile' || existsSync(p),
      log: (l: string) => logs.push(l),
      err: (l: string) => errs.push(l),
      ...overrides
    }
  };
}

describe('validateDevLink', () => {
  it('accepts zana-dev plugin links', () => {
    expect(validateDevLink('zana-dev://plugin/design-docs/join?d=abc_-%3D')).toBeNull();
    expect(validateDevLink('zana-dev://plugin/a/b/c/')).toBeNull();
    expect(validateDevLink('ZANA-DEV://plugin/a/b')).toBeNull();
  });

  it.each([
    undefined,
    '',
    'zana://plugin/a/b',
    'https://plugin/a/b',
    'zana-dev://other/a/b',
    'zana-dev://plugin/a/b c',
    'zana-dev://plugin/a/b\n',
    'zana-dev://plugin/a/b?d=$(touch x)',
    'zana-dev://plugin/a/b?d=a;b',
    "zana-dev://plugin/a/b?d='",
    'zana-dev://plugin/A_B/b',
    `zana-dev://plugin/a/b?d=${'x'.repeat(9000)}`
  ])('rejects %s', (link) => {
    expect(validateDevLink(link as string)).toEqual(expect.any(String));
  });
});

describe('buildAppleScript / buildPlistEdits', () => {
  const input = { nodePath: '/opt/node/bin/node', scriptPath: '/work/zana/scripts/dev-open-link.mjs', buildEntry: '/work/zana/out-dev/main/index.js' };

  it('bakes absolute paths and passes the URL as one quoted argument', () => {
    const src = buildAppleScript(input);
    expect(src).toContain('property nodePath : "/opt/node/bin/node"');
    expect(src).toContain('property scriptPath : "/work/zana/scripts/dev-open-link.mjs"');
    expect(src).toContain('property buildEntry : "/work/zana/out-dev/main/index.js"');
    expect(src).toContain('on open location theURL');
    expect(src).toContain('quoted form of theURL');
    expect(src).toContain('theURL does not start with "zana-dev://plugin/"');
    expect(src).toContain('Run pnpm run dev first');
    expect(src).toContain(`property allowedChars : "${APPLESCRIPT_ALLOWED_CHARS}"`);
  });

  it('allowed chars exclude shell metacharacters and whitespace', () => {
    for (const ch of ['$', '`', '"', "'", '\\', ';', '|', '<', '>', '(', ')', '*', '!', '#', '{', '}', ' ']) {
      expect(APPLESCRIPT_ALLOWED_CHARS).not.toContain(ch);
    }
  });

  it('escapes quotes and backslashes in paths', () => {
    const src = buildAppleScript({ ...input, nodePath: '/odd "dir"/back\\slash/node' });
    expect(src).toContain('property nodePath : "/odd \\"dir\\"/back\\\\slash/node"');
  });

  it.each(['', '/a\nb', '/a\u0000b'])('refuses unsafe path %j', (bad) => {
    expect(() => buildAppleScript({ ...input, nodePath: bad })).toThrow(/refusing path/);
  });

  it('declares the zana-dev scheme, background mode and a bundle id', () => {
    const edits = buildPlistEdits('/x/Info.plist');
    const flat = edits.map((e) => e.join(' ')).join('\n');
    expect(flat).toContain('LSUIElement -bool true');
    expect(flat).toContain('CFBundleIdentifier -string ai.zana.dev-link-helper');
    const json = edits.find((e) => e.includes('CFBundleURLTypes'))![3];
    expect(JSON.parse(json)).toEqual([{ CFBundleURLName: 'Zana Dev Link', CFBundleURLSchemes: ['zana-dev'] }]);
    expect(edits.every((e) => e[e.length - 1] === '/x/Info.plist')).toBe(true);
  });
});

describe('register', () => {
  it('is a no-op with a message off macOS', () => {
    const home = tmpHome();
    const { deps, exec, logs } = makeDeps(home, { platform: 'linux' });
    expect(register({}, deps)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/macOS-only/);
    expect(existsSync(helperPaths(home).dir)).toBe(false);
    expect(unregister({}, deps)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('dry-run prints the plan and writes nothing', () => {
    const home = tmpHome();
    const { deps, exec, logs } = makeDeps(home);
    expect(register({ dryRun: true }, deps)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(existsSync(helperPaths(home).dir)).toBe(false);
    expect(logs.join('\n')).toContain('lsregister');
    expect(logs.join('\n')).toContain('/opt/node/bin/node /work/zana/scripts/dev-open-link.mjs');
  });

  it('writes marker and source, then compiles, patches, signs and registers via argv arrays', () => {
    const home = tmpHome();
    const { deps, exec, logs } = makeDeps(home);
    expect(register({}, deps)).toBe(0);
    const paths = helperPaths(home);
    expect(existsSync(paths.marker)).toBe(true);
    expect(readFileSync(paths.source, 'utf8')).toContain('property nodePath : "/opt/node/bin/node"');
    const cmds = exec.mock.calls.map(([cmd, args]) => [cmd, ...args]);
    expect(cmds[0]).toEqual(['/usr/bin/osacompile', '-o', paths.app, paths.source]);
    expect(cmds.filter((c) => c[0] === '/usr/bin/plutil')).toHaveLength(4);
    expect(cmds.some((c) => c[0] === '/usr/bin/codesign')).toBe(true);
    const last = cmds[cmds.length - 1];
    expect(last[0]).toMatch(/lsregister$/);
    expect(last.slice(1)).toEqual(['-f', paths.app]);
    expect(logs.join('\n')).toMatch(/choose ZanaDevLink/);
  });

  it('is idempotent and re-bakes updated paths', () => {
    const home = tmpHome();
    expect(register({}, makeDeps(home).deps)).toBe(0);
    expect(register({}, makeDeps(home, { nodePath: '/new/node' }).deps)).toBe(0);
    expect(readFileSync(helperPaths(home).source, 'utf8')).toContain('"/new/node"');
  });

  it('fails when osacompile is missing', () => {
    const { deps, errs, exec } = makeDeps(tmpHome(), { existsSync: () => false });
    expect(register({}, deps)).toBe(1);
    expect(errs.join('\n')).toMatch(/osacompile/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('fails when a tool errors, but only warns when codesign fails', () => {
    const failing = makeDeps(tmpHome());
    failing.exec.mockImplementation((cmd: string) => {
      if (cmd.endsWith('osacompile')) throw Object.assign(new Error('boom'), { stderr: 'compile error\nmore' });
      return '';
    });
    expect(register({}, failing.deps)).toBe(1);
    expect(failing.errs.join('\n')).toContain('compile error');

    const signing = makeDeps(tmpHome());
    signing.exec.mockImplementation((cmd: string) => {
      if (cmd.endsWith('codesign')) throw new Error('no sign');
      return '';
    });
    expect(register({}, signing.deps)).toBe(0);
    expect(signing.errs.join('\n')).toMatch(/codesign failed/);
  });

  it('fails on unsafe node path', () => {
    const { deps, errs } = makeDeps(tmpHome(), { nodePath: '/bad\npath' });
    expect(register({}, deps)).toBe(1);
    expect(errs.join('\n')).toMatch(/cannot generate helper/);
  });
});

describe('unregister', () => {
  it('does nothing when not registered', () => {
    const { deps, exec, logs } = makeDeps(tmpHome());
    expect(unregister({}, deps)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/Nothing to remove/);
  });

  it('deregisters and deletes only the marked helper dir', () => {
    const home = tmpHome();
    const paths = helperPaths(home);
    mkdirSync(paths.app, { recursive: true });
    writeFileSync(paths.marker, 'x');
    const { deps, exec } = makeDeps(home);
    expect(unregister({}, deps)).toBe(0);
    expect(exec.mock.calls[0][1]).toEqual(['-u', paths.app]);
    expect(existsSync(paths.dir)).toBe(false);
    expect(existsSync(home)).toBe(true);
  });

  it('still deletes when lsregister -u fails', () => {
    const home = tmpHome();
    const paths = helperPaths(home);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.marker, 'x');
    const { deps, errs } = makeDeps(home);
    deps.exec.mockImplementation(() => {
      throw new Error('nope');
    });
    expect(unregister({}, deps)).toBe(0);
    expect(errs.join('\n')).toMatch(/lsregister -u failed/);
    expect(existsSync(paths.dir)).toBe(false);
  });

  it('refuses a directory without the marker', () => {
    const home = tmpHome();
    const paths = helperPaths(home);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(join(paths.dir, 'precious.txt'), 'keep');
    const { deps, exec, errs } = makeDeps(home);
    expect(unregister({}, deps)).toBe(1);
    expect(exec).not.toHaveBeenCalled();
    expect(existsSync(join(paths.dir, 'precious.txt'))).toBe(true);
    expect(errs.join('\n')).toContain(MARKER_FILE);
  });

  it('reports a failed inspection instead of throwing when the dir vanishes after the existence check', () => {
    const home = tmpHome();
    const { deps, exec, errs } = makeDeps(home, { existsSync: () => true });
    expect(unregister({}, deps)).toBe(1);
    expect(exec).not.toHaveBeenCalled();
    expect(errs.join('\n')).toContain('could not inspect');
  });

  it('refuses a symlinked helper dir', () => {
    const home = tmpHome();
    const target = tmpHome();
    writeFileSync(join(target, MARKER_FILE), 'x');
    const paths = helperPaths(home);
    mkdirSync(join(home, 'Library', 'Application Support'), { recursive: true });
    symlinkSync(target, paths.dir);
    const { deps } = makeDeps(home);
    expect(unregister({}, deps)).toBe(1);
    expect(existsSync(target)).toBe(true);
  });

  it('dry-run deletes nothing', () => {
    const home = tmpHome();
    const paths = helperPaths(home);
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.marker, 'x');
    const { deps, exec } = makeDeps(home);
    expect(unregister({ dryRun: true }, deps)).toBe(0);
    expect(exec).not.toHaveBeenCalled();
    expect(existsSync(paths.dir)).toBe(true);
  });
});

describe('main', () => {
  it('rejects unknown arguments with exit code 2', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(main(['--bogus'])).toBe(2);
    write.mockRestore();
  });

  it('routes --unregister and --dry-run', () => {
    const home = tmpHome();
    const { deps, logs } = makeDeps(home);
    expect(main(['--dry-run'], deps)).toBe(0);
    expect(logs.join('\n')).toContain('[dry-run]');
    expect(main(['--unregister'], deps)).toBe(0);
    expect(logs.join('\n')).toMatch(/Nothing to remove/);
  });
});
