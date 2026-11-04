import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { PeerTunnels, peerTunnelFailure } from './peer-tunnels.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const processes: any[] = [];
  const spawnProcess = vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
      kill: vi.fn(() => { proc.killed = true; queueMicrotask(() => proc.emit('close', 1)); }) });
    processes.push(proc); return proc;
  });
  return { tunnels: new PeerTunnels(spawnProcess as unknown as typeof spawn), processes, spawnProcess };
}
const ready = (proc: any) => proc.stdout.write('ZCC-PEER-TUNNEL-READY\n');

it('waits for forwarding readiness, reuses a pending connection and owns shutdown', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  const second = f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  let resolved = false; void second.then(() => { resolved = true; }); await Promise.resolve(); expect(resolved).toBe(false);
  ready(f.processes[0]); await Promise.all([first, second]);
  await f.tunnels.open({ host: 'pony', user: 'me', proxyJump: 'bastion' }, 8780, 28888);
  expect(f.spawnProcess).toHaveBeenCalledOnce();
  const args = (f.spawnProcess.mock.calls[0] as any)[1];
  expect(args).toContain('127.0.0.1:28888:127.0.0.1:8780'); expect(args).toContain('ControlPath=none');
  expect(args).toContain('me@pony'); expect(args).toContain('bastion');
  f.tunnels.close(); f.tunnels.close(); expect(f.processes[0].kill).toHaveBeenCalledOnce();
});

it('rejects bounded SSH errors, clears failed tunnels and permits another attempt', async () => {
  const f = fixture(), pending = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  f.processes[0].stderr.write('x'.repeat(10000) + ' forwarding refused'); f.processes[0].emit('close', 255);
  await expect(pending).rejects.toThrow('forwarding refused');
  const next = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[1]); await next; f.tunnels.close();
});

it('times out a silent connection and handles executable errors', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = f.tunnels.open({ host: 'pony' }, 8780, 28888); const rejection = expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000); await rejection; expect(f.processes[0].kill).toHaveBeenCalled();
  const failed = f.tunnels.open({ host: 'pony' }, 8780, 28888); f.processes[1].emit('error', new Error('ENOENT'));
  await expect(failed).rejects.toThrow('ENOENT'); f.tunnels.close(); expect(vi.getTimerCount()).toBe(0);
});

it('reconnects dropped connections, retries failed reconnects and cancels retries on close', async () => {
  vi.useFakeTimers(); const f = fixture();
  const pending = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[0]); await pending;
  f.processes[0].emit('close', 255); await vi.advanceTimersByTimeAsync(3000);
  f.processes[1].emit('close', 255); await vi.advanceTimersByTimeAsync(3000);
  ready(f.processes[2]); await Promise.resolve();
  f.processes[2].emit('close', 255); f.tunnels.close(); await vi.advanceTimersByTimeAsync(30000);
  expect(f.spawnProcess).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
});

it('rejects invalid ports and bounds owned connections', async () => {
  const f = fixture();
  for (const port of [0, 65536, 1.5, NaN]) await expect(f.tunnels.open({ host: 'pony' }, port, 28888)).rejects.toThrow('Invalid');
  for (let i = 0; i < 64; i++) { const pending = f.tunnels.open({ host: `pony-${i}` }, 8780, 28888); ready(f.processes[i]); await pending; }
  await expect(f.tunnels.open({ host: 'extra' }, 8780, 28888)).rejects.toThrow('Too many'); f.tunnels.close();
});

it('removes one tunnel without stopping another machine', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony' }, 8780, 28888); ready(f.processes[0]); await first;
  const second = f.tunnels.open({ host: 'other' }, 8780, 28888); ready(f.processes[1]); await second;
  f.tunnels.remove({ host: 'pony' }, 8780, 28888); f.tunnels.remove({ host: 'missing' }, 8780, 28888);
  expect(f.processes[0].kill).toHaveBeenCalledOnce(); expect(f.processes[1].kill).not.toHaveBeenCalled(); f.tunnels.close();
});

