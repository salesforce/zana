import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GIT_AUTH_OUTPUT_LIMIT, OnboardingGitAuthService, parseAuthStatus, parseDevicePrompt, resolveGhBinary,
  spawnCaptured, splitHost, summarizeCliError
} from './onboarding-git-auth.js';

const HOST = 'git.example.test';
const auth = { host: HOST, method: 'gh-device' as const };
let dir: string;
let tmp: string;
const fakeGh = (body: string) => {
  const path = join(dir, 'gh');
  writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755);
  return path;
};
const service = (gh: string | null, extra: Partial<ConstructorParameters<typeof OnboardingGitAuthService>[0]> = {}) => new OnboardingGitAuthService({
  env: { PATH: process.env.PATH, ...(gh ? { ZCC_GH_BINARY: gh } : {}) }, platform: 'linux', tmp,
  exists: p => !!gh && p === gh, reach: async () => true, ...extra
});
let lastState: unknown;
const until = async (fn: () => boolean, ms = 15_000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout; state=' + JSON.stringify(lastState)); await new Promise(r => setTimeout(r, 20)); } };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zcc-gh-test-')); tmp = mkdtempSync(join(tmpdir(), 'zcc-gh-cap-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); });

describe('parsers', () => {
  it('reads the active login from gh auth status JSON and never a token', () => {
    const json = JSON.stringify({ hosts: { [HOST]: [{ state: 'success', active: true, host: HOST, login: 'ada', token: 'gho_secret' }] } });
    expect(parseAuthStatus(json, HOST)).toEqual({ signedIn: 'yes', login: 'ada' });
    expect(parseAuthStatus(JSON.stringify({ hosts: {} }), HOST)).toEqual({ signedIn: 'no' });
    expect(parseAuthStatus(JSON.stringify({ hosts: { [HOST]: [{ state: 'error', active: true }] } }), HOST)).toEqual({ signedIn: 'no' });
    expect(parseAuthStatus(JSON.stringify({ hosts: { [HOST]: [{ state: 'success', login: '<script>' }] } }), HOST)).toEqual({ signedIn: 'yes' });
    expect(parseAuthStatus('not json', HOST)).toEqual({ signedIn: 'unknown' });
    expect(parseAuthStatus('null', HOST)).toEqual({ signedIn: 'unknown' });
  });
  it('extracts the device code and only accepts a verification URL on the configured host', () => {
    const out = `! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://${HOST}/login/device\n`;
    expect(parseDevicePrompt(out, HOST)).toEqual({ code: 'AB12-CD34', verificationUrl: `https://${HOST}/login/device` });
    expect(parseDevicePrompt(out.replace(`https://${HOST}`, 'https://evil.test'), HOST)).toBeNull();
    expect(parseDevicePrompt(out.replace('https://', 'http://'), HOST)).toBeNull();
    expect(parseDevicePrompt('Open https://x/login/device', HOST)).toBeNull();
    expect(parseDevicePrompt(`code AB12-CD34 https://${HOST}:8443/login/device`, `${HOST}:8443`)).toEqual({ code: 'AB12-CD34', verificationUrl: `https://${HOST}:8443/login/device` });
  });
  it('summarizes CLI errors as one bounded, scrubbed line', () => {
    expect(summarizeCliError('a\nerror: bad gho_abcdef123 here\n\n', 'x')).toBe('error: bad [redacted] here');
    expect(summarizeCliError('', 'fallback')).toBe('fallback');
    expect(summarizeCliError('y'.repeat(1000), 'x')).toHaveLength(300);
  });
  it('splits host and port', () => {
    expect(splitHost(HOST)).toEqual({ hostname: HOST, port: 443 });
    expect(splitHost(`${HOST}:8443`)).toEqual({ hostname: HOST, port: 8443 });
  });
});

describe('resolveGhBinary', () => {
  it('honours an absolute override only', () => {
    expect(resolveGhBinary({ env: { ZCC_GH_BINARY: '/x/gh' }, exists: p => p === '/x/gh' })).toBe('/x/gh');
    expect(resolveGhBinary({ env: { ZCC_GH_BINARY: 'gh' }, exists: () => true })).toBeNull();
    expect(resolveGhBinary({ env: { ZCC_GH_BINARY: '/x/gh' }, exists: () => false })).toBeNull();
  });
  it('searches PATH, then platform install dirs a GUI launch may omit', () => {
    expect(resolveGhBinary({ env: { PATH: '/a:/b' }, platform: 'linux', exists: p => p === '/b/gh' })).toBe('/b/gh');
    expect(resolveGhBinary({ env: {}, platform: 'darwin', exists: p => p === '/opt/homebrew/bin/gh' })).toBe('/opt/homebrew/bin/gh');
    expect(resolveGhBinary({ env: {}, platform: 'linux', exists: p => p === '/usr/bin/gh' })).toBe('/usr/bin/gh');
    expect(resolveGhBinary({ env: { PATH: 'C:\\bin' }, platform: 'win32', exists: p => p.endsWith('GitHub CLI/gh.exe') || p.endsWith('GitHub CLI\\gh.exe') })).toMatch(/gh\.exe$/);
    expect(resolveGhBinary({ env: {}, platform: 'linux', exists: () => false })).toBeNull();
    expect(resolveGhBinary({ env: {}, platform: 'freebsd', exists: () => false })).toBeNull();
  });
  it('uses the real filesystem by default', () => {
    const gh = fakeGh('exit 0');
    expect(resolveGhBinary({ env: { ZCC_GH_BINARY: gh } })).toBe(gh);
  });
});

describe('spawnCaptured', () => {
  it('captures stdout+stderr through a private temp file and always removes it', async () => {
    const gh = fakeGh('echo out; echo err >&2; exit 3');
    const result = await spawnCaptured(gh, [], { env: process.env, timeoutMs: 5000, tmp }).done;
    expect(result.code).toBe(3);
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
    expect(readdirSync(tmp)).toEqual([]);
  });
  it('returns more than 8192 bytes intact', async () => {
    const gh = fakeGh(`head -c 20000 /dev/zero | tr '\\0' 'x'`);
    expect((await spawnCaptured(gh, [], { env: process.env, timeoutMs: 5000, tmp }).done).output).toHaveLength(20000);
  });
  it('kills on timeout and on oversize output', async () => {
    const slow = fakeGh('sleep 30');
    const timed = await spawnCaptured(slow, [], { env: process.env, timeoutMs: 150, tmp }).done;
    expect(timed.error?.code).toBe('ETIMEDOUT');
    const big = fakeGh(`head -c ${GIT_AUTH_OUTPUT_LIMIT * 2} /dev/zero | tr '\\0' 'x'; sleep 30`);
    const huge = await spawnCaptured(big, [], { env: process.env, timeoutMs: 10_000, tmp }).done;
    expect(huge.error?.code).toBe('E2BIG');
    expect(huge.output.length).toBeLessThanOrEqual(GIT_AUTH_OUTPUT_LIMIT);
    expect(readdirSync(tmp)).toEqual([]);
  });
  it('reports a missing executable', async () => {
    const result = await spawnCaptured(join(dir, 'missing'), [], { env: process.env, timeoutMs: 1000, tmp }).done;
    expect(result.error?.code).toBe('ENOENT');
    expect(readdirSync(tmp)).toEqual([]);
  });
  it('dispose before exit kills the child and cleans up', async () => {
    const handle = spawnCaptured(fakeGh('sleep 30'), [], { env: process.env, timeoutMs: 10_000, tmp });
    handle.dispose(); handle.dispose();
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe('status', () => {
  it('reports an unreachable host without running gh', async () => {
    const gh = fakeGh('echo should-not-run; exit 1');
    expect(await service(gh, { reach: async () => false }).status(auth)).toEqual({ host: HOST, reachable: false, cli: 'available', signedIn: 'unknown' });
  });
  it('reports a missing CLI', async () => {
    expect(await service(null).status(auth)).toEqual({ host: HOST, reachable: true, cli: 'missing', signedIn: 'unknown' });
  });
  it('passes the profile host to gh, disables prompts and returns the login', async () => {
    const gh = fakeGh(`[ "$GIT_TERMINAL_PROMPT" = 0 ] || exit 9\n[ "$3" = "--hostname" ] && [ "$4" = "${HOST}" ] || exit 8\necho '{"hosts":{"${HOST}":[{"state":"success","active":true,"login":"ada"}]}}'`);
    expect(await service(gh).status(auth)).toEqual({ host: HOST, reachable: true, cli: 'available', signedIn: 'yes', login: 'ada' });
  });
  it('treats a not-logged-in host as signed out', async () => {
    const gh = fakeGh(`echo '{"hosts":{}}'`);
    expect((await service(gh).status(auth)).signedIn).toBe('no');
  });
  it('treats a vanished binary as missing', async () => {
    const svc = service(join(dir, 'gone'), { exists: () => true });
    expect((await svc.status(auth)).cli).toBe('missing');
  });
  it('uses TCP reachability by default', async () => {
    const svc = new OnboardingGitAuthService({ env: { PATH: '' }, platform: 'linux', exists: () => false });
    expect((await svc.status({ host: '127.0.0.1:1', method: 'gh-device' })).reachable).toBe(false);
  });
});

describe('device sign-in', { timeout: 30_000 }, () => {
  const login = (tail: string) => fakeGh(`if [ "$2" = "setup-git" ]; then ${tail.includes('SETUPFAIL') ? 'echo "setup broke" >&2; exit 1' : 'exit 0'}; fi
echo '! First copy your one-time code: WXYZ-1234' >&2
echo 'Open this URL to continue in your web browser: https://${HOST}/login/device' >&2
${tail.replace('SETUPFAIL', '')}`);

  it('surfaces the code, then configures Git and succeeds', async () => {
    const svc = service(login('sleep 0.6; exit 0'));
    expect(svc.start(auth).phase).toBe('starting');
    await until(() => (lastState = svc.getState()).phase === 'waiting');
    const waiting = svc.getState();
    expect(waiting).toMatchObject({ phase: 'waiting', code: 'WXYZ-1234', verificationUrl: `https://${HOST}/login/device` });
    expect(svc.start(auth)).toBe(waiting);
    await until(() => (lastState = svc.getState()).phase === 'succeeded');
    expect(readdirSync(tmp)).toEqual([]);
  });
  it('fails when git configuration fails', async () => {
    const svc = service(login('exit 0 SETUPFAIL'));
    svc.start(auth);
    await until(() => (lastState = svc.getState()).phase === 'failed');
    expect(svc.getState()).toEqual({ phase: 'failed', error: 'setup broke' });
  });
  it('maps gh expiry output and our own timeout to expired', async () => {
    const svc = service(login('echo "error: device code expired" >&2; exit 1'));
    svc.start(auth);
    await until(() => (lastState = svc.getState()).phase === 'expired');
    const slow = service(login('sleep 30'), { signInTimeoutMs: 400 });
    slow.start(auth);
    await until(() => (lastState = slow.getState()).phase === 'expired');
  });
  it('reports other failures with a scrubbed message', async () => {
    const svc = service(login('echo "error: access denied gho_123" >&2; exit 1'));
    svc.start(auth);
    await until(() => (lastState = svc.getState()).phase === 'failed');
    expect(svc.getState()).toEqual({ phase: 'failed', error: 'error: access denied [redacted]' });
  });
  it('fails clearly without gh, including when the binary disappears', async () => {
    expect(service(null).start(auth)).toEqual({ phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' });
    const gone = service(join(dir, 'gone'), { exists: () => true });
    gone.start(auth);
    await until(() => (lastState = gone.getState()).phase === 'failed');
    expect(gone.getState()).toEqual({ phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' });
  });
  it('cancel kills the login, ignores its late exit and resets', async () => {
    const svc = service(login('sleep 30'));
    svc.start(auth);
    await until(() => (lastState = svc.getState()).phase === 'waiting');
    expect(svc.cancel()).toEqual({ phase: 'idle' });
    await new Promise(r => setTimeout(r, 100));
    expect(svc.getState()).toEqual({ phase: 'idle' });
    expect(readdirSync(tmp)).toEqual([]);
  });
  it('dispose stops sign-in and refuses new ones', async () => {
    const svc = service(login('sleep 30'));
    svc.start(auth);
    svc.dispose();
    expect(svc.start(auth)).toEqual({ phase: 'idle' });
  });
  it('a new start after a terminal phase starts over', async () => {
    const svc = service(login('echo nope >&2; exit 1'));
    svc.start(auth);
    await until(() => (lastState = svc.getState()).phase === 'failed');
    expect(svc.start(auth).phase).toBe('starting');
    svc.cancel();
  });
  it('uses the real clock and default timeout when not injected', () => {
    vi.useFakeTimers();
    try {
      const svc = new OnboardingGitAuthService({ env: { PATH: '' }, platform: 'linux', exists: () => false });
      expect(svc.start(auth).phase).toBe('failed');
    } finally { vi.useRealTimers(); }
  });
});
