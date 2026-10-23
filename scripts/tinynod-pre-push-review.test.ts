import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireReviewLock,
  checkTinynodVersion,
  classifyReview,
  createReviewTree,
  deriveReviewBase,
  deriveReviewTarget,
  finishReview,
  installAbortCleanup,
  ledgerEntryFor,
  readGitEnablement,
  recordAndPruneHistory,
  resolveEnablement,
  startReview,
  withRepoIdentityEnv,
} from './tinynod-pre-push-review.mjs';

const ZERO = '0'.repeat(40);
const OID = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

const temps: string[] = [];
const tempDir = (prefix = 'tn-test-') => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('resolveEnablement', () => {
  it.each(['1', 'true', 'TRUE'])('bypass token %s beats every other source', (token) => {
    expect(resolveEnablement({ env: { TINYNOD_SKIP_HOOK: token, ZANA_TINYNOD_REVIEW: '1' }, readConfig: () => 'true' })).toEqual({ enabled: false, source: 'TINYNOD_SKIP_HOOK' });
  });

  it('ignores a bypass value that is not a bypass token', () => {
    expect(resolveEnablement({ env: { TINYNOD_SKIP_HOOK: '0', ZANA_TINYNOD_REVIEW: '1' } })).toMatchObject({ enabled: true });
  });

  it('prefers the environment switch over git config', () => {
    expect(resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: '0' }, readConfig: () => 'true' })).toMatchObject({ enabled: false, source: 'ZANA_TINYNOD_REVIEW' });
    expect(resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: 'true' }, readConfig: () => 'false' })).toMatchObject({ enabled: true });
    expect(resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: 'false' } })).toMatchObject({ enabled: false });
  });

  it('treats a blank environment switch as unset and reads git config only when needed', () => {
    for (const blank of ['', '   ']) {
      expect(resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: blank }, readConfig: () => 'true' })).toMatchObject({ enabled: true, source: 'git config zana.tinynod.enabled' });
    }
    const readConfig = vi.fn(() => 'true');
    resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: '0' }, readConfig });
    expect(readConfig).not.toHaveBeenCalled();
    expect(resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: 'maybe' }, readConfig: () => 'true' })).toMatchObject({ enabled: false, warning: expect.stringContaining('maybe') });
  });

  it('falls back to git config, then off', () => {
    expect(resolveEnablement({ env: {}, readConfig: () => 'yes' })).toMatchObject({ enabled: true, source: 'git config zana.tinynod.enabled' });
    expect(resolveEnablement({ env: {}, readConfig: () => 'off' })).toMatchObject({ enabled: false });
    expect(resolveEnablement({ env: {} })).toEqual({ enabled: false, source: 'default' });
    expect(resolveEnablement()).toMatchObject({ enabled: expect.any(Boolean) });
  });

  it('turns the review off with a warning on an invalid value', () => {
    const fromEnv = resolveEnablement({ env: { ZANA_TINYNOD_REVIEW: 'maybe' }, readConfig: () => 'true' });
    expect(fromEnv).toMatchObject({ enabled: false });
    expect(fromEnv.warning).toContain('"maybe"');
    const fromGit = resolveEnablement({ env: {}, readConfig: () => 'sometimes' });
    expect(fromGit).toMatchObject({ enabled: false });
    expect(fromGit.warning).toContain('zana.tinynod.enabled');
  });

  it('reads git config from the developer root without inherited repository routing', () => {
    const run = vi.fn().mockReturnValue({ status: 0, stdout: 'true\n' });
    expect(readGitEnablement('/root', { run, env: { GIT_DIR: '/elsewhere', KEEP: '1' } })).toBe('true');
    const [command, args, options] = run.mock.calls[0];
    expect(command).toBe('git');
    expect(args).toEqual(['config', '--get', 'zana.tinynod.enabled']);
    expect(options.cwd).toBe('/root');
    expect(options.env).toEqual({ KEEP: '1' });
    expect(readGitEnablement('/root', { run: () => ({ status: 1, stdout: '' }) })).toBeNull();
    expect(readGitEnablement('/root', { run: () => undefined })).toBeNull();
  });
});

describe('deriveReviewBase', () => {
  const checks = (overrides = {}) => ({ hasObject: () => true, mergeBase: () => OTHER, isAncestor: () => true, ...overrides });
  const tuple = { localRef: 'refs/heads/f', localOid: OID, remoteRef: 'refs/heads/f', remoteOid: BASE };

  it('uses the remote tip when it is an ancestor of the pushed commit', () => {
    expect(deriveReviewBase(tuple, checks())).toEqual({ base: BASE });
  });
  it('uses the merge base for a new branch', () => {
    expect(deriveReviewBase({ ...tuple, remoteOid: ZERO }, checks())).toEqual({ base: OTHER });
  });
  it('uses the merge base when the remote tip is unavailable locally', () => {
    expect(deriveReviewBase(tuple, checks({ hasObject: (object: string) => object === 'origin/main' }))).toEqual({ base: OTHER });
  });
  it('uses the merge base after a non-fast-forward update', () => {
    expect(deriveReviewBase(tuple, checks({ isAncestor: () => false }))).toEqual({ base: OTHER });
  });
  it('skips without a local origin/main', () => {
    expect(deriveReviewBase({ ...tuple, remoteOid: ZERO }, checks({ hasObject: () => false }))).toEqual({ skip: expect.stringContaining('origin/main') });
  });
  it('skips when no merge base exists', () => {
    expect(deriveReviewBase({ ...tuple, remoteOid: ZERO }, checks({ mergeBase: () => null }))).toEqual({ skip: expect.stringContaining('merge base') });
  });
});