it('tags a remote port conflict so the primary can pick another port', async () => {
  const f = fixture(), pending = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  f.processes[0].stderr.write('Error: remote port forwarding failed for listen port 28888\n'); f.processes[0].emit('close', 255);
  await expect(pending).rejects.toMatchObject({ code: 'peer_tunnel_port_unavailable', message: expect.stringContaining('remote port forwarding failed') });
  const other = f.tunnels.open({ host: 'pony' }, 8780, 28889); f.processes[1].emit('close', 255);
  await expect(other).rejects.toMatchObject({ code: 'peer_tunnel_failed', message: 'SSH tunnel closed before connecting' });
  expect(peerTunnelFailure('ssh: Could not resolve hostname pony')).toMatchObject({ code: 'peer_tunnel_failed' });
  f.tunnels.close();
});

it('replaces the tunnel for a machine reopened on new ports instead of duplicating it', async () => {
  const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me' }, 8780, 28888); ready(f.processes[0]); await first;
  const moved = f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888); ready(f.processes[1]); await moved;
  expect(f.processes[0].kill).toHaveBeenCalledOnce();
  expect((f.spawnProcess.mock.calls[1] as any)[1]).toContain('127.0.0.1:28888:127.0.0.1:9911');
  await f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2);
  f.tunnels.remove({ host: 'pony', user: 'me' }, 8780, 28888);
  expect(f.processes[1].kill).not.toHaveBeenCalled();
  f.tunnels.remove({ host: 'pony', user: 'me' }, 9911, 28888);
  expect(f.processes[1].kill).toHaveBeenCalledOnce();
  f.tunnels.close();
});

it('a superseded pending open rejects without dropping its replacement', async () => {
  const f = fixture();
  const stale = f.tunnels.open({ host: 'pony' }, 8780, 28888);
  const rejection = expect(stale).rejects.toMatchObject({ code: 'peer_tunnel_failed' });
  const fresh = f.tunnels.open({ host: 'pony' }, 8780, 28999);
  await rejection; ready(f.processes[1]); await fresh;
  await f.tunnels.open({ host: 'pony' }, 8780, 28999);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2); f.tunnels.close();
});

it('closes a removed machine tunnel whatever its ports and stops reconnecting', async () => {
  vi.useFakeTimers(); const f = fixture();
  const first = f.tunnels.open({ host: 'pony', user: 'me' }, 9911, 28888); ready(f.processes[0]); await first;
  const other = f.tunnels.open({ host: 'other' }, 8780, 28888); ready(f.processes[1]); await other;
  expect(f.tunnels.closeFor({ host: 'pony', user: 'me' })).toBe(true);
  expect(f.processes[0].kill).toHaveBeenCalledOnce(); expect(f.processes[1].kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.spawnProcess).toHaveBeenCalledTimes(2);
  expect(f.tunnels.closeFor({ host: 'pony', user: 'me' })).toBe(false);
  f.tunnels.close();
});

import { spawn as realSpawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedSshArgs, validatePinnedEndpoint } from './peer-tunnels.js';

const KEY = `ssh-ed25519 ${'A'.repeat(68)}`;
const endpoint = { host: 'peer.example.test', port: 2222, user: 'zcc', hostKey: KEY };

it('pins the endpoint: fixed argv, no shell, no agent, strict host key, private known_hosts', async () => {
  const f = fixture();
  let knownHosts = '';
  f.spawnProcess.mockImplementationOnce(((_bin: string, args: string[], options: any) => {
    expect(options.shell).toBe(false);
    const file = args.find(arg => arg.startsWith('UserKnownHostsFile='))!.slice(19);
    void readFile(file, 'utf8').then(text => { knownHosts = text; ready(proc); });
    const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
      kill: vi.fn(() => { proc.killed = true; queueMicrotask(() => proc.emit('close', 1)); }) });
    f.processes.push(proc); return proc;
  }) as never);
  const tunnel = await f.tunnels.openLocal({ ...endpoint, identityFile: '/home/zcc/.ssh/id_ed25519' }, 8780, { localPort: 40123 });
  expect(tunnel.url).toBe('http://127.0.0.1:40123/');
  expect(knownHosts).toBe(`[peer.example.test]:2222 ${KEY}\n`);
  const args = (f.spawnProcess.mock.calls[0] as any)[1] as string[];
  for (const option of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'ForwardAgent=no', 'ControlMaster=no', 'ControlPath=none',
    'GlobalKnownHostsFile=/dev/null', 'UpdateHostKeys=no', 'PermitLocalCommand=no', 'IdentitiesOnly=yes']) expect(args).toContain(option);
  expect(args.slice(0, 2)).toEqual(['-F', '/dev/null']);
  expect(args).toContain('127.0.0.1:40123:127.0.0.1:8780');
  expect(args[args.indexOf('--') + 1]).toBe('peer.example.test');
  expect(args).not.toContain('-A');
  await tunnel.close(); await tunnel.close();
  expect(f.processes[0].kill).toHaveBeenCalledOnce();
});

