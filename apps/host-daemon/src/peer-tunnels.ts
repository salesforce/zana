import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { sshBaseArgs } from './remote-fs.js';
import { HostCommandError } from './host-command-error.js';
import { privateKeyFile } from './ssh-keys.js';

const DEFAULT_RECONNECT_MS = 1000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;
const MAX_LOCAL_TUNNELS = 16;
const MAX_PEER_LINKS = 32;
const READY = 'ZCC-PEER-TUNNEL-READY';
/** OpenSSH's own report, under ExitOnForwardFailure, that the remote listen port is taken. */
const FORWARD_FAILED_RE = /remote port forwarding failed/i;

/** Classify this process's own SSH failure so the caller can retry on another port. */
export function peerTunnelFailure(stderr: string): HostCommandError {
  const message = stderr.trim() || 'SSH tunnel closed before connecting';
  return FORWARD_FAILED_RE.test(stderr)
    ? new HostCommandError('peer_tunnel_port_unavailable', message)
    : new HostCommandError('peer_tunnel_failed', message);
}
type Tunnel = {
  localPort: number; remotePort: number;
  process?: ChildProcess; pending?: Promise<void>; timer?: ReturnType<typeof setTimeout>; stopped: boolean;
};

/** One tunnel per SSH identity: reopening on new ports replaces the old forward. */
function tunnelKey(remote: ProjectRemote): string {
  return JSON.stringify([remote.host, remote.user, remote.proxyJump]);
}

/** One owned SSH connection per machine; reconnects until its daemon shuts down. */
export class PeerTunnels {
  private readonly tunnels = new Map<string, Tunnel>();
  private readonly locals = new Set<LocalTunnel>();
  private readonly links = new Set<PeerLink>();
  private opening = 0;
  /** In-flight opens count toward the live caps so concurrent opens cannot all pass the check. */
  private openingLocals = 0;
  private openingLinks = 0;
  constructor(private readonly spawnProcess: typeof spawn = spawn, private readonly sshBinary = 'ssh') {}

