/**
 * Remote OpenCode read tests. `buildRemoteOpencodeSshArgs` is pure and covers
 * the injection-safety + quoting contract; the runner tests mock
 * `node:child_process` so no real ssh subprocess is spawned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}));

import {
  buildRemoteOpencodeSshArgs,
  listRemoteOpenCodeSessions,
  readSessionStatsOpenCodeRemote
} from '../remote-exec.js';

/** Drive the mocked execFile callback with a given error/stdout. */
function mockSsh(result: { error?: Error | null; stdout?: string }): void {
  execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, out: string) => void) => {
    cb(result.error ?? null, result.stdout ?? '');
  });
}

beforeEach(() => {
  execFileMock.mockReset();
});

/**
 * Model what actually happens on the wire: OpenSSH concatenates every trailing
 * operand (after the target) with single spaces into ONE remote command line,
 * and the remote login shell parses that line ONCE. `shSplit` reproduces that
 * single POSIX parse (single-quote runs, the `'\''` escape idiom, backslash
 * escapes) so a regression that lets `remoteCmd` split on its own spaces — the
 * exact bug this argv shape prevents — is caught here rather than only live.
 */
function shSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === ' ' || c === '\t') {
      if (started) { out.push(cur); cur = ''; started = false; }
      i++;
      continue;
    }
    started = true;
    if (c === `'`) {
      i++;
      while (i < line.length && line[i] !== `'`) { cur += line[i]; i++; }
      i++; // skip closing quote
      continue;
    }
    if (c === '\\') {
      i++;
      if (i < line.length) { cur += line[i]; i++; }
      continue;
    }
    cur += c;
    i++;
  }
  if (started) out.push(cur);
  return out;
}

/** The single remote command line ssh sends: everything after the ssh target. */
function remoteCommandLine(args: string[]): string {
  // options + target precede the invocation; the invocation is the final operand.
  return args[args.length - 1];
}

describe('shSplit (test model of the remote shell parse)', () => {
  it('collapses the `\'\\\'\'` escape idiom back to a literal quote', () => {
    expect(shSplit(`a 'b'\\''c' d`)).toEqual(['a', `b'c`, 'd']);
  });
});

describe('buildRemoteOpencodeSshArgs', () => {
  it('builds a login-shell ssh invocation for a host-only target', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'devbox' }, ['export', 'ses_abc']);
    expect(args).not.toBeNull();
    expect(args).toContain('BatchMode=yes');
    // target immediately precedes the single-operand login-shell invocation
    expect(args![args!.length - 2]).toBe('devbox');
    // after OpenSSH joins + the remote shell parses ONCE, bash -lc must receive
    // the whole opencode command as its ONE command-string operand.
    expect(shSplit(remoteCommandLine(args!))).toEqual([
      'bash',
      '-lc',
      `'opencode' 'export' 'ses_abc'`
    ]);
  });

  it('includes user and -J proxy jump', () => {
    const args = buildRemoteOpencodeSshArgs(
      { host: 'devbox', user: 'geoff', proxyJump: 'bastion' },
      ['export', 'ses_abc']
    );
    expect(args).toContain('-J');
    expect(args).toContain('bastion');
    expect(args).toContain('geoff@devbox');
  });

  it('folds cwd into a cd prefix that survives the remote parse as one operand', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['session', 'list'], { cwd: '/srv/work' });
    // The cd + && + opencode args must reach bash -lc INTACT (single operand),
    // not split into `bash -lc cd` then a stray `&& opencode …` in the login shell.
    expect(shSplit(remoteCommandLine(args!))).toEqual([
      'bash',
      '-lc',
      `cd '/srv/work' && 'opencode' 'session' 'list'`
    ]);
  });

  it('escapes single quotes in the cwd (no shell breakout)', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['export', 'ses_x'], { cwd: `/a'/b` });
    expect(shSplit(remoteCommandLine(args!))).toEqual([
      'bash',
      '-lc',
      `cd '/a'\\''/b' && 'opencode' 'export' 'ses_x'`
    ]);
  });

  it('honors a custom binary path', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['export', 'ses_x'], { binary: '/opt/opencode' });
    expect(shSplit(remoteCommandLine(args!))).toEqual([
      'bash',
      '-lc',
      `'/opt/opencode' 'export' 'ses_x'`
    ]);
  });

  it.each([
    ['missing host', { host: '' }],
    ['flag-shaped host', { host: '-oProxyCommand=x' }],
    ['flag-shaped user', { host: 'h', user: '-x' }],
    ['flag-shaped proxyJump', { host: 'h', proxyJump: '-x' }]
  ])('rejects an unsafe target: %s', (_label, target) => {
    expect(buildRemoteOpencodeSshArgs(target, ['export', 'ses_x'])).toBeNull();
  });
});

describe('readSessionStatsOpenCodeRemote', () => {
  it('rejects a malformed session id without spawning ssh', async () => {
    const stats = await readSessionStatsOpenCodeRemote({ host: 'h' }, 'not-a-session; rm -rf /');
    expect(stats).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('returns null for an unsafe target without spawning ssh', async () => {
    const stats = await readSessionStatsOpenCodeRemote({ host: '-x' }, 'ses_abc');
    expect(stats).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('returns null when ssh fails', async () => {
    mockSsh({ error: new Error('connection refused') });
    expect(await readSessionStatsOpenCodeRemote({ host: 'h' }, 'ses_abc')).toBeNull();
  });

  it('parses exported stats on success', async () => {
    const exportJson = JSON.stringify({
      info: { cost: 0.42, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 10, write: 5 } } }
    });
    mockSsh({ stdout: exportJson });
    const stats = await readSessionStatsOpenCodeRemote({ host: 'h' }, 'ses_abc', { cwd: '/w' });
    expect(stats).not.toBeNull();
    expect(stats?.costUsd).toBeCloseTo(0.42);
    expect(stats?.tokens?.input).toBe(100);
    expect(stats?.tokens?.output).toBe(50);
  });

  it('returns null on malformed export JSON', async () => {
    mockSsh({ stdout: 'not json' });
    expect(await readSessionStatsOpenCodeRemote({ host: 'h' }, 'ses_abc')).toBeNull();
  });
});

describe('listRemoteOpenCodeSessions', () => {
  it('returns parsed rows on success', async () => {
    const rows = [{ id: 'ses_a', created: 1000, directory: '/w' }];
    mockSsh({ stdout: JSON.stringify(rows) });
    expect(await listRemoteOpenCodeSessions({ host: 'h' }, '/w', 5)).toEqual(rows);
  });

  it('returns null for a non-array payload', async () => {
    mockSsh({ stdout: JSON.stringify({ not: 'an array' }) });
    expect(await listRemoteOpenCodeSessions({ host: 'h' }, '/w', 5)).toBeNull();
  });

  it('returns null on ssh failure', async () => {
    mockSsh({ error: new Error('timeout') });
    expect(await listRemoteOpenCodeSessions({ host: 'h' }, '/w', 5)).toBeNull();
  });

  it('returns null for an unsafe target', async () => {
    expect(await listRemoteOpenCodeSessions({ host: '-x' }, '/w', 5)).toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