describe('deriveReviewTarget', () => {
  const checks = (overrides = {}) => ({ remoteVerified: true, hasObject: () => true, mergeBase: () => OTHER, isAncestor: () => true, ...overrides });
  const tuple = (overrides = {}) => ({ localRef: 'refs/heads/f', localOid: OID, remoteRef: 'refs/heads/f', remoteOid: BASE, ...overrides });

  it('returns the exact pushed oid and base', () => {
    expect(deriveReviewTarget([tuple()], checks())).toEqual({ oid: OID, base: BASE });
  });
  it('ignores deletions next to a real push', () => {
    expect(deriveReviewTarget([tuple({ localOid: ZERO }), tuple()], checks())).toEqual({ oid: OID, base: BASE });
  });
  it('skips malformed or empty tuples', () => {
    expect(deriveReviewTarget(null, checks())).toEqual({ skip: expect.stringContaining('malformed') });
    expect(deriveReviewTarget([], checks())).toEqual({ skip: expect.stringContaining('malformed') });
  });
  it('skips an unverified remote', () => {
    expect(deriveReviewTarget([tuple()], checks({ remoteVerified: false }))).toEqual({ skip: expect.stringContaining('not verified') });
  });
  it.each(['refs/heads/main', 'refs/tags/v1', 'refs/heads/release/1.0'])('skips protected ref %s', (remoteRef) => {
    expect(deriveReviewTarget([tuple({ remoteRef })], checks())).toEqual({ skip: `protected ref ${remoteRef}` });
  });
  it('skips deletion-only pushes', () => {
    expect(deriveReviewTarget([tuple({ localOid: ZERO })], checks())).toEqual({ skip: 'ref deletion only' });
  });
  it('skips when no base can be derived', () => {
    expect(deriveReviewTarget([tuple({ remoteOid: ZERO })], checks({ mergeBase: () => null }))).toEqual({ skip: expect.stringContaining('merge base') });
  });
  it('skips multiple pushed commits', () => {
    expect(deriveReviewTarget([tuple(), tuple({ localOid: OTHER, remoteRef: 'refs/heads/g' })], checks())).toEqual({ skip: 'multiple distinct pushed commits' });
  });
  it('skips multiple review bases for one commit', () => {
    const bases = [BASE, OTHER];
    expect(deriveReviewTarget([tuple({ remoteOid: bases[0] }), tuple({ remoteOid: bases[1], remoteRef: 'refs/heads/g' })], checks())).toEqual({ skip: 'multiple review bases' });
  });
});

describe('acquireReviewLock', () => {
  const lockPath = (dir: string) => join(dir, 'zana-tinynod-review.lock');
  const ownerOf = (dir: string) => JSON.parse(readFileSync(join(lockPath(dir), 'owner.json'), 'utf8'));

  it('is exclusive and releasable', () => {
    const dir = tempDir();
    const lock = acquireReviewLock(dir);
    expect(lock?.path).toBe(lockPath(dir));
    expect(lock?.owns()).toBe(true);
    expect(acquireReviewLock(dir)).toBeNull();
    lock?.release();
    expect(existsSync(lockPath(dir))).toBe(false);
    expect(acquireReviewLock(dir)).not.toBeNull();
  });

  it('records pid, host, and a random token, and leaves no drafts behind', () => {
    const dir = tempDir();
    const lock = acquireReviewLock(dir, { pid: 4242, host: 'box' });
    expect(ownerOf(dir)).toEqual({ pid: 4242, host: 'box', token: lock?.token });
    expect(nodeFs.readdirSync(dir)).toEqual(['zana-tinynod-review.lock']);
  });

  it('keeps its path under the git common directory whatever snapshot cache settings say', () => {
    vi.stubEnv('ZANA_PREPUSH_FRESH_SNAPSHOT', '1');
    vi.stubEnv('ZANA_PREPUSH_CACHE_DIR', join(tempDir(), 'cache'));
    const dir = tempDir();
    expect(acquireReviewLock(dir)?.path).toBe(lockPath(dir));
    vi.unstubAllEnvs();
  });

  it('reclaims a lock whose owner process is gone', () => {
    const dir = tempDir();
    acquireReviewLock(dir, { pid: 1, host: 'box' });
    const taken = acquireReviewLock(dir, { pid: 2, host: 'box', alive: () => false });
    expect(taken).not.toBeNull();
    expect(ownerOf(dir).pid).toBe(2);
  });

  it('respects a lock whose owner is alive', () => {
    const dir = tempDir();
    acquireReviewLock(dir, { pid: 1, host: 'box' });
    expect(acquireReviewLock(dir, { pid: 2, host: 'box', alive: () => true })).toBeNull();
    expect(ownerOf(dir).pid).toBe(1);
  });

  it('expires another host\'s lock only by age', () => {
    const dir = tempDir();
    acquireReviewLock(dir, { pid: 1, host: 'other' });
    expect(acquireReviewLock(dir, { pid: 2, host: 'box', alive: () => false })).toBeNull();
    const now = () => Date.now() + 25 * 60 * 60_000;
    expect(acquireReviewLock(dir, { pid: 2, host: 'box', alive: () => false, now })).not.toBeNull();
  });

  it('reclaims an unreadable owner record only after the abandonment age', () => {
    const dir = tempDir();
    mkdirSync(lockPath(dir));
    writeFileSync(join(lockPath(dir), 'owner.json'), '{garbled');
    expect(acquireReviewLock(dir)).toBeNull();
    const old = new Date(Date.now() - 120_000);
    utimesSync(lockPath(dir), old, old);
    expect(acquireReviewLock(dir)).not.toBeNull();
  });

  it('puts back a lock a concurrent process published during reclaim', () => {
    const dir = tempDir();
    acquireReviewLock(dir, { pid: 1, host: 'box' });
    const realRead = nodeFs.readFileSync;
    let reads = 0;
    // The first read sees the abandoned owner; the aside copy then holds a different token.
    const fs = {
      ...nodeFs,
      readFileSync: ((path: string, ...rest: unknown[]) => {
        reads += 1;
        if (String(path).includes('.stale')) return JSON.stringify({ pid: 9, host: 'box', token: 'someone-else' });
        return (realRead as (...args: unknown[]) => unknown)(path, ...rest);
      }) as typeof nodeFs.readFileSync,
    };
    expect(acquireReviewLock(dir, { fs, host: 'box', alive: () => false })).toBeNull();
    expect(reads).toBeGreaterThan(0);
    expect(existsSync(lockPath(dir))).toBe(true);
    expect(nodeFs.readdirSync(dir)).toEqual(['zana-tinynod-review.lock']);
  });

  it('does not release a lock another process now owns', () => {
    const dir = tempDir();
    const lock = acquireReviewLock(dir);
    writeFileSync(join(lockPath(dir), 'owner.json'), JSON.stringify({ pid: 1, host: 'x', token: 'new-owner' }));
    expect(lock?.owns()).toBe(false);
    lock?.release();
    expect(existsSync(lockPath(dir))).toBe(true);
  });

  it('surfaces unexpected filesystem errors', () => {
    expect(() => acquireReviewLock(join(tempDir(), 'missing'))).toThrow();
    const fs = { ...nodeFs, renameSync: () => { throw Object.assign(new Error('boom'), { code: 'EIO' }); } };
    expect(() => acquireReviewLock(tempDir(), { fs })).toThrow('boom');
  });

  it('release never throws', () => {
    const dir = tempDir();
    const fs = { ...nodeFs, rmSync: ((path: string, options?: nodeFs.RmOptions) => { if (String(path).endsWith('.lock')) throw new Error('busy'); return nodeFs.rmSync(path, options); }) as typeof nodeFs.rmSync };
    const lock = acquireReviewLock(dir, { fs });
    expect(() => lock?.release()).not.toThrow();
  });
});