  async open(remote: ProjectRemote, localPort: number, remotePort: number): Promise<void> {
    if (![localPort, remotePort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
      throw new Error('Invalid peer tunnel port');
    }
    const key = tunnelKey(remote);
    const prior = this.tunnels.get(key);
    const samePorts = prior?.localPort === localPort && prior.remotePort === remotePort;
    if (samePorts && prior?.process && !prior.process.killed) return prior.pending;
    if (prior) this.stop(prior);
    if (!prior && this.tunnels.size >= 64) throw new Error('Too many peer SSH tunnels');
    const tunnel: Tunnel = { localPort, remotePort, stopped: false };
    this.tunnels.set(key, tunnel);
    const connect = (): Promise<void> => new Promise((resolve, reject) => {
      // A dedicated connection owns the forwarding: closing it must remove -R.
      const proc = this.spawnProcess('ssh', [
        '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3', '-R', `127.0.0.1:${remotePort}:127.0.0.1:${localPort}`,
        ...sshBaseArgs(remote), `printf '${READY}\\n'; exec sleep 2147483647`
      ], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      tunnel.process = proc;
      let ready = false, output = '', error = '', settled = false;
      const finish = (failure?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timeout);
        failure ? reject(failure) : resolve();
      };
      const timeout = setTimeout(() => { finish(new HostCommandError('peer_tunnel_failed', 'SSH tunnel timed out')); this.kill(proc); }, 30_000);
      proc.stdout?.on('data', chunk => {
        output = (output + chunk).slice(-4096);
        if (output.includes(READY)) { ready = true; finish(); }
      });
      proc.stderr?.on('data', chunk => { error = (error + chunk).slice(-4096); });
      proc.once('error', failure => { finish(new HostCommandError('peer_tunnel_failed', failure.message)); });
      proc.once('close', () => {
        tunnel.process = undefined;
        finish(peerTunnelFailure(error));
        if (ready && !tunnel.stopped) {
          const retry = () => { tunnel.timer = setTimeout(() => {
            tunnel.timer = undefined;
            tunnel.pending = connect();
            void tunnel.pending.catch(() => { if (!tunnel.stopped) retry(); });
          }, 3000); };
          retry();
        }
      });
    });
    tunnel.pending = connect();
    try { await tunnel.pending; }
    catch (error) { this.stop(tunnel); if (this.tunnels.get(key) === tunnel) this.tunnels.delete(key); throw error; }
  }

  private stop(tunnel: Tunnel): void {
    tunnel.stopped = true;
    clearTimeout(tunnel.timer);
    if (tunnel.process) this.kill(tunnel.process);
  }

  private kill(proc: ChildProcess): void {
    // Also reap ProxyCommand children; killing only ssh can strand a tunnel.
    if (proc.pid && process.platform !== 'win32') {
      try { process.kill(-proc.pid, 'SIGKILL'); return; } catch { /* already gone */ }
    }
    proc.kill('SIGKILL');
  }

  remove(remote: ProjectRemote, localPort: number, remotePort: number): void {
    const key = tunnelKey(remote);
    const tunnel = this.tunnels.get(key);
    // A newer open on other ports already replaced this forward; leave it running.
    if (!tunnel || tunnel.localPort !== localPort || tunnel.remotePort !== remotePort) return;
    this.stop(tunnel);
    this.tunnels.delete(key);
  }

  /** Stop this identity's tunnel whatever its ports; true when one was running. */
  closeFor(remote: ProjectRemote): boolean {
    const key = tunnelKey(remote);
    const tunnel = this.tunnels.get(key);
    if (!tunnel) return false;
    this.stop(tunnel);
    this.tunnels.delete(key);
    return true;
  }

  /**
   * Local forward to an explicitly registered endpoint's loopback app server. The endpoint's
   * host key is pinned in a private known_hosts file; user ssh config, agent forwarding,
   * multiplexing and host-key learning are all disabled. SSH supplies only the route.
   */
  async openLocal(endpoint: PinnedSshEndpoint, remotePort: number, options: { signal?: AbortSignal; timeoutMs?: number; localPort?: number; onClose?: () => void } = {}): Promise<LocalTunnel> {
    options.signal?.throwIfAborted();
    const pinned = validatePinnedEndpoint(endpoint);
    if (!validPort(remotePort) || (options.localPort !== undefined && !validPort(options.localPort))) throw new Error('Invalid peer tunnel port');
    if (this.locals.size + this.openingLocals >= MAX_LOCAL_TUNNELS) throw new Error('Too many peer SSH tunnels');
    if (this.opening >= 4) throw new Error('Too many concurrent peer SSH tunnels');
    this.opening++; this.openingLocals++;
    let directory: string | undefined;
    let proc: ChildProcess | undefined;
    const cleanup = async () => { if (proc) this.kill(proc); if (directory) await rm(directory, { recursive: true, force: true }); };
    try {
      directory = await mkdtemp(join(tmpdir(), 'zcc-peer-ssh-'));
      await chmod(directory, 0o700);
      const knownHosts = join(directory, 'known_hosts');
      await writeFile(knownHosts, knownHostsLine(pinned), { mode: 0o600, flag: 'wx' });
      const localPort = options.localPort ?? await freeLoopbackPort();
      const args = pinnedSshArgs(pinned, knownHosts, localPort, remotePort);
      proc = this.spawnProcess(this.sshBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: false, env: sshEnv() });
      const child = proc;
      await new Promise<void>((resolve, reject) => {
        let output = '', settled = false;
        const finish = (failure?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
          if (failure) reject(failure); else resolve();
        };
        const abort = () => finish(new Error('SSH tunnel cancelled'));
        const timer = setTimeout(() => finish(new Error('SSH tunnel timed out')), options.timeoutMs ?? 20_000);
        options.signal?.addEventListener('abort', abort, { once: true });
        child.stdout?.on('data', chunk => { output = (output + chunk).slice(-4096); if (output.includes(READY)) finish(); });
        // stderr is drained but never surfaced: it can contain host or account details.
        child.stderr?.on('data', () => undefined);
        child.once('error', () => finish(new Error('SSH tunnel could not start')));
        child.once('close', () => finish(new Error('SSH tunnel closed before connecting')));
      });
      const handle: LocalTunnel = {
        localPort,
        url: `http://127.0.0.1:${localPort}/`,
        closed: false,
        close: async () => {
          if (handle.closed) return;
          handle.closed = true; this.locals.delete(handle);
          try { await cleanup(); } finally { options.onClose?.(); }
        }
      };
      child.once('close', () => { if (!handle.closed) void handle.close(); });
      this.locals.add(handle);
      return handle;
    } catch (error) {
      await cleanup();
      throw error;
    } finally { this.opening--; this.openingLocals--; }
  }

