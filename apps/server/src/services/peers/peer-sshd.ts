import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants as fsc } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { generateSeed, privateKeyFile, publicKeyLine } from '@zana-ai/zcc-host-daemon/ssh-keys';
import { probeSshBanner, type BannerResult } from './peer-ssh-local.js';

/**
 * Zana's own unprivileged sshd for computer connections. It runs the system `/usr/sbin/sshd` as the signed-in user from
 * `<dataDir>/peer-sshd` with its own host key, its own authorized_keys and a config that refuses everything but loopback
 * TCP forwarding, so pairing never needs Remote Login, an administrator, or edits to `~/.ssh` / `/etc/ssh`.
 *
 * Why not the system sshd: per-key `authorized_keys` options cannot refuse Unix-socket forwarding, and stock macOS sshd
 * allows it, so a paired key there could reach any socket the user owns. Only an sshd-wide setting closes that.
 */

const SSHD_BIN = '/usr/sbin/sshd';
const START_TIMEOUT_MS = 5000;
const RESTART_MIN_MS = 1000;
const RESTART_MAX_MS = 60_000;
const LOG_CAP = 16_384;
const HOST_KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;
const USER_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

export interface PeerSshdProcess {
  pid: number | undefined;
  exited: Promise<{ code: number | null; log: string }>;
  kill(): void;
}

export interface PeerSshdOptions {
  /** `<dataDir>/peer-sshd`; created 0700. */
  directory: string;
  /** Defaults to the signed-in account; sshd only ever accepts this user. */
  user?: string;
  spawnSshd?: (args: string[]) => PeerSshdProcess;
  /** `sshd -t -f <config>`; resolves with stderr on rejection. */
  checkConfig?: (configPath: string) => Promise<string | null>;
  probeBanner?: (host: string, port: number, signal: AbortSignal) => Promise<BannerResult>;
  /** A free TCP port on every interface. */
  freePort?: () => Promise<number>;
  /** argv of a live pid, for stale-pidfile cleanup; undefined when not running. */
  commandOf?: (pid: number) => Promise<string | undefined>;
  kill?: (pid: number) => void;
  warn?: (message: string) => void;
  startTimeoutMs?: number;
}

export interface PeerSshdEndpoint { port: number; hostKey: string }

const fail = (): Error => new Error('ssh_remote_login_off');
const isCode = (error: unknown, ...codes: string[]) => codes.includes((error as NodeJS.ErrnoException)?.code ?? '');
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function anyInterfaceFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

function defaultSpawnSshd(args: string[]): PeerSshdProcess {
  const child = spawn(SSHD_BIN, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let log = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { log = (log + chunk).slice(-LOG_CAP); });
  const exited = new Promise<{ code: number | null; log: string }>(resolve => {
    child.once('error', error => resolve({ code: null, log: `${log}\n${error.message}` }));
    child.once('close', code => resolve({ code, log }));
  });
  return {
    pid: child.pid,
    exited,
    // Own process group: SIGKILL the listener and every per-connection child it forked.
    kill: () => {
      if (child.pid !== undefined) { try { process.kill(-child.pid, 'SIGKILL'); return; } catch { /* group gone */ } }
      child.kill('SIGKILL');
    }
  };
}

function defaultCheckConfig(configPath: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile(SSHD_BIN, ['-t', '-f', configPath], { timeout: 5000, maxBuffer: 16_384 }, (error, _stdout, stderr) =>
      resolve(error ? String(stderr || error.message).slice(0, 2048) : null));
  });
}

function defaultCommandOf(pid: number): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'command='], { timeout: 3000, maxBuffer: 16_384 }, (error, stdout) =>
      resolve(error ? undefined : stdout.trim() || undefined));
  });
}

export class PeerSshd {
  readonly authorizedKeysPath: string;
  private readonly dir: string;
  private readonly configPath: string;
  private readonly user: string;
  private readonly warn: (message: string) => void;
  private chain: Promise<unknown> = Promise.resolve();
  private proc: PeerSshdProcess | undefined;
  private endpoint: PeerSshdEndpoint | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private restartDelay = RESTART_MIN_MS;
  private disposed = false;

