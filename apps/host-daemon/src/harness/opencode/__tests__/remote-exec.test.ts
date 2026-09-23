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

describe('buildRemoteOpencodeSshArgs', () => {
  it('builds a login-shell ssh invocation for a host-only target', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'devbox' }, ['export', 'ses_abc']);
    expect(args).not.toBeNull();
    expect(args).toContain('BatchMode=yes');
    // target immediately precedes the login-shell wrapper
    const shellIdx = args!.indexOf('bash');
    expect(args![shellIdx - 1]).toBe('devbox');
    expect(args![shellIdx + 1]).toBe('-lc');
    expect(args![shellIdx + 2]).toBe(`'opencode' 'export' 'ses_abc'`);
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

  it('folds cwd into a cd prefix and single-quotes it', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['session', 'list'], { cwd: '/srv/work' });
    const cmd = args![args!.length - 1];
    expect(cmd).toBe(`cd '/srv/work' && 'opencode' 'session' 'list'`);
  });

  it('escapes single quotes in the cwd (no shell breakout)', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['export', 'ses_x'], { cwd: `/a'/b` });
    const cmd = args![args!.length - 1];
    expect(cmd).toBe(`cd '/a'\\''/b' && 'opencode' 'export' 'ses_x'`);
  });

  it('honors a custom binary path', () => {
    const args = buildRemoteOpencodeSshArgs({ host: 'h' }, ['export', 'ses_x'], { binary: '/opt/opencode' });
    expect(args![args!.length - 1]).toBe(`'/opt/opencode' 'export' 'ses_x'`);
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
