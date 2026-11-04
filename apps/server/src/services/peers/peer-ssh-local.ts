import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect, createServer, type Socket } from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { generateSeed, privateKeyFile, publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import { classifyPeerSshFailure, peerLinkSshArgs } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import type { AuthorizedKeys, PeerSshEndpoint, SshReason } from './peer-ssh-contract.js';

const SSH_BIN = '/usr/bin/ssh';
const HOST_KEY_PATH = '/etc/ssh/ssh_host_ed25519_key.pub';
const SSHD_PORT = 22;
const BANNER_TIMEOUT_MS = 2000;
const SELF_TEST_TIMEOUT_MS = 10_000;
const SELF_TEST_TTL_MS = 2 * 60_000;
const SELF_TEST_PAYLOAD = 'zana-peer-self-test';
const HOST_KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
const LOCAL_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
// Same shapes as the invitation schema's ssh offer: no leading '-' and no option syntax can reach ssh argv.
const OVERRIDE_HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const OVERRIDE_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

const SSH_REASON_SET: ReadonlySet<string> = new Set(['ssh_remote_login_off', 'ssh_unreachable', 'ssh_auth_refused', 'ssh_forwarding_refused', 'ssh_host_key_mismatch'] satisfies SshReason[]);
const fail = (reason: SshReason): Error => new Error(reason);
const STREAM_LOCAL_MESSAGE = 'ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)';
const streamLocalRefused = (): Error => new Error(STREAM_LOCAL_MESSAGE);

export type BannerResult = 'ok' | 'refused' | 'no-banner';

export interface SshProcess {
  /** Resolves when ssh exits; stderr is bounded. */
  exited: Promise<{ code: number | null; stderr: string }>;
  kill(): void;
}

export interface PeerSshLocalDeps {
  /** A's authorized_keys manager; required to prove forwarding policy with a short-lived throwaway line. */
  authorizedKeys?: AuthorizedKeys;
  env?: NodeJS.ProcessEnv;
  /** Resolves `scutil --get LocalHostName` output. */
  localHostName?: () => Promise<string>;
  readHostKey?: () => Promise<string>;
  user?: () => { username: string; homedir: string };
  home?: () => string;
  warn?: (message: string) => void;
  /** Connects to host:port and reports whether an `SSH-2.0-` banner arrived. */
  probeBanner?: (host: string, port: number, signal: AbortSignal) => Promise<BannerResult>;
  /** Full self-test override; the default drives ssh to localhost with a throwaway key. */
  selfTest?: (endpoint: PeerSshEndpoint, signal: AbortSignal) => Promise<void>;
  spawnSsh?: (args: string[]) => SshProcess;
  /** Zana's own sshd (`PeerSshd`): when present it serves the link instead of the system Remote Login. */
  sshd?: { ensure(signal: AbortSignal): Promise<{ port: number; hostKey: string }> };
}

function runScutil(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/scutil', ['--get', 'LocalHostName'], { timeout: 3000, maxBuffer: 4096 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout));
  });
}

export function probeSshBanner(host: string, port: number, signal: AbortSignal): Promise<BannerResult> {
  return new Promise(resolve => {
    let done = false;
    let socket: Socket | undefined;
    const finish = (result: BannerResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      socket?.destroy();
      resolve(result);
    };
    const onAbort = (): void => finish('no-banner');
    const timer = setTimeout(() => finish('no-banner'), BANNER_TIMEOUT_MS);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) return finish('no-banner');
    let seen = '';
    socket = connect({ host, port });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      seen += chunk;
      if (seen.startsWith('SSH-2.0-')) finish('ok');
      else if (seen.length >= 8) finish('no-banner');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED' ? 'refused' : 'no-banner'));
    socket.on('close', () => finish('no-banner'));
  });
}

function defaultSpawnSsh(env: NodeJS.ProcessEnv): (args: string[]) => SshProcess {
  return args => {
    const childEnv: NodeJS.ProcessEnv = { ...env, LC_ALL: 'C' };
    delete childEnv.SSH_AUTH_SOCK;
    // Detached = own process group, so cleanup can SIGKILL ssh and anything it forked (matches PeerTunnels).
    const child = spawn(SSH_BIN, args, { shell: false, env: childEnv, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
    const exited = new Promise<{ code: number | null; stderr: string }>(resolve => {
      child.once('error', error => resolve({ code: null, stderr: `${stderr}\n${error.message}` }));
      child.once('close', code => resolve({ code, stderr }));
    });
    const kill = (): void => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* group already gone */ }
      }
      child.kill('SIGKILL');
    };
    return { exited, kill };
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** One attempt through the local forward: data back => ok, closed empty => forwarding refused, refused connect => retry. */
function probeForward(port: number): Promise<'ok' | 'closed' | 'retry'> {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    let got = false;
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('data', (chunk: string) => { if (chunk.includes(SELF_TEST_PAYLOAD)) { got = true; socket.destroy(); resolve('ok'); } });
    socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'ECONNREFUSED' ? 'retry' : 'closed'));
    socket.on('close', () => resolve(got ? 'ok' : 'closed'));
  });
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Absence alone is not proof: require ssh's explicit refusal of this exact remote listen path after TCP worked. */
async function proveStreamLocalRefused(args: string[], socketPath: string, signal: AbortSignal,
  spawnSsh: (args: string[]) => SshProcess): Promise<void> {
  const ssh = spawnSsh(args);
  let exit: { code: number | null; stderr: string } | undefined;
  void ssh.exited.then(result => { exit = result; });
  const deadline = Date.now() + SELF_TEST_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (signal.aborted) throw streamLocalRefused();
      const socket = await lstat(socketPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw streamLocalRefused();
      });
      if (socket) throw streamLocalRefused();
      if (exit) {
        if (exit.code === 255 && exit.stderr.split(/\r?\n/).includes(`Error: remote port forwarding failed for listen path ${socketPath}`)) return;
        throw streamLocalRefused();
      }
      await sleep(100);
    }
    throw streamLocalRefused();
  } finally { ssh.kill(); }
}