describe('installAbortCleanup', () => {
  const setup = () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const kill = vi.fn();
    const dir = tempDir();
    const file = join(dir, 'capture');
    writeFileSync(file, 'x');
    const lock = { release: vi.fn() };
    const cleanup = installAbortCleanup({ proc: proc as unknown as NodeJS.Process, kill });
    cleanup.setChild({ pid: 77 });
    cleanup.track(file);
    cleanup.setLock(lock);
    return { proc, kill, file, lock, cleanup };
  };

  it.each([['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]])('%s kills the group, deletes files, releases the lock, and exits', (signal, code) => {
    const { proc, kill, file, lock } = setup();
    proc.emit(signal);
    expect(kill).toHaveBeenCalledWith(-77, 'SIGKILL');
    expect(existsSync(file)).toBe(false);
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(code);
  });

  it('cleans up once when several triggers fire', () => {
    const { proc, kill, lock } = setup();
    proc.emit('SIGINT');
    proc.emit('exit');
    proc.emit('SIGTERM');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('cleans up on plain exit without calling exit again', () => {
    const { proc, kill, lock } = setup();
    proc.emit('exit');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(proc.exit).not.toHaveBeenCalled();
  });

  it('dispose removes every handler and disarms cleanup', () => {
    const { proc, kill, lock, cleanup } = setup();
    cleanup.dispose();
    for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) expect(proc.listenerCount(event)).toBe(0);
    cleanup.cleanup();
    expect(kill).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('untracked files are left alone and a gone group does not throw', () => {
    const { proc, file, cleanup, kill } = setup();
    cleanup.untrack(file);
    kill.mockImplementation(() => { throw new Error('ESRCH'); });
    expect(() => proc.emit('exit')).not.toThrow();
    expect(existsSync(file)).toBe(true);
  });

  it('works with no child, files, or lock', () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const kill = vi.fn();
    const cleanup = installAbortCleanup({ proc: proc as unknown as NodeJS.Process, kill });
    expect(() => cleanup.cleanup()).not.toThrow();
    expect(kill).not.toHaveBeenCalled();
  });

  it('falls back to the pid when the group cannot be signalled', () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    const kill = vi.fn((pid: number) => { if (pid < 0) throw new Error('EPERM'); });
    const cleanup = installAbortCleanup({ proc: proc as unknown as NodeJS.Process, kill });
    cleanup.setChild({ pid: 5 });
    cleanup.cleanup();
    expect(kill).toHaveBeenCalledWith(5, 'SIGKILL');
  });
});

describe('withRepoIdentityEnv', () => {
  it('quiets logging, drops the log file and git routing, and passes the model through', () => {
    const env = withRepoIdentityEnv({ LOG_LEVEL: 'debug', LOG_FILE: '/x', TINYNOD_MODEL: 'm', GIT_DIR: '/g', GIT_WORK_TREE: '/w', PATH: '/bin' });
    expect(env).toMatchObject({ LOG_LEVEL: 'warn', TINYNOD_MODEL: 'm', PATH: '/bin', GIT_CONFIG_COUNT: '0' });
    expect(env).not.toHaveProperty('LOG_FILE');
    expect(env).not.toHaveProperty('GIT_DIR');
    expect(env).not.toHaveProperty('GIT_WORK_TREE');
  });

  it('appends insteadOf rewrites for GitHub aliases after existing config pairs', () => {
    const env = withRepoIdentityEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }, { 'github.com-work-public': 'github.com', other: 'example.com', 'github.com': 'github.com' });
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'a.b',
      GIT_CONFIG_VALUE_0: 'c',
      GIT_CONFIG_KEY_1: 'url.git@github.com:.insteadOf',
      GIT_CONFIG_VALUE_1: 'git@github.com-work-public:',
      GIT_CONFIG_KEY_2: 'url.ssh://git@github.com/.insteadOf',
      GIT_CONFIG_VALUE_2: 'ssh://git@github.com-work-public/',
    });
  });

  it('rewrites the snapshot origin to the developer remote after existing pairs', () => {
    const env = withRepoIdentityEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' }, {}, { developerOrigin: 'git@github.com:salesforce/zana.git', slotOrigin: '/dev/checkout' });
    expect(env).toMatchObject({ GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_1: 'url.git@github.com:salesforce/zana.git.insteadOf', GIT_CONFIG_VALUE_1: '/dev/checkout' });
  });
  it('adds no rewrite when an origin is missing or identical', () => {
    expect(withRepoIdentityEnv({}, {}, { developerOrigin: 'x' }).GIT_CONFIG_COUNT).toBe('0');
    expect(withRepoIdentityEnv({}, {}, { developerOrigin: 'x', slotOrigin: 'x' }).GIT_CONFIG_COUNT).toBe('0');
  });

  it('tolerates a malformed config count and defaults to process.env', () => {
    expect(withRepoIdentityEnv({ GIT_CONFIG_COUNT: 'x' }).GIT_CONFIG_COUNT).toBe('0');
    expect(withRepoIdentityEnv().LOG_LEVEL).toBe('warn');
  });
});

