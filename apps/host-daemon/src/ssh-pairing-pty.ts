import { EventEmitter } from 'node:events';
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import * as pty from 'node-pty';
import {
  isLoopbackOrigin,
  isPairingHostIdToken,
  isPairingJoinCode,
  localListenPort,
  sanitizePairingServerUrl,
  sanitizeSshHost,
  sshPairingArgv,
  sshPublicPairingArgv,
  type SshPairingArgv
} from '@zana-ai/zcc-domain/machine-pairing';

const nodeRequire = createRequire(import.meta.url);
const BACKLOG_MAX_CHARS = 256_000;
const WRITE_MAX_CHARS = 8_192;

export interface PairingPtyHandle {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void;
}

export type PairingSpawn = (
  command: string,
  args: string[],
  options: { cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; name: string }
) => PairingPtyHandle;

export interface SshPairingStatus {
  running: boolean;
  sshHost: string | null;
  backlog: string;
  exitCode: number | null;
}

export function authorizeSshPairing(
  input: unknown,
  origins: { localServerUrl: string; publicServerUrl?: string | null }
): { ok: true; argv: SshPairingArgv; sshHost: string; cols: number; rows: number } | { ok: false; message: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, message: 'Choose a valid SSH host' };
  }
  const body = input as Record<string, unknown>;
  if ('command' in body || 'args' in body || 'remote' in body) {
    return { ok: false, message: 'Pairing spawn does not accept a command string' };
  }
  const host = typeof body.sshHost === 'string' ? sanitizeSshHost(body.sshHost) : null;
  if (!host) return { ok: false, message: 'Choose a valid SSH host' };
  if (typeof body.joinCode !== 'string' || !isPairingJoinCode(body.joinCode)) {
    return { ok: false, message: 'Join code is invalid' };
  }
  if (typeof body.hostId !== 'string' || !isPairingHostIdToken(body.hostId)) {
    return { ok: false, message: 'Host id is invalid' };
  }
  const publicServer = origins.publicServerUrl
    ? sanitizePairingServerUrl(origins.publicServerUrl)
    : null;
  const argv = publicServer && !isLoopbackOrigin(publicServer)
    ? sshPublicPairingArgv({
      sshHost: host,
      serverUrl: publicServer,
      joinCode: body.joinCode,
      hostId: body.hostId
    })
    : (() => {
      const localPort = localListenPort(origins.localServerUrl);
      if (localPort === null) return null;
      return sshPairingArgv({
        sshHost: host,
        localListenPort: localPort,
        joinCode: body.joinCode,
        hostId: body.hostId
      });
    })();
  if (!argv) return { ok: false, message: 'Could not build the SSH pairing command' };
  return {
    ok: true,
    argv,
    sshHost: host,
    cols: clampDim(body.cols, 80, 20, 400),
    rows: clampDim(body.rows, 24, 8, 200)
  };
}

function clampDim(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function ensureNodePtySpawnHelperExecutable(): void {
  if (process.platform === 'win32') return;
  const packageRoot = dirname(nodeRequire.resolve('node-pty/package.json'));
  if (packageRoot.includes(`${sep}app.asar${sep}`)) return;
  const helper = join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  if (existsSync(helper)) chmodSync(helper, 0o755);
}

function defaultSpawn(
  command: string,
  args: string[],
  options: { cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv; name: string }
): PairingPtyHandle {
  ensureNodePtySpawnHelperExecutable();
  const handle = pty.spawn(command, args, options);
  return {
    pid: handle.pid,
    write: (data) => handle.write(data),
    resize: (cols, rows) => handle.resize(cols, rows),
    kill: () => handle.kill(),
    onData: (cb) => { handle.onData(cb); },
    onExit: (cb) => { handle.onExit((event) => cb({ exitCode: event.exitCode, signal: event.signal })); }
  };
}

export class SshPairingSession extends EventEmitter {
  private proc: PairingPtyHandle | null = null;
  private sshHost: string | null = null;
  private backlog = '';
  private exitCode: number | null = null;
  private readonly spawnFn: PairingSpawn;

  constructor(spawnFn: PairingSpawn = defaultSpawn) {
    super();
    this.spawnFn = spawnFn;
  }

  status(): SshPairingStatus {
    return {
      running: this.proc !== null,
      sshHost: this.sshHost,
      backlog: this.backlog,
      exitCode: this.exitCode
    };
  }

  start(input: { argv: SshPairingArgv; sshHost: string; cols: number; rows: number }): void {
    this.stop();
    this.backlog = '';
    this.exitCode = null;
    this.sshHost = input.sshHost;
    const env = { ...process.env, TERM: 'xterm-256color' };
    const proc = this.spawnFn(input.argv.command, input.argv.args, {
      cols: input.cols,
      rows: input.rows,
      cwd: process.env.HOME ?? homedir(),
      env,
      name: 'xterm-256color'
    });
    this.proc = proc;
    proc.onData((data) => {
      this.appendBacklog(data);
      this.emit('data', data);
    });
    proc.onExit((event) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.exitCode = event.exitCode;
      this.emit('exit', event.exitCode);
    });
  }

  write(data: unknown): void {
    if (typeof data !== 'string' || data.length === 0 || !this.proc) return;
    this.proc.write(data.length > WRITE_MAX_CHARS ? data.slice(0, WRITE_MAX_CHARS) : data);
  }

  resize(cols: unknown, rows: unknown): void {
    if (!this.proc) return;
    this.proc.resize(clampDim(cols, 80, 20, 400), clampDim(rows, 24, 8, 200));
  }

  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try {
      proc.kill();
    } catch {
      /* already gone */
    }
  }

  private appendBacklog(data: string): void {
    this.backlog = `${this.backlog}${data}`;
    if (this.backlog.length > BACKLOG_MAX_CHARS) {
      this.backlog = this.backlog.slice(this.backlog.length - BACKLOG_MAX_CHARS);
    }
  }
}

export const sshPairingSession = new SshPairingSession();