/**
 * Drives the real sshd on this machine with a throwaway key and a `-L` to a scratch listener, so Remote Login, the
 * TCP key restrictions and sshd's refusal of stream-local remote forwarding are proven before an invitation is minted.
 */
async function defaultSelfTest(endpoint: PeerSshEndpoint, signal: AbortSignal, deps: PeerSshLocalDeps): Promise<void> {
  const authorizedKeys = deps.authorizedKeys;
  if (!authorizedKeys) throw streamLocalRefused();
  const spawnSsh = deps.spawnSsh ?? defaultSpawnSsh(deps.env ?? process.env);
  const seed = generateSeed();
  const linkId = `selftest-${randomBytes(6).toString('hex')}`;
  const dir = await mkdtemp(join(tmpdir(), 'zana-ssh-selftest-'));
  const target = createServer(socket => { socket.end(SELF_TEST_PAYLOAD); });
  let ssh: SshProcess | undefined;
  try {
    await chmod(dir, 0o700);
    const [localPort, listenPort, reversePort] = await Promise.all([freePort(), freePort(), freePort()]);
    await new Promise<void>((resolve, reject) => { target.once('error', reject); target.listen(0, '127.0.0.1', resolve); });
    const address = target.address();
    const targetPort = typeof address === 'object' && address ? address.port : 0;
    const identityFile = join(dir, 'id');
    const knownHosts = join(dir, 'known_hosts');
    await writeFile(identityFile, privateKeyFile(seed, 'zana-peer-selftest'), { mode: 0o600 });
    const hostLabel = endpoint.port === SSHD_PORT ? 'localhost' : `[localhost]:${endpoint.port}`;
    await writeFile(knownHosts, `${hostLabel} ${endpoint.hostKey}\n`, { mode: 0o600 });
    await authorizedKeys.upsert({ linkId, kind: 'bootstrap', pub: publicKeyLine(seed), listenPort, targetPort, expiresAt: Date.now() + SELF_TEST_TTL_MS });
    const args = peerLinkSshArgs({ endpoint: { ...endpoint, host: 'localhost' }, seed, listenPort, targetPort, reversePort, localPort },
      identityFile, knownHosts);
    ssh = spawnSsh(args);
    const state: { exit?: { code: number | null; stderr: string } } = {};
    // Read through a function: TS would otherwise keep the earlier `state.exit` narrowing across the awaits.
    const exitOf = (): { code: number | null; stderr: string } | undefined => state.exit;
    void ssh.exited.then(result => { state.exit = result; });
    const deadline = Date.now() + SELF_TEST_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) throw fail('ssh_unreachable');
      const early = exitOf();
      if (early) throw fail(classifyPeerSshFailure(early.stderr));
      const result = await probeForward(localPort);
      if (result === 'ok') {
        const socketPath = join(dir, 's');
        // A separate connection makes ExitOnForwardFailure identify only the stream-local request, not a TCP bind race.
        const streamArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-L') { i++; continue; }
          streamArgs.push(args[i]!);
          if (args[i] === '-R') { streamArgs.push(`${socketPath}:127.0.0.1:${targetPort}`); i++; }
        }
        await proveStreamLocalRefused(streamArgs, socketPath, signal, spawnSsh);
        return;
      }
      if (result === 'closed') {
        // Either ssh just died (auth) or sshd refused the forward; the exit status disambiguates.
        await sleep(150);
        const late = exitOf();
        throw fail(late ? classifyPeerSshFailure(late.stderr) : 'ssh_forwarding_refused');
      }
      await sleep(100);
    }
    throw fail('ssh_forwarding_refused');
  } finally {
    ssh?.kill();
    await new Promise<void>(resolve => target.close(() => resolve()));
    await authorizedKeys.remove(linkId).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function e2ePeerSshOverride(env: NodeJS.ProcessEnv): PeerSshEndpoint | undefined {
  // Honoured only inside an E2E-isolated home so a stray variable can never redirect a real user's invitations.
  if (!env.ZCC_E2E_HOME || !env.ZCC_E2E_PEER_SSH_ENDPOINT) return undefined;
  try {
    const parsed = JSON.parse(env.ZCC_E2E_PEER_SSH_ENDPOINT) as Partial<PeerSshEndpoint>;
    if (typeof parsed.host !== 'string' || parsed.host.length > 253 || !OVERRIDE_HOST_RE.test(parsed.host)
      || typeof parsed.user !== 'string' || !OVERRIDE_USER_RE.test(parsed.user)
      || !Number.isInteger(parsed.port) || (parsed.port as number) < 1 || (parsed.port as number) > 65535
      || typeof parsed.hostKey !== 'string' || !HOST_KEY_RE.test(parsed.hostKey)) return undefined;
    return { host: parsed.host, port: parsed.port as number, user: parsed.user, hostKey: parsed.hostKey };
  } catch { return undefined; }
}

/** A-side: `(signal) => PeerSshEndpoint`, throwing an Error whose message is an SSH reason. */
export function createLocalEndpoint(deps: PeerSshLocalDeps = {}): (signal: AbortSignal) => Promise<PeerSshEndpoint> {
  const env = deps.env ?? process.env;
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  return async signal => {
    const override = e2ePeerSshOverride(env);
    if (override) {
      await (deps.selfTest ?? ((e, s) => defaultSelfTest(e, s, deps)))(override, signal);
      return override;
    }

    const info = (deps.user ?? userInfo)();
    if (info.homedir !== (deps.home ?? homedir)()) {
      warn('peer ssh: the account home directory differs from $HOME; sshd reads authorized_keys from the account home');
    }

    let port = SSHD_PORT;
    let hostKey: string;
    if (deps.sshd) {
      ({ port, hostKey } = await deps.sshd.ensure(signal));
    } else {
      const banner = await (deps.probeBanner ?? probeSshBanner)('127.0.0.1', SSHD_PORT, signal);
      if (banner !== 'ok') throw fail('ssh_remote_login_off');
      try {
        const raw = await (deps.readHostKey ?? (() => readFile(HOST_KEY_PATH, 'utf8')))();
        hostKey = raw.trim().split(/\s+/).slice(0, 2).join(' ');
      } catch { throw fail('ssh_remote_login_off'); }
    }
    if (!HOST_KEY_RE.test(hostKey)) throw fail('ssh_remote_login_off');

    let name: string;
    try { name = (await (deps.localHostName ?? runScutil)()).trim(); } catch { throw fail('ssh_unreachable'); }
    if (!LOCAL_HOST_RE.test(name)) throw fail('ssh_unreachable');

    const endpoint: PeerSshEndpoint = { host: `${name}.local`, port, user: info.username, hostKey };
    await (deps.selfTest ?? ((e, s) => defaultSelfTest(e, s, deps)))(endpoint, signal);
    return endpoint;
  };
}

export interface PeerSshPreflightDeps {
  lookup?: (host: string) => Promise<unknown>;
  connectTcp?: (host: string, port: number, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

function tcpConnect(host: string, port: number, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) reject(error); else resolve();
    };
    const onAbort = (): void => finish(new Error('aborted'));
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) return onAbort();
    socket.once('connect', () => finish());
    socket.once('error', error => finish(error));
  });
}