describe('checkTinynodVersion', () => {
  const run = (result: object) => vi.fn().mockReturnValue(result);

  it('accepts the minimum and newer versions, with a 5 s timeout', () => {
    const spy = run({ status: 0, stdout: '2.5.0\n' });
    expect(checkTinynodVersion({ run: spy })).toEqual({ ok: true, version: '2.5.0' });
    expect(spy.mock.calls[0][2]).toMatchObject({ timeout: 5000 });
    expect(checkTinynodVersion({ run: run({ status: 0, stdout: 'tinynod v3.0.1' }) })).toMatchObject({ ok: true, version: '3.0.1' });
    expect(checkTinynodVersion({ run: run({ status: 0, stdout: '2.10.0' }) })).toMatchObject({ ok: true });
  });

  it.each(['2.4.9', '1.9.9'])('rejects %s as older than the minimum', (version) => {
    expect(checkTinynodVersion({ run: run({ status: 0, stdout: version }) })).toEqual({ ok: false, reason: `tinynod ${version} is older than the required 2.5.0` });
  });

  it('reports an absent tool with its quoted path', () => {
    const result = checkTinynodVersion({ run: run({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }), command: '/opt/my tools/tinynod' });
    expect(result).toEqual({ ok: false, reason: 'tinynod not found ("/opt/my tools/tinynod")' });
  });

  it('reports a timeout', () => {
    expect(checkTinynodVersion({ run: run({ error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }) })).toEqual({ ok: false, reason: 'tinynod --version timed out after 5s ("tinynod")' });
    expect(checkTinynodVersion({ run: run({ status: null, signal: 'SIGTERM' }) })).toMatchObject({ ok: false, reason: expect.stringContaining('timed out') });
  });

  it('reports failures and unrecognized output', () => {
    expect(checkTinynodVersion({ run: run({ status: 1, stdout: '' }) })).toEqual({ ok: false, reason: 'tinynod --version failed ("tinynod")' });
    expect(checkTinynodVersion({ run: run({ error: new Error('x') }) })).toMatchObject({ ok: false, reason: expect.stringContaining('failed') });
    expect(checkTinynodVersion({ run: run({ status: 0, stdout: 'banana' }) })).toEqual({ ok: false, reason: 'tinynod --version printed an unrecognized version "banana"' });
    expect(checkTinynodVersion({ run: run({ status: 0 }) })).toMatchObject({ ok: false });
  });

  it('really reports a missing binary', () => {
    expect(checkTinynodVersion({ command: join(tempDir(), 'absent-tinynod') })).toMatchObject({ ok: false, reason: expect.stringContaining('not found') });
  });
});

class FakeChild extends EventEmitter {
  pid = 4321;
  unref = vi.fn();
}

describe('startReview', () => {
  it('spawns detached with the exact base, json format, and owner-only capture files', () => {
    const tmp = tempDir();
    const child = new FakeChild();
    const spawn = vi.fn().mockReturnValue(child);
    const review = startReview({ base: BASE, cwd: '/snap', env: { A: '1' }, command: '/opt/my tools/tinynod', spawn, tmp, now: () => 1000 });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('/opt/my tools/tinynod');
    expect(args).toEqual(['review', '--base', BASE, '--format', 'json']);
    expect(options).toMatchObject({ cwd: '/snap', env: { A: '1' }, detached: true });
    expect(options.stdio[0]).toBe('ignore');
    expect(statSync(review.stdoutPath).mode & 0o777).toBe(0o600);
    expect(statSync(review.stderrPath).mode & 0o777).toBe(0o600);
    expect(statSync(review.dir).mode & 0o777).toBe(0o700);
    expect(review.startedAt).toBe(1000);
    expect(child.unref).toHaveBeenCalled();
    child.emit('exit', 0, null);
    expect(review).toMatchObject({ exited: true, exitCode: 0 });
  });

  it('records a signal exit', () => {
    const child = new FakeChild();
    const review = startReview({ base: BASE, cwd: '/', spawn: () => child, tmp: tempDir() });
    child.emit('exit', null, 'SIGKILL');
    expect(review.exitCode).toBe('SIGKILL');
  });

  it('records an asynchronous spawn error', () => {
    const child = new FakeChild();
    const review = startReview({ base: BASE, cwd: '/', spawn: () => child, tmp: tempDir() });
    child.emit('error', new Error('ENOENT'));
    expect(review.spawnError?.message).toBe('ENOENT');
    expect(review.exited).toBe(true);
  });

  it('records a synchronous spawn failure and still closes its descriptors', () => {
    const fs = { ...nodeFs, closeSync: vi.fn(nodeFs.closeSync) };
    const review = startReview({ base: BASE, cwd: '/', spawn: () => { throw new Error('nope'); }, tmp: tempDir(), fs });
    expect(review.spawnError?.message).toBe('nope');
    expect(fs.closeSync).toHaveBeenCalledTimes(2);
  });
});

