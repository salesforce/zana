import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

const SSHD = '/usr/sbin/sshd';

export interface PrivateSshd {
  dir: string;
  port: number;
  user: string;
  /** `ssh-ed25519 <base64>` of the private host key, as an invitation pins it. */
  hostKey: string;
  /** A different, valid ed25519 host key that this sshd does not hold (host-key mismatch negatives). */
  strangerHostKey: string;
  /** The JSON an app launched with `ZCC_E2E_PEER_SSH_ENDPOINT` advertises as its sshd endpoint. */
  endpoint(options?: { hostKey?: string }): string;
  log(): string;
  /** SIGKILLs the listener and every per-connection child it forked; the port then refuses connections. */
  stop(): void;
  dispose(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** True while something accepts TCP on 127.0.0.1:port. */
export function listening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

function descendants(root: number): number[] {
  const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout;
  const parents = new Map<number, number>();
  for (const line of out.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid !== undefined) parents.set(pid, ppid);
  }
  const found: number[] = [];
  const walk = (pid: number) => { for (const [child, parent] of parents) if (parent === pid) { found.push(child); walk(child); } };
  walk(root);
  return found;
}

/** Pids whose argv matches `pattern` (pgrep -f). */
export function pidsMatching(pattern: string): number[] {
  const out = spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout.trim();
  return out ? out.split('\n').map(Number).filter(pid => pid !== process.pid) : [];
}

/**
 * A private, unprivileged `/usr/sbin/sshd` on a free 127.0.0.1 port with its own host key. Nothing under the real
 * `~/.ssh`, the system sshd or the user's keys is read or written: the only account file it consults is each
 * `authorizedKeysFiles` entry, which are the isolated app homes' `.ssh/authorized_keys`.
 */
export async function startPrivateSshd(authorizedKeysFiles: string[]): Promise<PrivateSshd> {
  for (const binary of [SSHD, '/usr/bin/ssh', '/usr/bin/ssh-keygen']) {
    if (!existsSync(binary)) throw new Error(`${binary} is unavailable`);
  }
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-e2e-sshd-')));
  await chmod(dir, 0o700);
  for (const name of ['host_key', 'stranger_key']) {
    const result = spawnSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'zcc-e2e-sshd', '-f', join(dir, name)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ssh-keygen failed: ${result.stderr}`);
  }
  const port = await freePort(), user = userInfo().username;
  await writeFile(join(dir, 'sshd_config'), [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${join(dir, 'host_key')}`, `AuthorizedKeysFile ${authorizedKeysFiles.join(' ')}`,
    'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', `PidFile ${join(dir, 'sshd.pid')}`,
    'AllowTcpForwarding yes', 'AllowStreamLocalForwarding no', 'GatewayPorts no', 'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTunnel no', 'StrictModes no', `AllowUsers ${user}`, ''
  ].join('\n'), { mode: 0o600 });
  const check = spawnSync(SSHD, ['-t', '-f', join(dir, 'sshd_config')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`sshd config rejected: ${check.stderr}`);
  const proc: ChildProcess = spawn(SSHD, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let log = '';
  proc.stderr!.on('data', chunk => { log = (log + chunk).slice(-65_536); });
  const deadline = Date.now() + 10_000;
  while (!await listening(port)) {
    if (Date.now() > deadline) { proc.kill('SIGKILL'); throw new Error(`private sshd did not start: ${log}`); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const keyOf = async (name: string) => (await readFile(join(dir, `${name}.pub`), 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ');
  const hostKey = await keyOf('host_key'), strangerHostKey = await keyOf('stranger_key');
  const stop = () => {
    for (const pid of [...descendants(proc.pid!), proc.pid!]) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  };
  return {
    dir, port, user, hostKey, strangerHostKey, log: () => log, stop,
    endpoint: options => JSON.stringify({ host: 'localhost', port, user, hostKey: options?.hostKey ?? hostKey }),
    dispose: async () => { stop(); await rm(dir, { recursive: true, force: true }); }
  };
}
