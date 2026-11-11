import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, closeSync, constants, openSync, readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { GitAccessStatus, GitSignInState, OnboardingGitAuth } from '@zana-ai/zcc-domain/onboarding';

/**
 * Browser (device-code) Git sign-in for the onboarding marketplace host, delegated to the GitHub CLI.
 *
 * The host is distribution metadata (onboarding profile), never renderer input. Child output is
 * captured to uniquely named 0600 temp files with a size cap, a timeout and cleanup on every path
 * (Electron main has truncated piped child stdout before). Tokens never leave `gh`: this module
 * only reads the one-time code, the verification URL and the account login.
 */

export const GIT_AUTH_OUTPUT_LIMIT = 64 * 1024;
const PROBE_TIMEOUT_MS = 10_000;
const REACH_TIMEOUT_MS = 5_000;
/** GitHub device codes expire after 15 minutes. */
export const SIGN_IN_TIMEOUT_MS = 15 * 60_000;
const POLL_MS = 200;
const CODE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
const URL_RE = /(https:\/\/[^\s'"<>]+\/login\/device)\b/;
const SECRETS = /\b(gh[opsur]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g;

export interface CapturedResult { code: number | null; output: string; error?: NodeJS.ErrnoException }

export interface GitAuthDeps {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  now?: () => number;
  /** Test seam: TCP reachability. */
  reach?: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  /** Test seam: executable lookup. */
  exists?: (path: string) => boolean;
  tmp?: string;
  signInTimeoutMs?: number;
}

const scrub = (text: string) => text.replace(SECRETS, '[redacted]');

/** Last meaningful line of CLI output, bounded and secret-scrubbed, for user-facing errors. */
export function summarizeCliError(output: string, fallback: string): string {
  const line = scrub(output).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop();
  return (line ?? fallback).slice(0, 300);
}

export function splitHost(host: string): { hostname: string; port: number } {
  const [hostname, port] = host.split(':');
  return { hostname: hostname!, port: port ? Number(port) : 443 };
}

function tcpReach(hostname: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: hostname, port });
    const done = (ok: boolean) => { socket.removeAllListeners(); socket.destroy(); clearTimeout(timer); resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** `ZCC_GH_BINARY` (absolute) → PATH → common install dirs a GUI launch may omit. */
export function resolveGhBinary(deps: Pick<GitAuthDeps, 'env' | 'platform' | 'exists'> = {}): string | null {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? ((p: string) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } });
  const override = env.ZCC_GH_BINARY?.trim();
  if (override) return isAbsolute(override) && exists(override) ? override : null;
  const name = platform === 'win32' ? 'gh.exe' : 'gh';
  const dirs = (env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  else if (platform === 'linux') dirs.push('/usr/local/bin', '/usr/bin', '/home/linuxbrew/.linuxbrew/bin');
  else if (platform === 'win32') dirs.push('C:\\Program Files\\GitHub CLI');
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

interface CaptureHandle { child: ChildProcess; read: () => string; dispose: () => void; done: Promise<CapturedResult> }

/** Spawn with stdout+stderr redirected to a private temp file; `dispose` kills and removes it. */
export function spawnCaptured(command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeoutMs: number; tmp?: string }): CaptureHandle {
  const path = join(options.tmp ?? tmpdir(), `zcc-gh-${randomUUID()}.log`);
  const fd = openSync(path, 'wx', 0o600);
  let closed = false;
  const closeFd = () => { if (!closed) { closed = true; try { closeSync(fd); } catch { /* closed */ } } };
  const read = () => {
    try { const buf = readFileSync(path); return buf.subarray(0, GIT_AUTH_OUTPUT_LIMIT).toString('utf8'); } catch { return ''; }
  };
  let child: ChildProcess;
  try {
    child = spawn(command, args, { stdio: ['ignore', fd, fd], env: options.env, detached: process.platform !== 'win32', windowsHide: true });
  } catch (error) {
    closeFd(); rmSync(path, { force: true });
    const failed = { code: null, output: '', error: error as NodeJS.ErrnoException };
    return { child: undefined as unknown as ChildProcess, read: () => '', dispose: () => undefined, done: Promise.resolve(failed) };
  }
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill(); } catch { try { child.kill(); } catch { /* gone */ } }
  };
  let disposed = false;
  let timer: NodeJS.Timeout | undefined;
  let sizeTimer: NodeJS.Timeout | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearInterval(sizeTimer);
    kill(); closeFd(); rmSync(path, { force: true });
  };
  const done = new Promise<CapturedResult>(resolve => {
    let settled = false;
    const finish = (result: CapturedResult) => { if (settled) return; settled = true; const output = result.output || read(); dispose(); resolve({ ...result, output }); };
    timer = setTimeout(() => finish({ code: null, output: read(), error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }), options.timeoutMs);
    sizeTimer = setInterval(() => {
      try { if (readFileSync(path).length > GIT_AUTH_OUTPUT_LIMIT) finish({ code: null, output: read(), error: Object.assign(new Error('output too large'), { code: 'E2BIG' }) }); } catch { /* removed */ }
    }, 500);
    child.once('error', error => finish({ code: null, output: '', error }));
    child.once('close', code => finish({ code, output: read() }));
  });
  return { child, read, dispose, done };
}

