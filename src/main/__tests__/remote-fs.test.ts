import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod, readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confineRemote,
  remoteRoot,
  listDirRemote,
  readFileRemote,
  writeFileRemote,
  createFileRemote,
  createDirRemote,
  renameRemote,
  deleteRemote,
  execRemote,
  resolveAndExecRemote,
  sshBaseArgs,
  type RemoteExecResolveDeps
} from '../remote-fs.js';
import type { ProjectRemote, RemoteExecResult, RemoteRootResult } from '../../shared/types.js';

describe('confineRemote', () => {
  const root = '/home/sfwork/project';

  it('accepts the root itself', () => {
    expect(confineRemote(root, root)).toBe(root);
  });

  it('accepts a descendant absolute path', () => {
    expect(confineRemote(root, '/home/sfwork/project/src/index.ts')).toBe(
      '/home/sfwork/project/src/index.ts'
    );
  });

  it('resolves a relative path against the root', () => {
    expect(confineRemote(root, 'src/index.ts')).toBe('/home/sfwork/project/src/index.ts');
  });

  it('normalizes redundant separators and dot segments', () => {
    expect(confineRemote(root, '/home/sfwork/project/./src//app.ts')).toBe(
      '/home/sfwork/project/src/app.ts'
    );
  });

  it('strips a trailing slash', () => {
    expect(confineRemote(root, '/home/sfwork/project/src/')).toBe('/home/sfwork/project/src');
  });

  it('rejects a parent escape via ..', () => {
    expect(confineRemote(root, '/home/sfwork/project/../secrets')).toBeNull();
  });

  it('rejects a relative .. escape', () => {
    expect(confineRemote(root, '../../etc/passwd')).toBeNull();
  });

  it('rejects an absolute path outside the root', () => {
    expect(confineRemote(root, '/etc/passwd')).toBeNull();
  });

  it('rejects a sibling that shares the root prefix string', () => {
    // "/home/sfwork/project-evil" starts with the root STRING but is not a
    // descendant — the trailing-separator check must catch this.
    expect(confineRemote(root, '/home/sfwork/project-evil/x')).toBeNull();
  });

  it('rejects a path that .. back to exactly the prefix sibling', () => {
    expect(confineRemote(root, '/home/sfwork/project/../project-evil')).toBeNull();
  });
});

describe('sshBaseArgs', () => {
  it('omits -J when no proxyJump is set', () => {
    const args = sshBaseArgs({ host: 'devbox' });
    expect(args).not.toContain('-J');
    expect(args.at(-1)).toBe('devbox');
  });

  it('threads -J <spec> before the target when proxyJump is set', () => {
    const args = sshBaseArgs({ host: 'devbox', user: 'sfwork', proxyJump: 'jump@bastion' });
    const j = args.indexOf('-J');
    expect(j).toBeGreaterThanOrEqual(0);
    expect(args[j + 1]).toBe('jump@bastion');
    // Jump opt precedes the target (last element).
    expect(j).toBeLessThan(args.length - 1);
    expect(args.at(-1)).toBe('sfwork@devbox');
  });

  it('rejects a flag-shaped proxyJump', () => {
    expect(() => sshBaseArgs({ host: 'devbox', proxyJump: '-oProxyCommand=evil' })).toThrow(
      /proxyJump/
    );
  });

  it('sets a ConnectTimeout generous enough for a cold, proxied dev box', () => {
    const args = sshBaseArgs({ host: 'devbox' });
    const i = args.indexOf('ConnectTimeout=25');
    // Present, and delivered as the value half of a `-o <opt>` pair.
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i - 1]).toBe('-o');
    // Well above the old 8s that timed out during banner exchange on cold boxes.
    expect(args).not.toContain('ConnectTimeout=8');
  });
});