describe('finishReview', () => {
  const clock = (onSleep?: (t: number) => void) => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; onSleep?.(t); } };
  };
  const makeReview = (overrides = {}) => {
    const dir = tempDir();
    const review = { dir, stdoutPath: join(dir, 'stdout'), stderrPath: join(dir, 'stderr'), child: { pid: 99 }, exited: false, exitCode: null, spawnError: null, startedAt: 0, ...overrides };
    writeFileSync(review.stdoutPath, '');
    writeFileSync(review.stderrPath, '');
    return review;
  };

  it('returns output once the child exits and removes the temp files', async () => {
    const review = makeReview();
    writeFileSync(review.stdoutPath, '{"a":1}\n');
    writeFileSync(review.stderrPath, 'warn line\n');
    const { now, sleep } = clock((t) => { if (t >= 300) { review.exited = true; (review as { exitCode: number | null }).exitCode = 0; } });
    const kill = vi.fn();
    const result = await finishReview(review, { now, sleep, kill });
    expect(result).toMatchObject({ stdout: '{"a":1}', stderrTail: 'warn line', timedOut: false, tooLarge: false, spawnError: null, exitCode: 0 });
    expect(kill).not.toHaveBeenCalled();
    expect(existsSync(review.dir)).toBe(false);
  });

  it('sends SIGTERM at the 300 s budget and SIGKILL 10 s later if the child ignores it', async () => {
    const review = makeReview();
    const { now, sleep } = clock();
    const kill = vi.fn();
    const result = await finishReview(review, { now, sleep, kill, pollMs: 1000 });
    expect(result.timedOut).toBe(true);
    expect(kill.mock.calls).toEqual([[-99, 'SIGTERM'], [-99, 'SIGKILL']]);
    expect(now()).toBeGreaterThanOrEqual(310_000);
  });

  it('skips SIGKILL when the child exits after SIGTERM', async () => {
    const review = makeReview();
    const { now, sleep } = clock();
    const kill = vi.fn((_pid: number, signal: string) => { if (signal === 'SIGTERM') review.exited = true; });
    const result = await finishReview(review, { now, sleep, kill, pollMs: 1000 });
    expect(result.timedOut).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('honors a custom budget measured from the review start', async () => {
    const review = makeReview({ startedAt: 0 });
    const { now, sleep } = clock();
    const kill = vi.fn();
    await finishReview(review, { now, sleep, kill, budgetMs: 5000, graceMs: 1000, pollMs: 500 });
    expect(kill.mock.calls[0]).toEqual([-99, 'SIGTERM']);
    expect(now()).toBeLessThan(10_000);
  });

  it('cuts off stdout above 8 MiB and reports it too large', async () => {
    const review = makeReview();
    truncateSync(review.stdoutPath, 8 * 1024 * 1024 + 1);
    const kill = vi.fn();
    const result = await finishReview(review, { ...clock(), kill });
    expect(result).toMatchObject({ tooLarge: true, timedOut: false, stdout: '' });
    expect(kill).toHaveBeenCalledWith(-99, 'SIGTERM');
  });

  it('cuts off stderr above 1 MiB', async () => {
    const review = makeReview();
    truncateSync(review.stderrPath, 1024 * 1024 + 1);
    const result = await finishReview(review, { ...clock(), kill: vi.fn() });
    expect(result.tooLarge).toBe(true);
  });

  it('accepts output exactly at the cap', async () => {
    const review = makeReview({ exited: true });
    truncateSync(review.stderrPath, 1024 * 1024);
    const result = await finishReview(review, { ...clock(), kill: vi.fn() });
    expect(result.tooLarge).toBe(false);
  });

  it('flags output that grew past the cap between the last poll and exit', async () => {
    const review = makeReview({ exited: true });
    truncateSync(review.stdoutPath, 8 * 1024 * 1024 + 5);
    expect((await finishReview(review, { ...clock(), kill: vi.fn() })).tooLarge).toBe(true);
  });

  it('keeps only the tail of stderr', async () => {
    const review = makeReview({ exited: true });
    writeFileSync(review.stderrPath, `${'x'.repeat(10_000)}END`);
    const result = await finishReview(review, { ...clock(), kill: vi.fn() });
    expect(result.stderrTail.length).toBeLessThanOrEqual(4096);
    expect(result.stderrTail.endsWith('END')).toBe(true);
  });

  it('does not signal or read output after a spawn error', async () => {
    const spawnError = new Error('ENOENT');
    const review = makeReview({ exited: true, spawnError });
    writeFileSync(review.stdoutPath, 'ignored');
    const kill = vi.fn();
    const result = await finishReview(review, { ...clock(), kill });
    expect(result).toMatchObject({ stdout: '', spawnError });
    expect(kill).not.toHaveBeenCalled();
  });

  it('tolerates missing capture files', async () => {
    const review = makeReview({ exited: true });
    rmSync(review.dir, { recursive: true });
    expect(await finishReview(review, { ...clock(), kill: vi.fn() })).toMatchObject({ stdout: '', stderrTail: '' });
  });

  it('really terminates a detached process group that overruns its budget', async () => {
    const dir = tempDir();
    const review = startReview({ base: BASE, cwd: dir, command: process.execPath, spawn: ((command: string, _args: string[], options: object) => spawnDetached(command, options)) as never, tmp: dir });
    const result = await finishReview(review, { budgetMs: 200, graceMs: 2000, pollMs: 20 });
    expect(result.timedOut).toBe(true);
    expect(review.exited).toBe(true);
  });
});

function spawnDetached(command: string, options: object) {
  // A stand-in review that never finishes, run with the options startReview chose.
  return nodeSpawn(command, ['-e', 'setInterval(() => {}, 1000)'], options);
}
describe('classifyReview JSON extraction', () => {
  const result = { failed: false, comments: [], summary: 'ok' };
  it('parses the whole output, or a result after log lines', () => {
    expect(classifyReview({ stdout: JSON.stringify(result, null, 2) })).toMatchObject({ status: 'clean' });
    expect(classifyReview({ stdout: `starting\n${JSON.stringify(result)}` })).toMatchObject({ status: 'clean' });
  });
  it('bounds the number of candidate lines it tries', () => {
    const noise = Array.from({ length: 200 }, (_, index) => `{ not json ${index}`).join('\n');
    expect(classifyReview({ stdout: `${noise}\n${JSON.stringify(result)}` })).toMatchObject({ status: 'warning', reason: 'unparseable' });
  });
});