  /**
   * One ssh to a peer's OS sshd carrying `-L` (our loopback -> their forwarder) and `-R` (their
   * loopback -> our forwarder). Resolves once the `-L` side reaches the peer's forwarder; later drops
   * reconnect on the same local port with bounded backoff and report through `onState`. Failures are
   * reduced to a fixed {@link PeerSshFailure}; ssh's own text is never surfaced.
   */
  async openPeerLink(input: PeerLinkInput, onState: (up: boolean, failure?: PeerSshFailure) => void, options: PeerLinkOptions = {}): Promise<PeerLink> {
    options.signal?.throwIfAborted();
    const pinned = validatePinnedEndpoint({ ...input.endpoint, identityFile: undefined });
    // peerLinkSshArgs forces HostKeyAlgorithms=ssh-ed25519, so any other pinned type could never connect.
    if (!pinned.hostKey.startsWith('ssh-ed25519 ')) throw new Error('Invalid pinned SSH endpoint');
    for (const port of [input.listenPort, input.targetPort, input.reversePort, ...(input.localPort === undefined ? [] : [input.localPort])]) {
      if (!validPort(port)) throw new Error('Invalid peer tunnel port');
    }
    if (this.links.size + this.openingLinks >= MAX_PEER_LINKS) throw new Error('Too many peer SSH tunnels');
    if (this.opening >= 4) throw new Error('Too many concurrent peer SSH tunnels');
    this.opening++; this.openingLinks++;
    let directory: string | undefined;
    let current: ChildProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0, closed = false, wasUp = false;
    const killCurrent = () => { if (current) this.kill(current); current = undefined; };
    const cleanup = async () => { clearTimeout(timer); killCurrent(); if (directory) await rm(directory, { recursive: true, force: true }); };
    try {
      directory = await mkdtemp(join(tmpdir(), 'zcc-peer-link-'));
      await chmod(directory, 0o700);
      const knownHosts = join(directory, 'known_hosts');
      const identityFile = join(directory, 'id_ed25519');
      await writeFile(knownHosts, knownHostsLine(pinned), { mode: 0o600, flag: 'wx' });
      await writeFile(identityFile, privateKeyFile(input.seed), { mode: 0o600, flag: 'wx' });
      const localPort = input.localPort ?? await freeLoopbackPort();
      const args = peerLinkSshArgs({ ...input, endpoint: pinned, localPort }, identityFile, knownHosts);
      const probe = options.probe ?? probePeerForwarder;
      const pollMs = options.readyPollMs ?? 200;

      /** Spawn ssh and wait until the forwarder answers through `-L`; rejects with a fixed reason. */
      const connect = (timeoutMs: number, signal?: AbortSignal): Promise<void> => new Promise<void>((resolve, reject) => {
        const proc = this.spawnProcess(this.sshBinary, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, shell: false, env: sshEnv() });
        current = proc;
        let error = '', settled = false, ready = false, poll: ReturnType<typeof setTimeout> | undefined;
        const finish = (failure?: PeerSshFailure) => {
          if (settled) return;
          settled = true; clearTimeout(poll); clearTimeout(deadline); signal?.removeEventListener('abort', abort);
          if (failure) { this.kill(proc); if (current === proc) current = undefined; reject(peerSshError(failure)); } else { ready = true; resolve(); }
        };
        const abort = () => finish(classifyPeerSshFailure(error));
        const deadline = setTimeout(() => finish(classifyPeerSshFailure(error)), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true });
        // stdout is unused under -N; stderr is drained for classification only.
        proc.stdout?.on('data', () => undefined);
        proc.stderr?.on('data', chunk => { error = (error + chunk).slice(-4096); });
        proc.once('error', () => finish('ssh_unreachable'));
        proc.once('close', () => {
          if (!settled) { finish(classifyPeerSshFailure(error)); return; }
          if (!ready) return;
          if (current === proc) current = undefined;
          if (!closed) onDrop(classifyPeerSshFailure(error));
        });
        const tick = () => {
          if (settled) return;
          void probe(localPort).then(ok => { if (ok) finish(); else poll = setTimeout(tick, pollMs); }, () => { poll = setTimeout(tick, pollMs); });
        };
        poll = setTimeout(tick, pollMs);
      });