// End-to-end coverage of the actual remote commands. We put a fake `ssh` on
// PATH that ignores its -o options + target and runs the final argument (the
// remote command string) locally via `sh -c`, passing stdin through. This
// exercises the REAL portable shell commands (the POSIX listing loop, the
// temp+mv write, create/rename/delete) against a real filesystem — so a command
// that relied on a GNU-only flag, or mis-quoted a path, fails here.
describe('remote-fs over a fake ssh', () => {
  let binDir: string;
  let workDir: string;
  let prevPath: string | undefined;
  // host is unused by the fake ssh but must be non-dash for sshBaseArgs.
  const remote: ProjectRemote = { host: 'fake-host' };

  beforeEach(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'remote-fs-bin-'));
    workDir = await mkdtemp(join(tmpdir(), 'remote-fs-work-'));
    // The remote command is the LAST argv element; everything before it is ssh
    // options + target, which we discard. `exec sh -c "$cmd"` so stdin (the
    // write payload) flows into the command unchanged.
    const fakeSsh = join(binDir, 'ssh');
    await writeFile(
      fakeSsh,
      ['#!/bin/sh', 'eval "cmd=\\${$#}"', 'exec sh -c "$cmd"', ''].join('\n'),
      'utf8'
    );
    await chmod(fakeSsh, 0o755);
    prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
  });

  afterEach(async () => {
    if (prevPath !== undefined) process.env.PATH = prevPath;
    await rm(binDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  it('resolves the remote root via pwd -P (symlink-resolved)', async () => {
    const res = await remoteRoot({ host: 'fake-host', remotePath: workDir });
    expect(res.ok).toBe(true);
    // `pwd -P` resolves symlinks (e.g. macOS /var → /private/var), which is the
    // point — the root anchor is the physical path.
    expect(res.root).toBe(await realpath(workDir));
  });

  it('falls back to the global default path when the project has none', async () => {
    // No per-project remotePath → the global default (arg 2) is the start dir.
    const res = await remoteRoot({ host: 'fake-host' }, workDir);
    expect(res.ok).toBe(true);
    expect(res.root).toBe(await realpath(workDir));
  });

  it('per-project remotePath wins over the global default', async () => {
    // remotePath set AND a (bogus) default supplied: the project path must win,
    // so resolution succeeds against workDir and never touches the default.
    const res = await remoteRoot(
      { host: 'fake-host', remotePath: workDir },
      '/nonexistent/default/path'
    );
    expect(res.ok).toBe(true);
    expect(res.root).toBe(await realpath(workDir));
  });

  it('lists files and dirs, sorted dirs-first, skipping denied + dotfiles kept', async () => {
    await writeFile(join(workDir, 'b.txt'), 'x');
    await writeFile(join(workDir, 'a.txt'), 'y');
    await mkdir(join(workDir, 'src'));
    await mkdir(join(workDir, 'node_modules')); // denied
    await writeFile(join(workDir, '.hidden'), 'z');
    const entries = await listDirRemote(remote, workDir, workDir);
    expect(entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:src',
      'file:.hidden',
      'file:a.txt',
      'file:b.txt'
    ]);
    expect(entries.find((e) => e.name === 'node_modules')).toBeUndefined();
  });

  it('handles a filename with spaces', async () => {
    await writeFile(join(workDir, 'my file.md'), 'hi');
    const entries = await listDirRemote(remote, workDir, workDir);
    expect(entries.map((e) => e.name)).toContain('my file.md');
  });

  it('returns [] for a directory outside the root (confinement)', async () => {
    const entries = await listDirRemote(remote, workDir, '/etc');
    expect(entries).toEqual([]);
  });

  it('reads a text file with byte count', async () => {
    await writeFile(join(workDir, 'hello.txt'), 'hello world');
    const res = await readFileRemote(remote, workDir, join(workDir, 'hello.txt'));
    expect(res.ok).toBe(true);
    expect(res.content).toBe('hello world');
    expect(res.bytes).toBe(11);
    expect(res.binary).toBe(false);
  });

  it('flags a binary file (NUL byte) without returning content', async () => {
    await writeFile(join(workDir, 'bin'), Buffer.from([0x41, 0x00, 0x42]));
    const res = await readFileRemote(remote, workDir, join(workDir, 'bin'));
    expect(res.ok).toBe(true);
    expect(res.binary).toBe(true);
    expect(res.content).toBeUndefined();
  });

  it('refuses to read a directory as a file', async () => {
    await mkdir(join(workDir, 'adir'));
    const res = await readFileRemote(remote, workDir, join(workDir, 'adir'));
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Not a file');
  });

  it('writes to an existing file (temp + atomic mv)', async () => {
    const f = join(workDir, 'edit.txt');
    await writeFile(f, 'old');
    const res = await writeFileRemote(remote, workDir, f, 'new content');
    expect(res.ok).toBe(true);
    expect(res.bytes).toBe(11);
    expect(await readFile(f, 'utf8')).toBe('new content');
    // No temp file left behind.
    const leftovers = (await listDirRemote(remote, workDir, workDir)).map((e) => e.name);
    expect(leftovers.some((n) => n.includes('zcc-tmp'))).toBe(false);
  });

  it('refuses to write a path that is not a regular file', async () => {
    await mkdir(join(workDir, 'd'));
    const res = await writeFileRemote(remote, workDir, join(workDir, 'd'), 'x');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Not a regular file');
  });

  it('creates an empty file, refusing to overwrite', async () => {
    const f = join(workDir, 'sub', 'new.txt'); // parent created via mkdir -p
    const res = await createFileRemote(remote, workDir, f);
    expect(res.ok).toBe(true);
    expect(existsSync(f)).toBe(true);
    const again = await createFileRemote(remote, workDir, f);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already exists/);
  });

  it('creates a directory, refusing to overwrite', async () => {
    const d = join(workDir, 'newdir');
    expect((await createDirRemote(remote, workDir, d)).ok).toBe(true);
    expect(existsSync(d)).toBe(true);
    expect((await createDirRemote(remote, workDir, d)).ok).toBe(false);
  });

  it('renames a file, refusing to clobber and reporting a missing source', async () => {
    const from = join(workDir, 'a.txt');
    const to = join(workDir, 'moved', 'b.txt');
    await writeFile(from, 'data');
    const res = await renameRemote(remote, workDir, from, to);
    expect(res.ok).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(await readFile(to, 'utf8')).toBe('data');
    // Missing source now.
    const missing = await renameRemote(remote, workDir, from, join(workDir, 'c.txt'));
    expect(missing.ok).toBe(false);
    expect(missing.message).toMatch(/no longer exists/);
    // Clobber guard.
    await writeFile(join(workDir, 'existing'), '1');
    await writeFile(join(workDir, 'src2'), '2');
    const clobber = await renameRemote(remote, workDir, join(workDir, 'src2'), join(workDir, 'existing'));
    expect(clobber.ok).toBe(false);
    expect(clobber.message).toMatch(/already exists/);
  });

  it('deletes a file and a directory recursively', async () => {
    const f = join(workDir, 'gone.txt');
    await writeFile(f, 'x');
    expect((await deleteRemote(remote, workDir, f)).ok).toBe(true);
    expect(existsSync(f)).toBe(false);
    const d = join(workDir, 'tree');
    await mkdir(join(d, 'nested'), { recursive: true });
    await writeFile(join(d, 'nested', 'leaf'), 'y');
    expect((await deleteRemote(remote, workDir, d)).ok).toBe(true);
    expect(existsSync(d)).toBe(false);
  });

  it('refuses to delete the project root', async () => {
    const res = await deleteRemote(remote, workDir, workDir);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/project root/);
    expect(existsSync(workDir)).toBe(true);
  });

  it('confines a mutation: a path outside the root is rejected before ssh', async () => {
    const res = await deleteRemote(remote, workDir, '/etc/hosts');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });

  it('execRemote runs a command in the project root and captures stdout + exit 0', async () => {
    await writeFile(join(workDir, 'a.txt'), 'x');
    await writeFile(join(workDir, 'b.txt'), 'y');
    const res = await execRemote(remote, workDir, 'ls');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('a.txt');
    expect(res.stdout).toContain('b.txt');
    expect(res.truncated).toBe(false);
  });

  it('execRemote honors shell operators (pipe) and runs in the confined root', async () => {
    // The pipe proves the command string reached a real shell (not exec'd as
    // argv). A marker file `ls`'d back through the pipe proves it started in the
    // project root. (We avoid asserting `pwd` verbatim: production passes an
    // already realpath'd root, but this test passes the raw temp path, which may
    // be a symlink — /var → /private/var on macOS.)
    await writeFile(join(workDir, 'marker.txt'), 'm');
    const res = await execRemote(remote, workDir, 'ls | grep marker');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout?.trim()).toBe('marker.txt');
  });

  it('execRemote returns a non-zero exit as data, not an error', async () => {
    const res = await execRemote(remote, workDir, 'echo oops >&2; exit 3');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(3);
    expect(res.stderr).toContain('oops');
  });

  it('execRemote runs in a confined cwd subpath', async () => {
    await mkdir(join(workDir, 'sub'));
    await writeFile(join(workDir, 'sub', 'inner.txt'), 'z');
    const res = await execRemote(remote, workDir, 'ls', { cwd: join(workDir, 'sub') });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain('inner.txt');
  });

  it('execRemote rejects a cwd outside the project before ssh', async () => {
    const res = await execRemote(remote, workDir, 'ls', { cwd: '/etc' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });

  it('execRemote rejects an empty command', async () => {
    const res = await execRemote(remote, workDir, '   ');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/[Ee]mpty/);
  });

  it('execRemote rejects a command containing a NUL byte', async () => {
    const res = await execRemote(remote, workDir, 'echo hi\0; rm -rf /');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/NUL/);
  });

  it('execRemote reports a vanished cwd as exit 127 (not a leaked command)', async () => {
    // cwd is confined (under root) but does not exist on the remote — the cd
    // guard must fire and the command after it must NOT run.
    const gone = join(workDir, 'deleted-subdir');
    const res = await execRemote(remote, workDir, 'echo SHOULD_NOT_PRINT', { cwd: gone });
    expect(res.ok).toBe(true);
    expect(res.code).toBe(127);
    expect(res.stderr).toMatch(/working directory not found/);
    expect(res.stdout).not.toContain('SHOULD_NOT_PRINT');
  });

  it('execRemote clips an oversized stdout stream and flags truncated', async () => {
    // Emit > 1 MB on stdout; the stream cap must clip it and set truncated.
    const res = await execRemote(remote, workDir, 'head -c 1500000 /dev/zero | tr "\\0" "x"');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.stdout ?? '', 'utf8')).toBeLessThanOrEqual(1024 * 1024);
  });

  it('execRemote honors a preserved multiline command (newlines are fine)', async () => {
    const res = await execRemote(remote, workDir, 'echo line1\necho line2');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('line1');
    expect(res.stdout).toContain('line2');
  });
});