describe('classifyReview', () => {
  const INFO = '2026-10-23T12:25:09.280Z [INFO] Review started | service=pr-processor\n2026-10-23T12:25:09.282Z [INFO] Using mock AI service | service=mock-claude\n';
  const review = (extra: object = {}) => ({ reviewId: 'r', base: BASE, summary: 's', failed: false, severityCounts: { info: 0, warning: 0, error: 0, critical: 0 }, ...extra });
  const comment = { filePath: 'f.txt', lineNumber: 1, severity: 'info', category: 'style', comment: 'Inconsistent naming convention' };

  it('reports a spawn error first', () => {
    expect(classifyReview({ spawnError: new Error('ENOENT'), tooLarge: true, timedOut: true })).toMatchObject({ status: 'warning', reason: 'spawn_error', message: expect.stringContaining('ENOENT') });
  });
  it('reports oversized output exactly', () => {
    expect(classifyReview({ tooLarge: true, timedOut: true })).toMatchObject({ status: 'warning', reason: 'too_large', message: 'review output too large' });
  });
  it('reports a timeout', () => {
    expect(classifyReview({ timedOut: true, base: BASE })).toMatchObject({ status: 'warning', reason: 'timeout', message: expect.stringContaining(`tinynod review --base ${BASE} --format json`) });
  });
  it('treats empty and garbage output as a warning, never clean', () => {
    expect(classifyReview({})).toMatchObject({ status: 'warning', reason: 'unparseable' });
    expect(classifyReview({ stdout: 'not json at all\n{broken', stderrTail: 'first\ntinynod: review failed — fetch failed' })).toMatchObject({ status: 'warning', reason: 'unparseable', message: expect.stringContaining('fetch failed') });
    expect(classifyReview({ stdout: INFO })).toMatchObject({ status: 'warning', reason: 'unparseable' });
    expect(classifyReview({ stdout: '[1,2]' })).toMatchObject({ status: 'warning' });
  });
  it('parses JSON after INFO-line pollution, including pretty-printed output', () => {
    const pretty = JSON.stringify(review({ comments: [comment] }), null, 2);
    const result = classifyReview({ stdout: `${INFO}${pretty}\n` });
    expect(result).toMatchObject({ status: 'findings', message: '1 finding' });
    expect(result.findings).toEqual([comment]);
  });
  it('parses single-line JSON after pollution', () => {
    expect(classifyReview({ stdout: `${INFO}${JSON.stringify(review({ comments: [comment, comment] }))}` })).toMatchObject({ status: 'findings', message: '2 findings' });
  });
  it('recognizes no_changes', () => {
    expect(classifyReview({ stdout: '{"status":"no_changes","message":"No changes between \'HEAD\' and HEAD."}' })).toMatchObject({ status: 'no_changes' });
    expect(classifyReview({ stdout: '{"noChanges":true}' })).toMatchObject({ status: 'no_changes' });
  });
  it('is clean only with no findings and failed false', () => {
    expect(classifyReview({ stdout: JSON.stringify(review({ comments: [], failed: false })) })).toMatchObject({ status: 'clean' });
    expect(classifyReview({ stdout: JSON.stringify(review()) })).toMatchObject({ status: 'clean' });
  });
  it('never calls a failed review with no comments clean', () => {
    expect(classifyReview({ stdout: JSON.stringify(review({ comments: [], failed: true })) })).toMatchObject({ status: 'findings', findings: [] });
  });
  it('warns when the result shape is unrecognized', () => {
    const { failed: _failed, ...noFailed } = review();
    expect(classifyReview({ stdout: JSON.stringify(noFailed) })).toMatchObject({ status: 'warning', reason: 'unknown_shape' });
    expect(classifyReview({ stdout: '{"foo":1}' })).toMatchObject({ status: 'warning', reason: 'unknown_shape' });
  });
  it('reports findings and stays advisory when failed is true', () => {
    expect(classifyReview({ stdout: JSON.stringify(review({ comments: [comment], failed: true })) })).toMatchObject({ status: 'findings' });
    expect(classifyReview({ stdout: JSON.stringify(review({ findings: [comment] })) })).toMatchObject({ status: 'findings' });
  });
  it('recognizes the tinynod partial-review summary', () => {
    expect(classifyReview({ stdout: JSON.stringify(review({ summary: 'Partial review: 2 of 5 chunks completed', comments: [comment] })) })).toMatchObject({ status: 'partial', message: 'partial review, 1 finding' });
    expect(classifyReview({ stdout: JSON.stringify(review({ summary: 'Not a Partial review: 2 of 5' })) })).toMatchObject({ status: 'clean' });
  });
  it('recognizes partial reviews', () => {
    expect(classifyReview({ stdout: JSON.stringify(review({ partial: true, comments: [comment] })) })).toMatchObject({ status: 'partial', message: 'partial review, 1 finding' });
    expect(classifyReview({ stdout: JSON.stringify(review({ status: 'partial' })) })).toMatchObject({ status: 'partial', message: 'partial review, 0 findings' });
  });
  it('reports a review error payload', () => {
    expect(classifyReview({ stdout: '{"error":"gateway down"}' })).toMatchObject({ status: 'warning', reason: 'review_error', message: expect.stringContaining('gateway down') });
    expect(classifyReview({ stdout: '{"error":{"code":1}}' })).toMatchObject({ reason: 'review_error', message: expect.stringContaining('"code":1') });
  });
});

describe('ledgerEntryFor', () => {
  it.each([
    [{ historyPath: '/h/1' }, '/h/1'],
    [{ historyFile: '/h/2' }, '/h/2'],
    [{ history: { path: '/h/3' } }, '/h/3'],
    [{ history: { file: '/h/4' } }, '/h/4'],
  ])('finds the history file in %j', (payload, file) => {
    expect(ledgerEntryFor({ payload, oid: OID, base: BASE, now: () => 5 })).toMatchObject({ file, oid: OID, base: BASE, at: 5 });
  });
  it('records the sibling comments file and directory', () => {
    expect(ledgerEntryFor({ payload: { historyPath: '/h/abc/1-review.json' }, oid: OID, base: BASE, now: () => 5 })).toEqual({ file: '/h/abc/1-review.json', commentsFile: '/h/abc/1-comments.json', dir: '/h/abc', oid: OID, base: BASE, at: 5 });
    expect(ledgerEntryFor({ payload: { historyPath: '/h/abc/other.json' }, oid: OID, base: BASE })?.commentsFile).toBeNull();
  });
  it('returns null without a usable path', () => {
    expect(ledgerEntryFor({ payload: {}, oid: OID, base: BASE })).toBeNull();
    expect(ledgerEntryFor({ payload: { historyPath: '' }, oid: OID, base: BASE })).toBeNull();
    expect(ledgerEntryFor({ payload: { historyPath: 7 }, oid: OID, base: BASE })).toBeNull();
    expect(ledgerEntryFor({ payload: null, oid: OID, base: BASE })).toBeNull();
    expect(ledgerEntryFor({ payload: { historyPath: '/h' }, oid: OID, base: BASE })?.at).toEqual(expect.any(Number));
  });
});