      const onDrop = (failure: PeerSshFailure) => {
        wasUp = false; onState(false, failure); retry();
      };
      const retry = () => {
        if (closed || timer) return;
        const delay = Math.min((options.reconnectMs ?? DEFAULT_RECONNECT_MS) * 2 ** Math.min(attempts++, 5), MAX_RECONNECT_BACKOFF_MS);
        timer = setTimeout(() => {
          timer = undefined;
          if (closed) return;
          connect(options.timeoutMs ?? 20_000).then(() => { attempts = 0; wasUp = true; onState(true); }, failure => {
            onState(false, (failure as HostCommandError).code as PeerSshFailure); retry();
          });
        }, delay);
        timer.unref?.();
      };

      await connect(options.timeoutMs ?? 20_000, options.signal);
      wasUp = true;
      const handle: PeerLink = {
        localPort, url: `http://127.0.0.1:${localPort}/`, closed: false,
        get up() { return wasUp; },
        close: async () => {
          if (closed) return;
          closed = true; handle.closed = true; wasUp = false; this.links.delete(handle);
          await cleanup();
        }
      };
      this.links.add(handle);
      return handle;
    } catch (error) {
      closed = true;
      await cleanup();
      throw error;
    } finally { this.opening--; this.openingLinks--; }
  }

  close(): void {
    for (const tunnel of this.tunnels.values()) this.stop(tunnel);
    this.tunnels.clear();
    for (const local of [...this.locals]) void local.close();
    for (const link of [...this.links]) void link.close();
  }
}

export const PEER_SSH_FAILURES = [
  'ssh_remote_login_off', 'ssh_unreachable', 'ssh_auth_refused', 'ssh_forwarding_refused', 'ssh_host_key_mismatch'
] as const;
/** Mirrors the server's SSH_REASONS; the daemon must not import server code. */
export type PeerSshFailure = (typeof PEER_SSH_FAILURES)[number];

export interface PeerLinkInput {
  endpoint: PinnedSshEndpoint;
  /** base64url ed25519 seed of the key presented to the peer's sshd. */
  seed: string;
  /** Peer loopback port that `-R` listens on. */
  listenPort: number;
  /** Peer forwarder port that `-L` reaches. */
  targetPort: number;
  /** Our own forwarder port that `-R` delivers to. */
  reversePort: number;
  /** Reuse the same local port across reopens. */
  localPort?: number;
}
export interface PeerLinkOptions {
  signal?: AbortSignal;
  /** Per-attempt readiness deadline. */
  timeoutMs?: number;
  readyPollMs?: number;
  reconnectMs?: number;
  /** Test seam: true once the peer's forwarder answers through the local forward. */
  probe?: (localPort: number) => Promise<boolean>;
}
export interface PeerLink { localPort: number; url: string; closed: boolean; readonly up: boolean; close(): Promise<void> }

function peerSshError(code: PeerSshFailure): HostCommandError {
  return new HostCommandError(code, code);
}