it('writes the default-port known_hosts form and validates every endpoint field', async () => {
  expect(pinnedSshArgs({ ...endpoint, port: 22 }, '/k', 1, 2)).not.toContain('-i');
  for (const bad of [{ host: '-oProxyCommand=x' }, { host: 'a b' }, { user: '-l' }, { user: 'a;b' }, { port: 0 }, { port: 70000 },
    { hostKey: 'ssh-ed25519' }, { hostKey: `ssh-dss ${'A'.repeat(68)}` }, { hostKey: `${KEY}\n[evil] ${KEY}` },
    { identityFile: 'relative' }, { identityFile: '/a/../b' }, { identityFile: 5 }]) {
    expect(() => validatePinnedEndpoint({ ...endpoint, ...bad } as never)).toThrow('Invalid pinned SSH endpoint');
  }
  expect(() => validatePinnedEndpoint(null as never)).toThrow();
  const f = fixture();
  await expect(f.tunnels.openLocal(endpoint, 0)).rejects.toThrow('Invalid peer tunnel port');
  await expect(f.tunnels.openLocal(endpoint, 8780, { localPort: 70000 })).rejects.toThrow('Invalid peer tunnel port');
  const pending = f.tunnels.openLocal({ ...endpoint, port: 22 }, 8780);
  await vi.waitFor(() => expect(f.processes).toHaveLength(1));
  const file = ((f.spawnProcess.mock.calls[0] as any)[1] as string[]).find(arg => arg.startsWith('UserKnownHostsFile='))!.slice(19);
  expect(await readFile(file, 'utf8')).toBe(`peer.example.test ${KEY}\n`);
  ready(f.processes[0]); const tunnel = await pending;
  expect(tunnel.localPort).toBeGreaterThan(0);
  f.processes[0].emit('close', 255); // a dropped forward releases its slot and its private files
  await vi.waitFor(() => expect(tunnel.closed).toBe(true));
  await vi.waitFor(async () => expect(await readFile(file).then(() => true, () => false)).toBe(false));
});

it.each(['close', 'error', 'timeout', 'abort', 'pre-aborted'])('cleans up on %s before ready, without surfacing stderr', async mode => {
  const f = fixture(), controller = new AbortController();
  if (mode === 'pre-aborted') controller.abort();
  const pending = f.tunnels.openLocal(endpoint, 8780, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 20 : 5000 });
  const outcome = pending.then(() => undefined, failure => failure as Error);
  if (mode === 'pre-aborted') { expect(await outcome).toBeInstanceOf(Error); expect(f.spawnProcess).not.toHaveBeenCalled(); return; }
  await vi.waitFor(() => expect(f.processes).toHaveLength(1));
  const proc = f.processes[0];
  const file = ((f.spawnProcess.mock.calls[0] as any)[1] as string[]).find(arg => arg.startsWith('UserKnownHostsFile='))!.slice(19);
  proc.stderr.write('Permission denied for zcc@secret-host');
  if (mode === 'close') proc.emit('close', 255);
  if (mode === 'error') proc.emit('error', new Error('ENOENT secret-host'));
  if (mode === 'abort') controller.abort();
  const error = await outcome;
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).not.toContain('secret-host');
  expect(await readFile(file).then(() => true, () => false)).toBe(false);
  if (mode !== 'close' && mode !== 'error') expect(proc.kill).toHaveBeenCalled();
  // slot released: another attempt is allowed
  const next = f.tunnels.openLocal(endpoint, 8780); await vi.waitFor(() => expect(f.processes).toHaveLength(2));
  ready(f.processes[1]); await (await next).close();
});