describe('recordAndPruneHistory', () => {
  const setup = () => {
    const commonDir = tempDir();
    const historyRoot = join(tempDir(), 'history');
    mkdirSync(historyRoot);
    return { commonDir, historyRoot, warn: vi.fn(), ledger: join(commonDir, 'zana-tinynod-history.json') };
  };
  const addFile = (root: string, name: string) => {
    const file = join(root, name);
    writeFileSync(file, 'x');
    return file;
  };
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

  it('keeps only the newest 50 and deletes older ledgered files', () => {
    const { commonDir, historyRoot, warn, ledger } = setup();
    const files = Array.from({ length: 53 }, (_, index) => addFile(historyRoot, `h${index}`));
    files.forEach((file, index) => recordAndPruneHistory({ commonDir, historyRoot, entry: { file, at: index + 1 }, warn }));
    expect(read(ledger)).toHaveLength(50);
    expect(files.slice(0, 3).some((file) => existsSync(file))).toBe(false);
    expect(files.slice(3).every((file) => existsSync(file))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(nodeFs.readdirSync(commonDir)).toEqual(['zana-tinynod-history.json']);
  });

  it('deletes the comments file and the emptied directory, but not a shared one', () => {
    const { commonDir, historyRoot } = setup();
    const entryIn = (name: string, at: number, dir: string) => {
      mkdirSync(dir, { recursive: true });
      const file = addFile(dir, `${name}-review.json`);
      const commentsFile = addFile(dir, `${name}-comments.json`);
      return { file, commentsFile, dir, at };
    };
    const solo = join(historyRoot, 'solo');
    const shared = join(historyRoot, 'shared');
    const a = entryIn('a', 1, solo);
    const b = entryIn('b', 2, shared);
    const c = entryIn('c', 3, shared);
    for (const entry of [a, b, c]) recordAndPruneHistory({ commonDir, historyRoot, entry, keep: 1 });
    expect([a, b].some((e) => existsSync(e.file) || existsSync(e.commentsFile))).toBe(false);
    expect(existsSync(solo)).toBe(false);
    expect(existsSync(shared)).toBe(true);
    expect(existsSync(c.file) && existsSync(c.commentsFile)).toBe(true);
  });

  it('writes the ledger atomically and owner-only, replacing a duplicate entry', () => {
    const { commonDir, historyRoot, ledger } = setup();
    const file = addFile(historyRoot, 'a');
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file, at: 1 } });
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file, at: 2 } });
    expect(read(ledger)).toEqual([{ file, at: 2 }]);
    expect(statSync(ledger).mode & 0o777).toBe(0o600);
  });

  it('never deletes files that are not ledgered', () => {
    const { commonDir, historyRoot } = setup();
    const stray = addFile(historyRoot, 'stray');
    const file = addFile(historyRoot, 'a');
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file, at: 1 }, keep: 1 });
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'b'), at: 2 }, keep: 1 });
    expect(existsSync(stray)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('refuses ledger entries that escape the history directory', () => {
    const { commonDir, historyRoot, warn, ledger } = setup();
    const outside = addFile(tempDir(), 'precious');
    const viaSymlink = join(historyRoot, 'link');
    symlinkSync(outside, viaSymlink);
    writeFileSync(ledger, JSON.stringify([
      { file: outside, at: 1 },
      { file: viaSymlink, at: 2 },
      { file: join(historyRoot, '..', 'precious'), at: 3 },
      { file: historyRoot, at: 4 },
    ]));
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'new'), at: 10 }, keep: 1, warn });
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(historyRoot)).toBe(true);
    expect(read(ledger)).toHaveLength(1);
  });

  it('drops entries whose files are already gone', () => {
    const { commonDir, historyRoot, warn, ledger } = setup();
    writeFileSync(ledger, JSON.stringify([{ file: join(historyRoot, 'gone'), at: 1 }]));
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'new'), at: 2 }, keep: 1, warn });
    expect(read(ledger)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores a corrupt or malformed ledger', () => {
    const { commonDir, historyRoot, ledger } = setup();
    writeFileSync(ledger, '{not json');
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'a'), at: 1 } });
    expect(read(ledger)).toHaveLength(1);
    writeFileSync(ledger, JSON.stringify({ not: 'an array' }));
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'b'), at: 2 } });
    expect(read(ledger)).toHaveLength(1);
    writeFileSync(ledger, JSON.stringify([{ file: 7, at: 1 }, { file: 'x', at: 'y' }, null]));
    recordAndPruneHistory({ commonDir, historyRoot, entry: null });
    expect(read(ledger)).toEqual([]);
  });

  it('deletes nothing when the history directory does not exist', () => {
    const { commonDir, historyRoot, ledger } = setup();
    const file = addFile(historyRoot, 'a');
    rmSync(historyRoot, { recursive: true });
    mkdirSync(historyRoot);
    writeFileSync(ledger, JSON.stringify([{ file, at: 1 }]));
    rmSync(historyRoot, { recursive: true });
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: join(commonDir, 'x'), at: 2 }, keep: 1 });
    // Nothing could be deleted, so the older entry stays ledgered for a later prune.
    expect(read(ledger)).toHaveLength(2);
  });

  it('warns and never throws when the ledger cannot be written', () => {
    const { historyRoot, warn } = setup();
    expect(() => recordAndPruneHistory({ commonDir: join(tempDir(), 'missing'), historyRoot, entry: { file: addFile(historyRoot, 'a'), at: 1 }, warn })).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not update tinynod history ledger'));
  });

  it('warns when a deletion fails', () => {
    const { commonDir, historyRoot, warn } = setup();
    const first = addFile(historyRoot, 'a');
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: first, at: 1 }, keep: 1 });
    const fs = { ...nodeFs, rmSync: ((path: string, options?: nodeFs.RmOptions) => { if (path === first) throw new Error('locked'); return nodeFs.rmSync(path, options); }) as typeof nodeFs.rmSync };
    recordAndPruneHistory({ commonDir, historyRoot, entry: { file: addFile(historyRoot, 'b'), at: 2 }, keep: 1, fs, warn });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not delete tinynod history'));
    // The failed delete keeps its entry so a later prune retries it.
    expect(read(join(commonDir, 'zana-tinynod-history.json')).map((entry: { file: string }) => entry.file)).toContain(first);
  });
});