/** B-side: before redeeming, confirm A's `.local` name resolves and its sshd accepts TCP. */
export async function preflightPeerSsh(host: string, port: number, signal: AbortSignal, deps: PeerSshPreflightDeps = {}): Promise<void> {
  try {
    await (deps.lookup ?? (name => lookup(name)))(host);
    await (deps.connectTcp ?? ((h, p, s) => tcpConnect(h, p, s, deps.timeoutMs ?? 5000)))(host, port, signal);
  } catch {
    throw fail('ssh_unreachable');
  }
}

/** Check-only reason: sshd on this computer still allows stream-local forwarding, which the link refuses to rely on. */
export type RemoteLoginReason = SshReason | 'ssh_stream_local_allowed';
export type RemoteLoginCheck = { ok: true } | { ok: false; reason: RemoteLoginReason };

/**
 * Owner-facing readiness check for Add computer: the same probe and throwaway-key self-test that mints an invitation,
 * reported as a fixed reason the UI keys its directions on. A detailed `reason: detail` message keys on its reason;
 * anything else (including an abort) reads as unreachable.
 */
export async function checkRemoteLogin(localEndpoint: (signal: AbortSignal) => Promise<unknown>, signal: AbortSignal): Promise<RemoteLoginCheck> {
  try { await localEndpoint(signal); return { ok: true }; } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === STREAM_LOCAL_MESSAGE) return { ok: false, reason: 'ssh_stream_local_allowed' };
    const reason = message.split(':', 1)[0]!;
    return { ok: false, reason: (SSH_REASON_SET.has(reason) ? reason : 'ssh_unreachable') as SshReason };
  }
}