it('bounds concurrent opens and live local tunnels; close() releases them all', async () => {
  const f = fixture();
  const opening = Array.from({ length: 4 }, () => f.tunnels.openLocal(endpoint, 8780));
  await expect(f.tunnels.openLocal(endpoint, 8780)).rejects.toThrow('concurrent');
  await vi.waitFor(() => expect(f.processes).toHaveLength(4));
  for (const proc of f.processes) ready(proc);
  const live = await Promise.all(opening);
  for (let i = 4; i < 16; i++) { const next = f.tunnels.openLocal(endpoint, 8780); await vi.waitFor(() => expect(f.processes).toHaveLength(i + 1)); ready(f.processes[i]); live.push(await next); }
  await expect(f.tunnels.openLocal(endpoint, 8780)).rejects.toThrow('Too many peer SSH tunnels');
  f.tunnels.close();
  await vi.waitFor(() => expect(live.every(tunnel => tunnel.closed)).toBe(true));
  for (const proc of f.processes) expect(proc.kill).toHaveBeenCalled();
});

it('reserves capacity for in-flight local opens and does not leak slots when mkdtemp fails', async () => {
  const f = fixture();
  const live = [];
  for (let i = 0; i < 15; i++) { const next = f.tunnels.openLocal(endpoint, 8780); await vi.waitFor(() => expect(f.processes).toHaveLength(i + 1)); ready(f.processes[i]); live.push(await next); }
  const last = f.tunnels.openLocal(endpoint, 8780);
  // 15 live + 1 opening already fills the 16 cap
  await expect(f.tunnels.openLocal(endpoint, 8780)).rejects.toThrow('Too many peer SSH tunnels');
  await vi.waitFor(() => expect(f.processes).toHaveLength(16)); ready(f.processes[15]); live.push(await last);
  f.tunnels.close();
  await vi.waitFor(() => expect(live.every(tunnel => tunnel.closed)).toBe(true));
  const g = fixture();
  const original = process.env.TMPDIR;
  process.env.TMPDIR = join(tmpdir(), 'zcc-missing-tmp-root', 'nested');
  try {
    for (let i = 0; i < 5; i++) await expect(g.tunnels.openLocal(endpoint, 8780)).rejects.toThrow(/ENOENT/);
  } finally { if (original === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = original; }
  const ok = g.tunnels.openLocal(endpoint, 8780); await vi.waitFor(() => expect(g.processes).toHaveLength(1));
  ready(g.processes[0]); await (await ok).close();
});

it('carries real loopback traffic through a mocked ssh binary over argv (no shell)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-fake-ssh-'));
  const app = createServer((_req, res) => res.end('peer-app'));
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const fake = join(dir, 'ssh');
    // Fake ssh: honours only -L, requires the pinned options, proxies TCP, prints the ready marker.
    await writeFile(fake, `#!${process.execPath}
const net = require('node:net'); const args = process.argv.slice(2);
for (const need of ['StrictHostKeyChecking=yes', 'ForwardAgent=no', 'BatchMode=yes']) if (!args.includes(need)) process.exit(9);
const [, lport, , rport] = args[args.indexOf('-L') + 1].split(':');
const server = net.createServer(socket => { const upstream = net.connect(Number(rport), '127.0.0.1'); socket.pipe(upstream).pipe(socket);
  socket.on('error', () => {}); upstream.on('error', () => socket.destroy()); });
server.listen(Number(lport), '127.0.0.1', () => process.stdout.write('ZCC-PEER-TUNNEL-READY\\n'));
`);
    await chmod(fake, 0o700);
    const tunnels = new PeerTunnels(realSpawn, fake);
    const tunnel = await tunnels.openLocal(endpoint, (app.address() as { port: number }).port, { timeoutMs: 10_000 });
    expect(await (await fetch(tunnel.url, { redirect: 'error' })).text()).toBe('peer-app');
    await tunnel.close();
    await expect(fetch(tunnel.url)).rejects.toThrow();
    tunnels.close();
  } finally {
    await new Promise<void>(resolve => app.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

// --- peer link (-N, -L + -R, own key) ---
import { stat } from 'node:fs/promises';
import { classifyPeerSshFailure, peerLinkSshArgs } from './peer-tunnels.js';
import { generateSeed, publicKeyLine } from './ssh-keys.js';

const linkEndpoint = { host: 'alice-mbp.local', port: 22, user: 'alice', hostKey: KEY };
const linkInput = { endpoint: linkEndpoint, seed: generateSeed(), listenPort: 41001, targetPort: 41002, reversePort: 41003, localPort: 41004 };

it('builds the golden peer-link argv', () => {
  expect(peerLinkSshArgs({ ...linkInput, localPort: 41004 }, '/k/id', '/k/known')).toEqual([
    '-F', '/dev/null', '-N',
    '-o', 'BatchMode=yes', '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-i', '/k/id',
    '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=/k/known',
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'UpdateHostKeys=no', '-o', 'CheckHostIP=no',
    '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'ControlPath=none',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    '-L', '127.0.0.1:41004:127.0.0.1:41002', '-R', '127.0.0.1:41001:127.0.0.1:41003',
    '-p', '22', '-l', 'alice', '--', 'alice-mbp.local'
  ]);
});

it('disables the agent for pinned local forwards too', () => {
  expect(pinnedSshArgs(endpoint, '/k', 1, 2)).toContain('IdentityAgent=none');
});

it.each([
  ['@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@', 'ssh_host_key_mismatch'],
  ['Host key verification failed.', 'ssh_host_key_mismatch'],
  ['alice@h: Permission denied (publickey).', 'ssh_auth_refused'],
  ['Error: remote port forwarding failed for listen port 41001', 'ssh_forwarding_refused'],
  ['channel 2: open failed: administratively prohibited: open failed', 'ssh_forwarding_refused'],
  ['bind [127.0.0.1]:41004: Address already in use', 'ssh_forwarding_refused'],
  ['ssh: connect to host h port 22: Connection refused', 'ssh_remote_login_off'],
  ['ssh: Could not resolve hostname h.local', 'ssh_unreachable'],
  ['', 'ssh_unreachable']
])('classifies %j as %s', (stderr, code) => { expect(classifyPeerSshFailure(stderr)).toBe(code); });

function linkFixture(probeResult: () => boolean = () => true) {
  const f = fixture();
  const states: Array<[boolean, string | undefined]> = [];
  const open = (input = linkInput, options: Record<string, unknown> = {}) =>
    f.tunnels.openPeerLink(input, (up, failure) => states.push([up, failure]), { readyPollMs: 1, reconnectMs: 5, probe: async () => probeResult(), ...options });
  return { ...f, states, open };
}
const argFor = (call: unknown, prefix: string) => ((call as any)[1] as string[]).find(arg => arg.startsWith(prefix))!.slice(prefix.length);

it('opens a peer link: private 0600 key and known_hosts, clean env, no shell, removed on close', async () => {
  const f = linkFixture();
  process.env.SSH_AUTH_SOCK = '/tmp/agent.sock';
  try {
    const link = await f.open();
    const [, args, options] = f.spawnProcess.mock.calls[0] as any;
    expect(options.shell).toBe(false); expect(options.detached).toBe(true);
    expect(options.env.SSH_AUTH_SOCK).toBeUndefined();
    expect(args).toContain('-N'); expect(args).toContain('IdentityAgent=none');
    expect(link.url).toBe('http://127.0.0.1:41004/'); expect(link.up).toBe(true);
    const identity = args[args.indexOf('-i') + 1] as string;
    const knownHosts = argFor(f.spawnProcess.mock.calls[0], 'UserKnownHostsFile=');
    expect((await stat(identity)).mode & 0o777).toBe(0o600);
    expect((await stat(knownHosts)).mode & 0o777).toBe(0o600);
    expect(await readFile(knownHosts, 'utf8')).toBe(`alice-mbp.local ${KEY}\n`);
    expect(await readFile(identity, 'utf8')).toContain('BEGIN OPENSSH PRIVATE KEY');
    await link.close(); await link.close();
    expect(f.processes[0].kill).toHaveBeenCalledOnce(); expect(link.closed).toBe(true);
    await expect(stat(identity)).rejects.toThrow();
    expect(publicKeyLine(linkInput.seed)).toMatch(/^ssh-ed25519 /);
  } finally { delete process.env.SSH_AUTH_SOCK; }
});

it('picks a free local port when none is given and rejects invalid ports and bad endpoints', async () => {
  const f = linkFixture();
  const link = await f.open({ ...linkInput, localPort: undefined } as never);
  expect(link.localPort).toBeGreaterThan(0); await link.close();
  for (const bad of [{ listenPort: 0 }, { targetPort: 70000 }, { reversePort: 1.5 }, { localPort: 0 }]) {
    await expect(f.open({ ...linkInput, ...bad })).rejects.toThrow('Invalid peer tunnel port');
  }
  await expect(f.open({ ...linkInput, endpoint: { ...linkEndpoint, host: '-oProxyCommand=x' } })).rejects.toThrow('Invalid pinned SSH endpoint');
  await expect(f.open(linkInput, { signal: AbortSignal.abort() })).rejects.toThrow();
  expect(f.spawnProcess).toHaveBeenCalledTimes(1);
});

it.each([
  ['Permission denied (publickey).', 'ssh_auth_refused'],
  ['Host key verification failed.', 'ssh_host_key_mismatch'],
  ['Error: remote port forwarding failed for listen port 41001', 'ssh_forwarding_refused'],
  ['connect to host port 22: Connection refused', 'ssh_remote_login_off']
])('first open fails with a fixed code and never surfaces ssh text (%s)', async (stderr, code) => {
  const f = linkFixture(() => false);
  const pending = f.open(); const outcome = pending.then(() => undefined, failure => failure as Error);
  await vi.waitFor(() => expect(f.processes).toHaveLength(1));
  f.processes[0].stderr.write(`${stderr} secret-host`); f.processes[0].emit('close', 255);
  const error = await outcome as any;
  expect(error.code).toBe(code); expect(error.message).toBe(code); expect(error.message).not.toContain('secret');
  expect(f.states).toEqual([]);
  // slot released
  const controller = new AbortController();
  const next = f.open(linkInput, { signal: controller.signal }).then(() => undefined, failure => failure as Error);
  await vi.waitFor(() => expect(f.processes).toHaveLength(2));
  controller.abort();
  expect(await next).toBeInstanceOf(Error);
});

it.each(['timeout', 'abort', 'error'])('first open %s kills ssh and cleans up', async mode => {
  const f = linkFixture(() => false), controller = new AbortController();
  const pending = f.open(linkInput, { timeoutMs: mode === 'timeout' ? 30 : 5000, signal: controller.signal });
  const outcome = pending.then(() => undefined, failure => failure as any);
  await vi.waitFor(() => expect(f.processes).toHaveLength(1));
  const identity = argFor(f.spawnProcess.mock.calls[0], 'UserKnownHostsFile=');
  if (mode === 'abort') controller.abort();
  if (mode === 'error') f.processes[0].emit('error', new Error('ENOENT'));
  const error = await outcome;
  expect(error.code).toBe('ssh_unreachable');
  expect(f.processes[0].kill).toHaveBeenCalled();
  await expect(stat(identity)).rejects.toThrow();
});

it('reconnects on the same local port with backoff, reports state, and stops on close', async () => {
  const f = linkFixture();
  const link = await f.open();
  f.processes[0].stderr.write('Connection closed by remote host'); f.processes[0].emit('close', 255);
  expect(f.states).toEqual([[false, 'ssh_unreachable']]); expect(link.up).toBe(false);
  await vi.waitFor(() => expect(f.processes).toHaveLength(2));
  await vi.waitFor(() => expect(f.states.at(-1)).toEqual([true, undefined]));
  expect(link.up).toBe(true);
  expect((f.spawnProcess.mock.calls[1] as any)[1]).toEqual((f.spawnProcess.mock.calls[0] as any)[1]);
  // a reconnect that fails (auth revoked) is reported and retried
  f.processes[1].emit('close', 255);
  await vi.waitFor(() => expect(f.processes).toHaveLength(3));
  f.processes[2].stderr.write('Permission denied (publickey).'); f.processes[2].emit('close', 255);
  await vi.waitFor(() => expect(f.states.at(-1)).toEqual([false, 'ssh_auth_refused']));
  await vi.waitFor(() => expect(f.processes).toHaveLength(4));
  await link.close();
  const spawned = f.spawnProcess.mock.calls.length;
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.spawnProcess).toHaveBeenCalledTimes(spawned);
});

it('rejects non-ed25519 peer-link host keys (ssh is forced to HostKeyAlgorithms=ssh-ed25519) and frees slots when mkdtemp fails', async () => {
  const f = linkFixture();
  const ecdsa = `ecdsa-sha2-nistp256 ${'A'.repeat(68)}`;
  await expect(f.open({ ...linkInput, endpoint: { ...linkEndpoint, hostKey: ecdsa } })).rejects.toThrow('Invalid pinned SSH endpoint');
  expect(f.spawnProcess).not.toHaveBeenCalled();
  const original = process.env.TMPDIR;
  process.env.TMPDIR = join(tmpdir(), 'zcc-missing-tmp-root', 'nested');
  try {
    for (let i = 0; i < 5; i++) await expect(f.open()).rejects.toThrow(/ENOENT/);
  } finally { if (original === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = original; }
  const link = await f.open(); await link.close();
});

it('bounds concurrent and live peer links; close() releases them all', async () => {
  const f = linkFixture();
  const opening = Array.from({ length: 4 }, () => f.open({ ...linkInput, localPort: undefined } as never));
  await expect(f.open()).rejects.toThrow('concurrent');
  const live = await Promise.all(opening);
  for (let i = 4; i < 32; i++) live.push(await f.open({ ...linkInput, localPort: undefined } as never));
  await expect(f.open()).rejects.toThrow('Too many peer SSH tunnels');
  f.tunnels.close();
  await vi.waitFor(() => expect(live.every(link => link.closed)).toBe(true));
});

it('uses the real http probe: ready only when the forwarder answers 403 path is not allowed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-fake-ssh-'));
  let mode: 'refuse' | 'forbid' = 'refuse';
  const forwarder = createServer((_req, res) => {
    if (mode === 'refuse') { res.statusCode = 200; res.end('other'); return; }
    res.statusCode = 403; res.end(JSON.stringify({ error: 'path is not allowed' }));
  });
  await new Promise<void>(resolve => forwarder.listen(0, '127.0.0.1', resolve));
  try {
    const fake = join(dir, 'ssh');
    // Fake ssh: honours -L only, requires -N and no agent, proxies TCP to the forwarder.
    await writeFile(fake, `#!${process.execPath}
const net = require('node:net'); const args = process.argv.slice(2);
for (const need of ['-N', 'IdentityAgent=none', 'IdentitiesOnly=yes', 'ExitOnForwardFailure=yes']) if (!args.includes(need)) process.exit(9);
if (process.env.SSH_AUTH_SOCK) process.exit(8);
const [, lport, , rport] = args[args.indexOf('-L') + 1].split(':');
net.createServer(socket => { const up = net.connect(Number(rport), '127.0.0.1'); socket.pipe(up).pipe(socket);
  socket.on('error', () => {}); up.on('error', () => socket.destroy()); }).listen(Number(lport), '127.0.0.1');
`);
    await chmod(fake, 0o700);
    const tunnels = new PeerTunnels(realSpawn, fake);
    const target = (forwarder.address() as { port: number }).port;
    const first = tunnels.openPeerLink({ ...linkInput, targetPort: target, localPort: undefined } as never, () => undefined, { timeoutMs: 400, readyPollMs: 20 });
    await expect(first).rejects.toMatchObject({ code: 'ssh_unreachable' });
    mode = 'forbid';
    const link = await tunnels.openPeerLink({ ...linkInput, targetPort: target, localPort: undefined } as never, () => undefined, { timeoutMs: 10_000, readyPollMs: 20 });
    expect((await fetch(link.url)).status).toBe(403);
    await link.close();
    tunnels.close();
  } finally {
    await new Promise<void>(resolve => forwarder.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