describe('createReviewTree', () => {
  it('clones the pushed commit without a working tree, pinned to that commit', () => {
    const repo = tempDir('tn-tree-src-');
    const git = (...args: string[]) => spawnSync('git', [...GIT_IDENTITY, ...args], { cwd: repo, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'one');
    const first = git('rev-parse', 'HEAD').stdout.trim();
    git('commit', '-q', '--allow-empty', '-m', 'two');
    const tmp = tempDir('tn-tree-tmp-');
    const tree = createReviewTree({ root: repo, oid: first, tmp });
    expect(tree.startsWith(tmp)).toBe(true);
    expect(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tree, encoding: 'utf8' }).stdout.trim()).toBe(first);
    expect(existsSync(join(tree, '.git'))).toBe(true);
    // Independent of the source checkout's lifetime of its working tree files.
    expect(readdirSync(tree)).toEqual(['.git']);
  });

  it('removes its directory and throws when the commit is unknown', () => {
    const repo = tempDir('tn-tree-bad-');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const tmp = tempDir('tn-tree-badtmp-');
    expect(() => createReviewTree({ root: repo, oid: 'f'.repeat(40), tmp })).toThrow('private review checkout');
    expect(readdirSync(tmp)).toEqual([]);
  });
});

// Real tinynod binary, with HOME and TINYNOD_HOME in a temp directory so the
// developer's own configuration and history are never read or written.
const hasTinynod = spawnSync('sh', ['-c', 'command -v tinynod'], { encoding: 'utf8' }).status === 0;
const GIT_IDENTITY = ['-c', 'user.email=t@example.com', '-c', 'user.name=t'];

function realFixture() {
  const root = tempDir('tn-real-');
  const home = join(root, 'home');
  const tinynodHome = join(root, 'tinynod-home');
  const repo = join(root, 'repo');
  for (const dir of [home, tinynodHome, repo]) mkdirSync(dir);
  const env = { PATH: process.env.PATH ?? '', HOME: home, TINYNOD_HOME: tinynodHome, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => spawnSync('git', [...GIT_IDENTITY, ...args], { cwd: repo, encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(repo, 'f.txt'), 'hello\n');
  git('add', '.');
  git('commit', '-q', '-m', 'change');
  const tinynod = (...args: string[]) => spawnSync('tinynod', args, { cwd: repo, encoding: 'utf8', env });
  return { root, home, repo, base, env, tinynod };
}

async function runReal(fixture: ReturnType<typeof realFixture>, extraEnv: Record<string, string> = {}) {
  const review = startReview({ base: fixture.base, cwd: fixture.repo, env: withRepoIdentityEnv({ ...fixture.env, ...extraEnv }), tmp: fixture.root });
  const outcome = await finishReview(review, { budgetMs: 60_000 });
  return { outcome, verdict: classifyReview(outcome) };
}

describe('real tinynod', () => {
  it.skipIf(!hasTinynod)('mock mode: reviews the exact base, classifies findings, and records history under the temp HOME', async () => {
    const fixture = realFixture();
    expect(fixture.tinynod('config', 'set', 'ai.mode', 'mock').status).toBe(0);
    const { verdict, outcome } = await runReal(fixture);
    expect(outcome.stdout.includes('[INFO]')).toBe(false);
    expect(verdict.status).toBe('findings');
    expect(verdict.payload.base).toBe(fixture.base);
    const entry = ledgerEntryFor({ payload: verdict.payload, oid: OID, base: fixture.base });
    expect(entry?.file.startsWith(join(fixture.home, '.tinynod', 'history'))).toBe(true);
    const commonDir = tempDir();
    recordAndPruneHistory({ commonDir, entry: entry!, historyRoot: join(fixture.home, '.tinynod', 'history') });
    expect(JSON.parse(readFileSync(join(commonDir, 'zana-tinynod-history.json'), 'utf8'))).toHaveLength(1);
  });

  it.skipIf(!hasTinynod)('mock mode: an empty diff is no_changes', async () => {
    const fixture = realFixture();
    fixture.tinynod('config', 'set', 'ai.mode', 'mock');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.repo, encoding: 'utf8' }).stdout.trim();
    const review = startReview({ base: head, cwd: fixture.repo, env: withRepoIdentityEnv(fixture.env), tmp: fixture.root });
    expect(classifyReview(await finishReview(review, { budgetMs: 60_000 })).status).toBe('no_changes');
  });

  it.skipIf(!hasTinynod)('offline salesforce mode: an unreachable gateway is a warning, never clean', async () => {
    const fixture = realFixture();
    fixture.tinynod('config', 'set', 'ai.mode', 'salesforce');
    fixture.tinynod('config', 'set', 'ai.apiKey', 'dummy-key');
    const { verdict } = await runReal(fixture, { SALESFORCE_CLAUDE_ENDPOINT: 'http://127.0.0.1:1' });
    expect(verdict.status).toBe('warning');
    expect(verdict.status).not.toBe('clean');
  });
});

beforeEach(() => {
  vi.unstubAllEnvs();
});