/** Map ssh's stderr to a fixed code; the text itself is never surfaced (it can carry host/account details). */
export function classifyPeerSshFailure(stderr: string): PeerSshFailure {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key for .* has changed/i.test(stderr)) return 'ssh_host_key_mismatch';
  if (/Permission denied|Too many authentication failures|no mutual signature/i.test(stderr)) return 'ssh_auth_refused';
  if (/remote port forwarding failed|administratively prohibited|open failed|Could not request local forwarding|cannot listen to port|bind(?: \[[^\]]*\]:\d+)?: Address already in use/i.test(stderr)) return 'ssh_forwarding_refused';
  if (/Connection refused/i.test(stderr)) return 'ssh_remote_login_off';
  return 'ssh_unreachable';
}

/** Ready when the peer's forwarder itself answers (its 403 `path is not allowed`), not just a bound local port. */
function probePeerForwarder(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 1500 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body = (body + chunk).slice(0, 512); });
      res.on('end', () => resolve(res.statusCode === 403 && body.includes('path is not allowed')));
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

const sshEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.SSH_AUTH_SOCK;
  return env;
};

const knownHostsLine = (pinned: PinnedSshEndpoint): string =>
  `${pinned.port === 22 ? pinned.host : `[${pinned.host}]:${pinned.port}`} ${pinned.hostKey}\n`;

/** Fixed argv for the persistent peer link: `-N`, no command, both forwards, only our own key. */
export function peerLinkSshArgs(input: Omit<PeerLinkInput, 'localPort'> & { localPort: number }, identityFile: string, knownHostsFile: string): string[] {
  const { endpoint } = input;
  return [
    '-F', '/dev/null', '-N',
    '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-i', identityFile,
    '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsFile}`,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no',
    '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'ControlPath=none',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${input.localPort}:127.0.0.1:${input.targetPort}`,
    '-R', `127.0.0.1:${input.listenPort}:127.0.0.1:${input.reversePort}`,
    '-p', String(endpoint.port), '-l', endpoint.user, '--', endpoint.host
  ];
}

export interface PinnedSshEndpoint {
  host: string;
  port: number;
  user: string;
  /** One known_hosts key: `<type> <base64>`. */
  hostKey: string;
  identityFile?: string;
}
export interface LocalTunnel { localPort: number; url: string; closed: boolean; close(): Promise<void> }

const SSH_HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const SSH_USER = /^[A-Za-z_][A-Za-z0-9._-]{0,31}$/;
const SSH_HOST_KEY = /^(ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|ssh-rsa) [A-Za-z0-9+/]{16,4096}={0,2}$/;
const IDENTITY_FILE = /^\/[A-Za-z0-9._/-]{1,1023}$/;
const validPort = (port: number) => Number.isInteger(port) && port > 0 && port <= 65535;

export function validatePinnedEndpoint(endpoint: PinnedSshEndpoint): PinnedSshEndpoint {
  if (!endpoint || typeof endpoint !== 'object' || typeof endpoint.host !== 'string' || !SSH_HOST.test(endpoint.host) ||
    typeof endpoint.user !== 'string' || !SSH_USER.test(endpoint.user) || !validPort(endpoint.port) ||
    typeof endpoint.hostKey !== 'string' || !SSH_HOST_KEY.test(endpoint.hostKey) ||
    (endpoint.identityFile !== undefined && (typeof endpoint.identityFile !== 'string' || !IDENTITY_FILE.test(endpoint.identityFile) || endpoint.identityFile.includes('..')))) {
    throw new Error('Invalid pinned SSH endpoint');
  }
  return { host: endpoint.host, port: endpoint.port, user: endpoint.user, hostKey: endpoint.hostKey,
    ...(endpoint.identityFile ? { identityFile: endpoint.identityFile } : {}) };
}

/** Fixed argv, never a shell string. `-F /dev/null` keeps user config from injecting ProxyCommand/LocalCommand. */
export function pinnedSshArgs(endpoint: PinnedSshEndpoint, knownHostsFile: string, localPort: number, remotePort: number): string[] {
  return [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsFile}`,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no',
    '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'Tunnel=no',
    '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    ...(endpoint.identityFile ? ['-o', 'IdentitiesOnly=yes', '-i', endpoint.identityFile] : []),
    '-p', String(endpoint.port), '-l', endpoint.user,
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    '--', endpoint.host, `printf '${READY}\\n'; exec sleep 2147483647`
  ];
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no loopback port')));
    });
  });
}