  constructor(private readonly options: PeerSshdOptions) {
    this.dir = options.directory;
    this.authorizedKeysPath = join(this.dir, 'authorized_keys');
    this.configPath = join(this.dir, 'sshd_config');
    this.user = options.user ?? userInfo().username;
    if (!USER_RE.test(this.user)) throw new Error('invalid sshd user');
    this.warn = options.warn ?? (message => console.warn(message));
  }

  /** Starts sshd once (serialized) and resolves its port and pinned host key. Throws `ssh_remote_login_off` when it cannot run. */
  ensure(signal?: AbortSignal): Promise<PeerSshdEndpoint> {
    const run = this.chain.then(() => this.start(signal));
    this.chain = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.proc?.kill();
    this.proc = undefined;
    this.endpoint = undefined;
  }

  private async start(signal?: AbortSignal): Promise<PeerSshdEndpoint> {
    if (this.disposed) throw fail();
    if (this.proc && this.endpoint) return this.endpoint;
    await this.ensureDir();
    const hostKey = await this.ensureHostKey();
    await this.ensureAuthorizedKeys();
    await this.killStale();
    let port = await this.savedPort();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (port === undefined) { port = await (this.options.freePort ?? anyInterfaceFreePort)(); await this.savePort(port); }
      const result = await this.launch(port, signal);
      if (result === 'ok') { this.endpoint = { port, hostKey }; this.restartDelay = RESTART_MIN_MS; return this.endpoint; }
      // A remembered port another program took is replaced once; peers re-pair to the new one.
      if (result !== 'port_in_use') break;
      port = undefined;
    }
    throw fail();
  }

  private async launch(port: number, signal?: AbortSignal): Promise<'ok' | 'port_in_use' | 'failed'> {
    await this.writeAtomic(this.configPath, this.config(port));
    const rejected = await (this.options.checkConfig ?? defaultCheckConfig)(this.configPath);
    if (rejected !== null) { this.warn(`peer sshd: config rejected: ${rejected}`); return 'failed'; }
    const proc = (this.options.spawnSshd ?? defaultSpawnSshd)(['-D', '-e', '-f', this.configPath]);
    let exit: { code: number | null; log: string } | undefined;
    void proc.exited.then(result => { exit = result; });
    const deadline = Date.now() + (this.options.startTimeoutMs ?? START_TIMEOUT_MS);
    const probe = this.options.probeBanner ?? probeSshBanner;
    while (Date.now() < deadline && !signal?.aborted) {
      if (exit) break;
      if (await probe('127.0.0.1', port, signal ?? new AbortController().signal) === 'ok' && !exit) {
        this.proc = proc;
        void proc.exited.then(result => this.onExit(proc, result));
        return 'ok';
      }
      await sleep(100);
    }
    proc.kill();
    const log = exit?.log ?? '';
    if (/Address already in use|Cannot bind any address/i.test(log)) return 'port_in_use';
    this.warn(`peer sshd: did not start${log ? `: ${log.trim().slice(-512)}` : ''}`);
    return 'failed';
  }

  /** Keep established links reachable: restart with backoff after an unexpected exit. */
  private onExit(proc: PeerSshdProcess, result: { code: number | null; log: string }): void {
    if (this.proc !== proc) return;
    this.proc = undefined;
    this.endpoint = undefined;
    if (this.disposed) return;
    this.warn(`peer sshd: exited (${result.code ?? 'signal'}); restarting`);
    const delay = this.restartDelay;
    this.restartDelay = Math.min(this.restartDelay * 2, RESTART_MAX_MS);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.ensure().catch(() => undefined);
    }, delay);
    this.restartTimer.unref?.();
  }

  private config(port: number): string {
    // StrictModes is off because sshd's path walk rejects ordinary data directories (e.g. group-writable ancestors);
    // ensureDir enforces the equivalent on the files sshd reads: a 0700 directory and 0600 files owned by this user.
    return [
      `Port ${port}`, 'ListenAddress 0.0.0.0', 'ListenAddress ::',
      `HostKey ${join(this.dir, 'host_key')}`, `PidFile ${join(this.dir, 'sshd.pid')}`,
      `AuthorizedKeysFile ${this.authorizedKeysPath}`, `AllowUsers ${this.user}`,
      'AuthenticationMethods publickey', 'PubkeyAuthentication yes', 'PasswordAuthentication no',
      'KbdInteractiveAuthentication no', 'UsePAM no', 'StrictModes no',
      'AllowTcpForwarding yes', 'AllowStreamLocalForwarding no', 'GatewayPorts no',
      'PermitListen 127.0.0.1:*', 'PermitOpen 127.0.0.1:*',
      'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTunnel no', 'PermitTTY no',
      'PermitUserRC no', 'PermitUserEnvironment no', 'ForceCommand /usr/bin/false',
      'LoginGraceTime 20', 'MaxAuthTries 3', 'ClientAliveInterval 15', 'ClientAliveCountMax 3', ''
    ].join('\n');
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const info = await lstat(this.dir);
    if (info.isSymbolicLink() || !info.isDirectory() || !ownedByUs(info.uid)) throw fail();
    if ((info.mode & 0o077) !== 0) await chmod(this.dir, 0o700);
  }

  /** The host key is minted once and never rotated: every paired computer pins it. */
  private async ensureHostKey(): Promise<string> {
    const keyPath = join(this.dir, 'host_key');
    const pubPath = `${keyPath}.pub`;
    const existing = await readFile(pubPath, 'utf8').then(text => text.trim().split(/\s+/).slice(0, 2).join(' '), () => undefined);
    const keyPresent = await lstat(keyPath).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
    if (existing && HOST_KEY_RE.test(existing) && keyPresent) return existing;
    const seed = generateSeed();
    const pub = publicKeyLine(seed);
    await this.writeAtomic(keyPath, privateKeyFile(seed, 'zana-peer-sshd'));
    await this.writeAtomic(pubPath, `${pub} zana-peer-sshd\n`);
    return pub;
  }

  private async ensureAuthorizedKeys(): Promise<void> {
    try {
      const handle = await open(this.authorizedKeysPath, fsc.O_WRONLY | fsc.O_CREAT | fsc.O_EXCL, 0o600);
      await handle.close();
    } catch (error) { if (!isCode(error, 'EEXIST')) throw error; }
  }

  /** An sshd left by a crashed app still holds the port; kill it only when its argv names this config. */
  private async killStale(): Promise<void> {
    const pidPath = join(this.dir, 'sshd.pid');
    const pid = Number((await readFile(pidPath, 'utf8').catch(() => '')).trim());
    if (!Number.isInteger(pid) || pid <= 1) return;
    const command = await (this.options.commandOf ?? defaultCommandOf)(pid);
    if (command?.includes(SSHD_BIN) && command.includes(this.configPath)) {
      try { (this.options.kill ?? (p => process.kill(p, 'SIGTERM')))(pid); } catch { /* already gone */ }
      await sleep(200);
    }
    await unlink(pidPath).catch(() => undefined);
  }

  private async savedPort(): Promise<number | undefined> {
    const port = Number((await readFile(join(this.dir, 'port'), 'utf8').catch(() => '')).trim());
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
  }

  private savePort(port: number): Promise<void> {
    return this.writeAtomic(join(this.dir, 'port'), `${port}\n`);
  }

  private async writeAtomic(path: string, text: string): Promise<void> {
    const tmp = `${path}.zana-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
      const handle = await open(tmp, 'wx', 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      await rename(tmp, path);
    } catch (error) {
      await unlink(tmp).catch(() => undefined);
      throw error;
    }
  }
}

function ownedByUs(uid: number): boolean {
  const me = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return me === undefined || uid === me;
}
