/**
 * LIVE proof that the lines SshAuthorizedKeys writes are accepted and enforced by a REAL OpenSSH server
 * (permitlisten / permitopen / restrict / expiry-time). A private unprivileged `/usr/sbin/sshd` runs on an ephemeral
 * 127.0.0.1 port from a temp directory with its own host key and authorized_keys. ~/.ssh is never read or written.
 *
 * GATED OFF BY DEFAULT. Run with:
 *
 *   ZCC_LIVE_SSH=1 pnpm exec vitest run apps/server/src/services/peers/ssh-authorized-keys.live.test.ts
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SshAuthorizedKeys } from './ssh-authorized-keys.js';
import { createLocalEndpoint } from './peer-ssh-local.js';

const LIVE = process.env.ZCC_LIVE_SSH === '1';
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const a = server.address(); server.close(() => typeof a === 'object' && a ? resolve(a.port) : reject(new Error('no port'))); });
});

describe.skipIf(!LIVE)('live sshd enforcement of SshAuthorizedKeys lines', () => {
  let dir: string, port: number, user: string, sshd: ChildProcess, ak: SshAuthorizedKeys;
  const children: ChildProcess[] = [], servers: Array<ReturnType<typeof createServer>> = [];

  const keygen = (name: string) => {
    const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, name)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  };
  const pub = async (name: string) => (await readFile(join(dir, `${name}.pub`), 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ');
  const tunnel = (name: string, forwards: string[]) => {
    const child = spawn('/usr/bin/ssh', ['-F', '/dev/null', '-N', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', join(dir, name),
      '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
      ...forwards, '-p', String(port), '-l', user, '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child);
    return child;
  };
  const exited = (child: ChildProcess) => new Promise<number | null>(resolve => child.once('exit', code => resolve(code)));
  const echoServer = async () => {
    const server = createServer(socket => socket.pipe(socket));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return (server.address() as { port: number }).port;
  };
  const roundTrip = (p: number) => new Promise<string>(resolve => {
    const socket = connect(p, '127.0.0.1');
    let got = '';
    socket.on('connect', () => socket.write('ping'));
    socket.on('data', d => { got += d; socket.destroy(); });
    socket.on('close', () => resolve(got));
    socket.on('error', () => resolve(got));
    setTimeout(() => { socket.destroy(); resolve(got); }, 3000);
  });

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-live-ak-')));
    await chmod(dir, 0o700);
    user = userInfo().username;
    keygen('host_key'); keygen('good'); keygen('expired'); keygen('uds'); keygen('uds2');
    port = await freePort();
    ak = new SshAuthorizedKeys({ instanceId: 'live', authorizedKeysPath: join(dir, 'authorized_keys') });
    await writeFile(join(dir, 'sshd_config'), [
      `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${join(dir, 'host_key')}`, `AuthorizedKeysFile ${join(dir, 'authorized_keys')}`,
      'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', `PidFile ${join(dir, 'sshd.pid')}`,
      'AllowTcpForwarding yes', 'AllowStreamLocalForwarding no', 'StrictModes no', `AllowUsers ${user}`, ''].join('\n'), { mode: 0o600 });
    sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: 'ignore', detached: true });
    await vi.waitFor(() => new Promise<void>((resolve, reject) => {
      const s = connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve(); }); s.once('error', reject);
    }), { timeout: 10_000, interval: 100 });
  }, 30_000);

  afterAll(async () => {
    for (const c of children) c.kill('SIGKILL');
    for (const s of servers) s.close();
    if (sshd?.pid) { try { process.kill(-sshd.pid, 'SIGKILL'); } catch { /* gone */ } }
    await rm(dir, { recursive: true, force: true });
  });

  it('permitopen allows only the registered target; permitlisten allows only the registered -R port', async () => {
    const target = await echoServer(), other = await echoServer();
    const [listenPort, l1, l2] = [await freePort(), await freePort(), await freePort()];
    await ak.upsert({ linkId: 'live-1', kind: 'link', pub: await pub('good'), listenPort, targetPort: target });

    const allowed = tunnel('good', [`-L`, `127.0.0.1:${l1}:127.0.0.1:${target}`, '-R', `127.0.0.1:${listenPort}:127.0.0.1:${target}`]);
    await vi.waitFor(async () => expect(await roundTrip(l1)).toBe('ping'), { timeout: 10_000, interval: 200 });
    allowed.kill('SIGKILL');

    const denied = tunnel('good', ['-L', `127.0.0.1:${l2}:127.0.0.1:${other}`]);
    await new Promise(r => setTimeout(r, 1500));
    expect(await roundTrip(l2)).toBe('');
    denied.kill('SIGKILL');

    const badListen = tunnel('good', ['-R', `127.0.0.1:${await freePort()}:127.0.0.1:${target}`]);
    expect(await exited(badListen)).not.toBe(0);
  }, 40_000);

  it('rejects authentication for a line whose expiry-time has passed, and after the line is removed', async () => {
    await ak.upsert({ linkId: 'live-2', kind: 'bootstrap', pub: await pub('expired'), listenPort: await freePort(), targetPort: await freePort(),
      expiresAt: Date.now() - 3_600_000 });
    expect(await exited(tunnel('expired', ['-L', `127.0.0.1:${await freePort()}:127.0.0.1:1`]))).toBe(255);

    await ak.remove('live-1');
    expect(await exited(tunnel('good', ['-L', `127.0.0.1:${await freePort()}:127.0.0.1:1`]))).toBe(255);
  }, 30_000);
  /** TCP key restrictions cannot confine Unix-socket paths; the serving sshd must disable stream-local forwarding. */
  it('rejects Unix-socket remote forwarding (-R /path) while permitted TCP forwarding still works', async () => {
    const version = spawnSync('/usr/bin/ssh', ['-V'], { encoding: 'utf8' });
    console.info(`[live-ssh] client ${(version.stderr || version.stdout).trim()}`);
    const target = await echoServer(), listenPort = await freePort();
    await ak.upsert({ linkId: 'live-uds', kind: 'link', pub: await pub('uds'), listenPort, targetPort: target });

    // Control: the same key can still do its permitted TCP forward, so a failure below is about the forward kind, not auth.
    const l0 = await freePort();
    const control = tunnel('uds', ['-L', `127.0.0.1:${l0}:127.0.0.1:${target}`]);
    await vi.waitFor(async () => expect(await roundTrip(l0)).toBe('ping'), { timeout: 10_000, interval: 200 });
    control.kill('SIGKILL');

    // Remote Unix-socket listener on the server side (what a malicious peer would use to squat a path A's processes trust).
    const socketPath = `/tmp/zcc-live-${randomBytes(6).toString('hex')}.sock`;
    try {
      const uds = tunnel('uds', ['-R', `${socketPath}:127.0.0.1:1`]);
      const code = await Promise.race([exited(uds), new Promise<'alive'>(resolve => setTimeout(() => resolve('alive'), 4000))]);
      const appeared = existsSync(socketPath);
      console.info(`[live-ssh] -R ${socketPath}: ssh ${code === 'alive' ? 'stayed up' : `exited ${code}`}, socket file ${appeared ? 'CREATED' : 'absent'}`);
      expect(appeared).toBe(false);
      expect(code).toBe(255);
      uds.kill('SIGKILL');
    } finally { await rm(socketPath, { force: true }); }

    // Local forward whose far end is a Unix socket on the server side (direct-streamlocal@openssh.com).
    const l1 = await freePort();
    const toUds = tunnel('uds', ['-L', `127.0.0.1:${l1}:${join(dir, 'does-not-matter.sock')}`]);
    await new Promise(r => setTimeout(r, 1500));
    expect(await roundTrip(l1)).toBe('');
    toUds.kill('SIGKILL');
  }, 60_000);

  it('passes the real endpoint self-test with TCP allowed and stream-local forwarding disabled', async () => {
    const endpoint = { host: 'localhost', port, user, hostKey: await pub('host_key') };
    const setup = createLocalEndpoint({ authorizedKeys: ak,
      env: { ...process.env, ZCC_E2E_HOME: dir, ZCC_E2E_PEER_SSH_ENDPOINT: JSON.stringify(endpoint) } });
    expect(await setup(new AbortController().signal)).toEqual(endpoint);
    expect((await ak.list()).some(line => line.linkId.startsWith('selftest-'))).toBe(false);
  }, 30_000);

  /** Is there any per-key (or sshd_config-free) way to stop the socket? Tries every candidate; only the global sshd knob works. */
  describe('mitigation probes for the Unix-socket remote forward', () => {
    const base = (extra: string[]) => ['restrict', 'port-forwarding', 'permitlisten="127.0.0.1:41999"', 'permitopen="127.0.0.1:41998"', 'command="/usr/bin/false"', ...extra].join(',');
    const attempt = async (name: string, options: string, serverPort = port) => {
      await writeFile(join(dir, 'authorized_keys'), `${options} ${await pub(name)} probe\n`, { mode: 0o600 });
      const socketPath = `/tmp/zcc-live-${randomBytes(6).toString('hex')}.sock`;
      const saved = port; port = serverPort;
      try {
        const child = tunnel(name, ['-R', `${socketPath}:127.0.0.1:1`]);
        const code = await Promise.race([exited(child), new Promise<'alive'>(resolve => setTimeout(() => resolve('alive'), 3000))]);
        const created = existsSync(socketPath);
        child.kill('SIGKILL');
        console.info(`[live-ssh] ${options.replace(/permit\w+="[^"]*",?/g, '')} -> ssh ${code === 'alive' ? 'up' : `exit ${code}`}, socket ${created ? 'CREATED' : 'absent'}`);
        return { code, created };
      } finally { port = saved; await rm(socketPath, { force: true }); }
    };

    it('no per-key option exists: an unknown no-streamlocal option invalidates the key (auth fails), it does not restrict it', async () => {
      const result = await attempt('uds2', base(['no-streamlocal-forwarding']));
      expect(result.created).toBe(false);
      expect(result.code).toBe(255);
    });

    it('permitlisten with a path value does not parse, so it cannot scope the socket either', async () => {
      const result = await attempt('uds2', ['restrict', 'port-forwarding', 'permitlisten="/tmp/only-this.sock"', 'command="/usr/bin/false"'].join(','));
      console.info(`[live-ssh] permitlisten=<path> observed: exit ${String(result.code)}, created=${result.created}`);
      expect(result.created).toBe(false);
    });

    it('endpoint setup refuses a real sshd that permits stream-local forwarding despite TCP key restrictions', async () => {
      const second = await freePort();
      await writeFile(join(dir, 'sshd_config2'), [
        `Port ${second}`, 'ListenAddress 127.0.0.1', `HostKey ${join(dir, 'host_key')}`, `AuthorizedKeysFile ${join(dir, 'authorized_keys')}`,
        'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', `PidFile ${join(dir, 'sshd2.pid')}`,
        'AllowTcpForwarding yes', 'AllowStreamLocalForwarding yes', 'StrictModes no', `AllowUsers ${user}`, ''].join('\n'), { mode: 0o600 });
      const sshd2 = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(dir, 'sshd_config2')], { stdio: 'ignore', detached: true });
      try {
        await vi.waitFor(() => new Promise<void>((resolve, reject) => {
          const sock = connect(second, '127.0.0.1'); sock.once('connect', () => { sock.destroy(); resolve(); }); sock.once('error', reject);
        }), { timeout: 10_000, interval: 100 });
        const endpoint = { host: 'localhost', port: second, user, hostKey: await pub('host_key') };
        const setup = createLocalEndpoint({ authorizedKeys: ak,
          env: { ...process.env, ZCC_E2E_HOME: dir, ZCC_E2E_PEER_SSH_ENDPOINT: JSON.stringify(endpoint) } });
        await expect(setup(new AbortController().signal)).rejects.toThrow(
          'ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
        expect((await ak.list()).some(line => line.linkId.startsWith('selftest-'))).toBe(false);
      } finally { try { process.kill(-sshd2.pid!, 'SIGKILL'); } catch { /* gone */ } }
    }, 30_000);
  });
});