/** Parses `gh auth status --hostname <host> --json hosts`. */
export function parseAuthStatus(output: string, host: string): { signedIn: GitAccessStatus['signedIn']; login?: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { return { signedIn: 'unknown' }; }
  const hosts = (parsed as { hosts?: Record<string, unknown> } | null)?.hosts;
  if (!hosts || typeof hosts !== 'object') return { signedIn: 'unknown' };
  const entries = Array.isArray(hosts[host]) ? hosts[host] as Array<Record<string, unknown>> : [];
  const active = entries.find(e => e?.active === true) ?? entries[0];
  if (!active) return { signedIn: 'no' };
  if (active.state !== 'success') return { signedIn: 'no' };
  const login = typeof active.login === 'string' && /^[\w.-]{1,128}$/.test(active.login) ? active.login : undefined;
  return { signedIn: 'yes', ...(login ? { login } : {}) };
}

/** Extracts the device code + verification URL; the URL must point at the configured host. */
export function parseDevicePrompt(output: string, host: string): { code: string; verificationUrl: string } | null {
  const code = output.match(/one-time code[^A-Z0-9]*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1] ?? output.match(CODE)?.[1];
  const url = output.match(URL_RE)?.[1];
  if (!code || !url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.host.toLowerCase() !== host.toLowerCase().replace(/:443$/, '')) return null;
    return { code: code.toUpperCase(), verificationUrl: parsed.href };
  } catch { return null; }
}

export class OnboardingGitAuthService {
  private state: GitSignInState = { phase: 'idle' };
  private session?: { host: string; capture: CaptureHandle; poll: NodeJS.Timeout; setup?: CaptureHandle };
  private disposed = false;

  constructor(private readonly deps: GitAuthDeps = {}) {}

  private get env(): NodeJS.ProcessEnv {
    // Never let gh/git prompt on a terminal or a GUI helper; device flow needs neither.
    return { ...(this.deps.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
  }

  private now() { return (this.deps.now ?? Date.now)(); }

  async status(auth: OnboardingGitAuth): Promise<GitAccessStatus> {
    const { hostname, port } = splitHost(auth.host);
    const reachable = await (this.deps.reach ?? tcpReach)(hostname, port, REACH_TIMEOUT_MS);
    const gh = resolveGhBinary(this.deps);
    if (!gh) return { host: auth.host, reachable, cli: 'missing', signedIn: 'unknown' };
    if (!reachable) return { host: auth.host, reachable, cli: 'available', signedIn: 'unknown' };
    const result = await spawnCaptured(gh, ['auth', 'status', '--hostname', auth.host, '--json', 'hosts'], { env: this.env, timeoutMs: PROBE_TIMEOUT_MS, tmp: this.deps.tmp }).done;
    if (result.error?.code === 'ENOENT') return { host: auth.host, reachable, cli: 'missing', signedIn: 'unknown' };
    return { host: auth.host, reachable, cli: 'available', ...parseAuthStatus(result.output, auth.host) };
  }

  getState(): GitSignInState { return this.state; }

  /** Idempotent while a sign-in is in flight; a new call after a terminal phase starts over. */
  start(auth: OnboardingGitAuth): GitSignInState {
    if (this.disposed) return this.state;
    if (this.session && ['starting', 'waiting', 'finishing'].includes(this.state.phase)) return this.state;
    const gh = resolveGhBinary(this.deps);
    if (!gh) return (this.state = { phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' });
    const capture = spawnCaptured(gh, ['auth', 'login', '--hostname', auth.host, '--web', '--git-protocol', 'https', '--skip-ssh-key'],
      { env: this.env, timeoutMs: this.deps.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS, tmp: this.deps.tmp });
    const startedAt = this.now();
    this.state = { phase: 'starting' };
    const poll = setInterval(() => {
      if (this.state.phase !== 'starting') return;
      const prompt = parseDevicePrompt(capture.read(), auth.host);
      if (prompt) this.state = { phase: 'waiting', ...prompt, expiresAt: startedAt + (this.deps.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS) };
    }, POLL_MS);
    const session = { host: auth.host, capture, poll } as NonNullable<typeof this.session>;
    this.session = session;
    void capture.done.then(async result => {
      clearInterval(poll);
      if (this.session !== session) return;
      if (result.error?.code === 'ETIMEDOUT') { this.end({ phase: 'expired' }); return; }
      if (result.error?.code === 'ENOENT') { this.end({ phase: 'failed', error: 'The GitHub CLI (gh) is not installed.' }); return; }
      if (result.code !== 0) {
        this.end(/expired|expire/i.test(result.output) ? { phase: 'expired' } : { phase: 'failed', error: summarizeCliError(result.output, 'Sign-in did not complete.') });
        return;
      }
      this.state = { phase: 'finishing' };
      const setup = spawnCaptured(gh, ['auth', 'setup-git', '--hostname', auth.host], { env: this.env, timeoutMs: PROBE_TIMEOUT_MS, tmp: this.deps.tmp });
      session.setup = setup;
      const configured = await setup.done;
      if (this.session !== session) return;
      this.end(configured.code === 0 ? { phase: 'succeeded' }
        : { phase: 'failed', error: summarizeCliError(configured.output, 'Signed in, but Git could not be configured to use it.') });
    });
    return this.state;
  }

  cancel(): GitSignInState {
    if (this.session) { const { capture, poll, setup } = this.session; this.session = undefined; clearInterval(poll); capture.dispose(); setup?.dispose(); }
    return (this.state = { phase: 'idle' });
  }

  private end(state: GitSignInState) { this.session = undefined; this.state = state; }

  dispose() { this.disposed = true; this.cancel(); }
}