// The resolution + gating chain that index.ts wires behind the MCP tool. This is
// the trust boundary (CLAUDE.md #1): a projectId is resolved to a store-authorized
// ProjectRemote here; a non-remote / unknown id must never reach ssh. Tested with
// fully mocked deps so the gating is verified in isolation.
describe('resolveAndExecRemote (gating, mocked deps)', () => {
  const REMOTE: ProjectRemote = { host: 'fake-host', remotePath: '/home/sfwork/core' };
  const okRoot: RemoteRootResult = { ok: true, root: '/home/sfwork/core' };
  const okExec: RemoteExecResult = { ok: true, code: 0, stdout: 'hi', stderr: '', truncated: false };

  function deps(over: Partial<RemoteExecResolveDeps> = {}): RemoteExecResolveDeps {
    return {
      findRemote: () => REMOTE,
      defaultPath: '/home/sfwork/core',
      resolveRoot: async () => okRoot,
      exec: async () => okExec,
      ...over
    };
  }

  it('rejects an unknown / non-remote projectId BEFORE resolving a root or ssh', async () => {
    const resolveRoot = vi.fn(async () => okRoot);
    const exec = vi.fn(async () => okExec);
    const res = await resolveAndExecRemote(
      deps({ findRemote: () => null, resolveRoot, exec }),
      'local-or-unknown',
      'ls'
    );
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Not a remote project');
    // Crucially: neither the root-resolve nor the exec was reached.
    expect(resolveRoot).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  it('surfaces a root-resolution failure (unreachable host) without running the command', async () => {
    const exec = vi.fn(async () => okExec);
    const res = await resolveAndExecRemote(
      deps({ resolveRoot: async () => ({ ok: false, message: 'Remote host timed out' }), exec }),
      'prj',
      'ls'
    );
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Remote host timed out');
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when root-resolve fails without one', async () => {
    const res = await resolveAndExecRemote(
      deps({ resolveRoot: async () => ({ ok: false } as RemoteRootResult) }),
      'prj',
      'ls'
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/unreachable|start path/i);
  });

  it('passes the store-resolved remote + realpath root + opts through to exec', async () => {
    const exec = vi.fn(async () => okExec);
    const res = await resolveAndExecRemote(
      deps({ exec }),
      'prj',
      'git status',
      { cwd: '/home/sfwork/core/services', timeoutMs: 5000 }
    );
    expect(res).toEqual(okExec);
    expect(exec).toHaveBeenCalledWith(REMOTE, '/home/sfwork/core', 'git status', {
      cwd: '/home/sfwork/core/services',
      timeoutMs: 5000
    });
  });

  it('resolves the root with the injected default path', async () => {
    const resolveRoot = vi.fn(async () => okRoot);
    await resolveAndExecRemote(deps({ resolveRoot, defaultPath: '/opt/fallback' }), 'prj', 'ls');
    expect(resolveRoot).toHaveBeenCalledWith(REMOTE, '/opt/fallback');
  });
});

// End-to-end over the fake ssh: the SAME resolveAndExecRemote chain, but with the
// REAL remoteRoot + execRemote as deps, proving the full path (store hit →
// realpath root via `pwd -P` → confined `cd` → command) works against a real
// filesystem, not just mocks.
describe('resolveAndExecRemote (end-to-end over fake ssh)', () => {
  let binDir: string;
  let workDir: string;
  let prevPath: string | undefined;

  beforeEach(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'remote-fs-bin-'));
    workDir = await mkdtemp(join(tmpdir(), 'remote-fs-work-'));
    const fakeSsh = join(binDir, 'ssh');
    await writeFile(
      fakeSsh,
      ['#!/bin/sh', 'eval "cmd=\\${$#}"', 'exec sh -c "$cmd"', ''].join('\n'),
      'utf8'
    );
    await chmod(fakeSsh, 0o755);
    prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
  });

  afterEach(async () => {
    if (prevPath !== undefined) process.env.PATH = prevPath;
    await rm(binDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  function realDeps(remotePathOverride?: string): RemoteExecResolveDeps {
    return {
      findRemote: () => ({ host: 'fake-host', remotePath: remotePathOverride ?? workDir }),
      resolveRoot: remoteRoot,
      exec: execRemote
    };
  }

  it('runs a command end-to-end and captures stdout + exit 0', async () => {
    await writeFile(join(workDir, 'in-root.txt'), 'x');
    const res = await resolveAndExecRemote(realDeps(), 'prj', 'ls | grep in-root');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.stdout?.trim()).toBe('in-root.txt');
  });

  it('resolves the root via pwd -P then confines a cwd subpath under it', async () => {
    await mkdir(join(workDir, 'services'));
    await writeFile(join(workDir, 'services', 'app.ts'), 'z');
    // cwd is expressed relative to the REALPATH'd root, which is what execRemote confines against.
    const root = await realpath(workDir);
    const res = await resolveAndExecRemote(realDeps(), 'prj', 'ls', { cwd: `${root}/services` });
    expect(res.ok).toBe(true);
    expect(res.stdout).toContain('app.ts');
  });

  it('a cwd outside the resolved root is rejected (never reaches ssh)', async () => {
    const res = await resolveAndExecRemote(realDeps(), 'prj', 'ls', { cwd: '/etc' });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });

  it('an unreachable remote root surfaces cleanly (bad start path)', async () => {
    // remotePath points nowhere → `cd … 2>/dev/null && pwd -P` exits non-zero, so
    // remoteRoot resolves ok:false. The command must NOT run (no root anchor), and
    // the whole chain still resolves a clean ok:false rather than throwing.
    const res = await resolveAndExecRemote(realDeps('/nonexistent/deep/path'), 'prj', 'echo ranyway');
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
    expect(res.stdout).toBeUndefined();
  });
});
