/**
 * LIVE proof of the registered SSH transport adapter (PeerSshEndpoints + PeerTunnels.openLocal) against a REAL
 * OpenSSH server. Nothing on the transport is mocked: a private, unprivileged `/usr/sbin/sshd` is started on an
 * ephemeral 127.0.0.1 port from a 0700 temp directory holding its own ed25519 host key, a test client key and
 * authorized_keys. ~/.ssh, the system sshd and the user's keys are never read or written.
 *
 * GATED OFF BY DEFAULT so `pnpm test` stays hermetic. Run with:
 *
 *   ZCC_LIVE_SSH=1 pnpm exec vitest run apps/server/src/services/peers/peer-ssh-endpoints.live.test.ts
 *
 * With ZCC_LIVE_SSH=1 a missing sshd/ssh/ssh-keygen fails the suite instead of silently skipping it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PeerTunnels, pinnedSshArgs } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import { startEnrolledHostConnection, type EnrolledHostConnection } from '@zana-ai/zcc-host-daemon/server-connection';
import { createCommandRuntime } from '@zana-ai/zcc-host-daemon/command-dispatch';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { getHost, listAllHosts } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from '../../http/product-server.js';
import { createPluginApi, type PluginHandle } from '../../plugins/plugin-api.js';
import { createEnrolledPeerBridge } from './enrolled-peer-bridge.js';
import { unsealPeerBytes } from './peer-auth.js';
import { PeerSshEndpoints } from './peer-ssh-endpoints.js';

const SSHD = '/usr/sbin/sshd';
const LIVE = process.env.ZCC_LIVE_SSH === '1';

type Sshd = { dir: string; port: number; user: string; hostKey: string; identityFile: string; proc: ChildProcess; log: () => string; pids: Set<number> };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port')));
    });
  });
}

function processTable(): Map<number, number> {
  const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout;
  const parents = new Map<number, number>();
  for (const line of out.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid !== undefined) parents.set(pid, ppid);
  }
  return parents;
}

function descendants(root: number): number[] {
  const parents = processTable(), found: number[] = [];
  const walk = (pid: number) => { for (const [child, parent] of parents) if (parent === pid) { found.push(child); walk(child); } };
  walk(root);
  return found;
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function startSshd(): Promise<Sshd> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-live-sshd-')));
  await chmod(dir, 0o700);
  const keygen = (file: string) => {
    const result = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'zcc-live-ssh', '-f', join(dir, file)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ssh-keygen failed: ${result.stderr}`);
  };
  keygen('host_key'); keygen('client_key');
  await writeFile(join(dir, 'authorized_keys'), await readFile(join(dir, 'client_key.pub')), { mode: 0o600 });
  const port = await freePort(), user = userInfo().username;
  await writeFile(join(dir, 'sshd_config'), [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${join(dir, 'host_key')}`, `AuthorizedKeysFile ${join(dir, 'authorized_keys')}`,
    'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'UsePAM no', `PidFile ${join(dir, 'sshd.pid')}`,
    'AllowTcpForwarding local', 'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTunnel no', 'StrictModes no', `AllowUsers ${user}`, ''
  ].join('\n'), { mode: 0o600 });
  const check = spawnSync(SSHD, ['-t', '-f', join(dir, 'sshd_config')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`sshd config rejected: ${check.stderr}`);
  const proc = spawn(SSHD, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let log = '';
  proc.stderr!.on('data', chunk => { log = (log + chunk).slice(-65_536); });
  // Listening once a TCP connect succeeds.
  await vi.waitFor(() => new Promise<void>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }), { timeout: 10_000, interval: 100 });
  const hostKey = (await readFile(join(dir, 'host_key.pub'), 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ');
  return { dir, port, user, hostKey, identityFile: join(dir, 'client_key'), proc, log: () => log, pids: new Set([proc.pid!]) };
}

/** Simulates the remote sshd dying: SIGKILL the listener and every per-connection child it forked. */
function killSshd(sshd: Sshd): void {
  const tree = [...descendants(sshd.proc.pid!), sshd.proc.pid!];
  for (const pid of tree) sshd.pids.add(pid);
  for (const pid of tree) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

/** Every process whose argv names the fixture directory: the sshd listener and any ssh client using its identity. */
function fixtureProcesses(sshd: Sshd): string[] {
  const out = spawnSync('pgrep', ['-fl', sshd.dir], { encoding: 'utf8' }).stdout.trim();
  return out ? out.split('\n') : [];
}

describe.skipIf(!LIVE)('live SSH transport adapter (real sshd)', () => {
  let sshd: Sshd;
  const roots: string[] = [], servers: ProductServer[] = [], connections: EnrolledHostConnection[] = [], handles: PluginHandle[] = [];

  beforeAll(async () => {
    for (const binary of [SSHD, '/usr/bin/ssh', '/usr/bin/ssh-keygen']) {
      if (!existsSync(binary)) throw new Error(`ZCC_LIVE_SSH=1 but ${binary} is unavailable`);
    }
    sshd = await startSshd();
  }, 30_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) await handle.dispose();
    for (const connection of connections.splice(0)) await connection.close();
    for (const server of servers.splice(0)) await server.close();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  afterAll(async () => {
    if (!sshd) return;
    killSshd(sshd);
    await rm(sshd.dir, { recursive: true, force: true });
  });

  const endpoint = (peerInstanceId: string, remoteAppPort: number, hostKey = sshd.hostKey) => ({
    peerInstanceId, host: '127.0.0.1', port: sshd.port, user: sshd.user, hostKey, remoteAppPort, identityFile: sshd.identityFile });

  it('pins the host key: the right key carries real bytes, a wrong key is refused before authentication (StrictHostKeyChecking=yes)', async () => {
    const target = createHttpServer((_req, res) => { res.end('through-ssh'); });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetPort = (target.address() as { port: number }).port;
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-live-ssh-endpoints-'))); roots.push(dir);
    const key = randomBytes(32), instanceId = randomUUID(), peerId = randomUUID(), wrongPeerId = randomUUID();
    const endpoints = new PeerSshEndpoints({ directory: join(dir, 'peer-ssh'), instanceId, keyProvider: { getKey: async () => key }, openTimeoutMs: 15_000 });
    try {
      await endpoints.register(endpoint(peerId, targetPort));
      const url = await endpoints.routeFor(peerId);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(new URL(url!).port).not.toBe(String(targetPort));
      expect(await (await fetch(url!)).text()).toBe('through-ssh');
      const accepted = (sshd.log().match(/Accepted publickey for /g) ?? []).length;
      expect(accepted).toBeGreaterThanOrEqual(1);

      // A different, well-formed ed25519 key pinned for the same host:port.
      const otherDir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-live-ssh-wrongkey-'))); roots.push(otherDir);
      spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(otherDir, 'k')]);
      const wrongKey = (await readFile(join(otherDir, 'k.pub'), 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ');
      expect(wrongKey).not.toBe(sshd.hostKey);
      await endpoints.register(endpoint(wrongPeerId, targetPort, wrongKey));
      await expect(endpoints.routeFor(wrongPeerId)).rejects.toThrow('SSH tunnel closed before connecting');
      // The adapter hides stderr by design; replay its exact argv to show the refusal is the host-key check.
      await writeFile(join(otherDir, 'known_hosts'), `[127.0.0.1]:${sshd.port} ${wrongKey}\n`, { mode: 0o600 });
      const replay = spawnSync('ssh', pinnedSshArgs(endpoint(wrongPeerId, targetPort, wrongKey), join(otherDir, 'known_hosts'), await freePort(), targetPort),
        { encoding: 'utf8', timeout: 15_000 });
      expect(replay.status).toBe(255);
      expect(replay.stderr).toContain('Host key verification failed');
      // The client aborted before offering its key: no new accepted login on the server.
      expect((sshd.log().match(/Accepted publickey for /g) ?? []).length).toBe(accepted);
      // The good tunnel is unaffected.
      expect(await (await fetch(url!)).text()).toBe('through-ssh');
    } finally {
      endpoints.dispose();
      await new Promise<void>(resolve => target.close(() => resolve()));
    }
    await vi.waitFor(() => expect(fixtureProcesses(sshd).filter(line => !line.includes('sshd_config'))).toEqual([]), { timeout: 10_000 });
  }, 60_000);

  type App = { server: ProductServer; dir: string };
  async function app(): Promise<App> {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'peer-ssh-live-'))); roots.push(dir);
    const key = randomBytes(32);
    const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key } });
    servers.push(server);
    return { server, dir };
  }
  async function enroll(owner: App, local: App) {
    const issued = owner.server.ctx.joinCodes.mint();
    const response = await fetch(`${owner.server.url}internal/hosts/enroll`, { method: 'POST', headers: {
      authorization: `Bearer ${issued.joinCode}`, 'content-type': 'application/json' }, body: JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: issued.hostId, hostName: 'Peer machine', instanceId: randomUUID() }) });
    expect(response.status).toBe(201);
    const credentials = await response.json() as { hostId: string; hostKey: string };
    const connection = startEnrolledHostConnection({ serverUrl: owner.server.url, ...credentials, dataDir: local.dir, localPeerAppDataDir: local.dir,
      runtime: createCommandRuntime({ dataDir: local.dir, emit() {} }) });
    connections.push(connection); await connection.ready;
    await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId)).not.toBeNull());
  }
  const installations = async (owner: App) => (await (await fetch(`${owner.server.url}api/v1/peers/installations`)).json() as {
    installations: Array<Record<string, unknown>> }).installations;
  const forwardHosts = (owner: App) => listAllHosts(owner.server.ctx.db).filter(host => !host.destroyedAt && host.enrollmentCapability === 'peer.forward');

  it('an introduced peer reached only through the registered SSH tunnel enrolls, round-trips sealed peer.control, and reports unavailable when sshd dies', async () => {
    const scope = 'ssh-live-scope';
    const a = await app(), b = await app(), c = await app();
    await enroll(a, b); await enroll(b, a); await enroll(a, c); await enroll(c, a);
    const sponsor = createPluginApi('test-plugin', join(a.dir, 'plugins', 'test-plugin'), { productContext: a.server.ctx }); handles.push(sponsor);
    const bId = b.server.ctx.productInstanceId, cId = c.server.ctx.productInstanceId;
    await sponsor.api.sdk.peers.enable(bId, { scope }); await sponsor.api.sdk.peers.enable(cId, { scope });
    const toC = (await sponsor.api.sdk.peers.introduce(cId, { sponsorPeerId: bId, scope })).introductionId;
    const toB = (await sponsor.api.sdk.peers.introduce(bId, { sponsorPeerId: cId, scope })).introductionId;
    await a.server.ctx.peerAuthority.recover();
    // The lower instance id initiates and dials the higher one; that dial is the one routed over SSH.
    const [low, high] = bId < cId ? [{ app: b, id: bId, introductionId: toB }, { app: c, id: cId, introductionId: toC }]
      : [{ app: c, id: cId, introductionId: toC }, { app: b, id: bId, introductionId: toB }];

    // Owner registers the pinned endpoint through the production HTTP route: sshd forwards to high's app port.
    const registered = await fetch(`${low.app.server.url}api/v1/peers/ssh-endpoints`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(endpoint(high.id, high.app.server.port)) });
    expect(registered.status).toBe(201);
    const acceptedBefore = (sshd.log().match(/Accepted publickey for /g) ?? []).length;

    const decide = async (owner: App, introductionId: string) => expect((await fetch(`${owner.server.url}api/v1/peers/introductions/${introductionId}/decision`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"decision":"approved"}' })).status).toBe(200);
    await decide(high.app, high.introductionId);
    await vi.waitFor(async () => expect(await installations(high.app)).toEqual([expect.objectContaining({ role: 'responder', status: 'awaiting' })]), { timeout: 20_000 });
    await decide(low.app, low.introductionId);
    await vi.waitFor(async () => {
      for (const owner of [low.app, high.app]) expect(await installations(owner)).toEqual([expect.objectContaining({ status: 'enrolled', connected: true })]);
    }, { timeout: 45_000, interval: 250 });

    // The route low uses for high is the SSH tunnel's loopback port, not high's real port, and sshd authenticated it.
    const tunnelUrl = await low.app.server.ctx.peerSshEndpoints!.routeFor(high.id);
    expect(tunnelUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(Number(new URL(tunnelUrl!).port)).not.toBe(high.app.server.port);
    expect((sshd.log().match(/Accepted publickey for /g) ?? []).length).toBeGreaterThan(acceptedBefore);

    // high's forward-only host for low is low's installer daemon, whose WebSocket was dialled through the tunnel.
    const [tunnelled] = forwardHosts(high.app);
    expect(forwardHosts(high.app)).toHaveLength(1);
    expect(high.app.server.ctx.hostHub.getSession(tunnelled!.id)).toBeTruthy();
    // ...while low's forward host for high is high's daemon dialling low directly (no endpoint registered on high).
    const [direct] = forwardHosts(low.app);
    expect(low.app.server.ctx.hostHub.getSession(direct!.id)).toBeTruthy();

    // Sealed peer.control over the tunnelled session: high -> (ssh) -> low's daemon -> low's app, and back.
    const bridge = createEnrolledPeerBridge({ instanceId: high.id, db: high.app.server.ctx.db, hub: high.app.server.ctx.hostHub, channels: high.app.server.ctx.peerChannels });
    const prove = () => {
      const nonce = randomBytes(24).toString('hex');
      return bridge.prove(tunnelled!.id, { nonce, senderInstanceId: high.id, recipientInstanceId: low.id }, AbortSignal.timeout(20_000))
        .then(result => ({ nonce, result }));
    };
    const { nonce, result } = await prove();
    const proofKey = Buffer.from(getHost(high.app.server.ctx.db, tunnelled!.id)!.hostKeyHash, 'hex');
    const proof = JSON.parse(unsealPeerBytes(Buffer.from(result.sealedProof, 'base64url'), proofKey, 'zcc-mutual-enrollment-v1').toString('utf8'));
    expect(proof).toMatchObject({ nonce, senderInstanceId: high.id, recipientInstanceId: low.id, hostId: tunnelled!.id,
      reverseHostId: direct!.id, reverseCapability: 'peer.forward' });

    // sshd dies (listener and per-connection children): the tunnelled direction must go unavailable, fail closed.
    killSshd(sshd);
    await vi.waitFor(() => expect(high.app.server.ctx.hostHub.getSession(tunnelled!.id)).toBeFalsy(), { timeout: 30_000, interval: 200 });
    await vi.waitFor(async () => expect(await installations(low.app)).toEqual([expect.objectContaining({ status: 'enrolled', connected: false })]),
      { timeout: 30_000, interval: 200 });
    await expect(prove()).rejects.toThrow('enrolled peer offline');
    // The direct (non-SSH) direction is untouched, so the outage is attributable to the SSH route alone.
    expect(low.app.server.ctx.hostHub.getSession(direct!.id)).toBeTruthy();
    // With sshd gone a fresh route attempt cannot be established.
    await low.app.server.ctx.peerSshEndpoints!.remove(high.id);
    await low.app.server.ctx.peerSshEndpoints!.register(endpoint(high.id, high.app.server.port));
    await expect(low.app.server.ctx.peerSshEndpoints!.routeFor(high.id)).rejects.toThrow('SSH tunnel closed before connecting');

    // Cleanup: closing the apps leaves no ssh client or sshd process behind.
    for (const handle of handles.splice(0)) await handle.dispose();
    for (const connection of connections.splice(0)) await connection.close();
    for (const server of servers.splice(0)) await server.close();
    await vi.waitFor(() => {
      expect(fixtureProcesses(sshd)).toEqual([]);
      expect([...sshd.pids].filter(alive)).toEqual([]);
    }, { timeout: 15_000, interval: 250 });
  }, 180_000);
});
