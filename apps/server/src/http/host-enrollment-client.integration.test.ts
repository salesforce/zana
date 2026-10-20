import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { resolveHostArtifact } from '../services/hosts/host-artifact.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-enrollment-client-'))), unpack = join(base, 'unpack');
beforeAll(async () => {
  const artifact = await resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' });
  mkdirSync(unpack);
  expect(spawnSync('tar', ['-xzf', artifact.tarballPath, '-C', unpack]).status).toBe(0);
}, 60_000);
afterAll(() => rmSync(base, { recursive: true, force: true }));

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
  await exited;
}

it('packed enrollment preflight refuses a different server without touching an active daemon lock or auth', () => {
  const dataDir = join(base, 'preflight'); mkdirSync(dataDir);
  const hostId = randomUUID(), auth = JSON.stringify({ hostId, hostKey: 'o'.repeat(43), serverUrl: 'https://old.example' });
  writeFileSync(join(dataDir, 'auth.json'), auth);
  writeFileSync(join(dataDir, 'daemon.lock'), 'active-owner');
  const args = [join(unpack, 'join.mjs'), 'join', '--check-enrollment', '--host-id', hostId, '--server-url', 'https://new.example'];
  const env = { ...process.env, ZCC_DATA_DIR: dataDir };
  const refused = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('replace-enrollment');
  expect(spawnSync(process.execPath, [...args, '--replace-enrollment'], { env }).status).toBe(0);
  expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe(auth);
  expect(readFileSync(join(dataDir, 'daemon.lock'), 'utf8')).toBe('active-owner');
});

it.each(['wrong-host', 'oversized', 'redirect', 'stalled-body', 'invalid-json'] as const)('packed daemon preserves repair credentials after %s enrollment', async mode => {
  const hostId = randomUUID(), token = 'zcde_' + 't'.repeat(24), requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!); req.resume();
    if (mode === 'redirect') { res.writeHead(307, { location: '/redirected' }).end(); return; }
    res.writeHead(201, { 'content-type': 'application/json' });
    if (mode === 'stalled-body') { res.write('{'); return; }
    if (mode === 'invalid-json') { res.end(token); return; }
    res.end((mode === 'oversized' ? ' '.repeat(20 * 1024) : '') + JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: mode === 'wrong-host' ? randomUUID() : hostId, hostKey: 'n'.repeat(43) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = join(base, mode), dataDir = join(home, '.zcc-machines', 'fixture'); mkdirSync(dataDir, { recursive: true });
  const originalAuth = JSON.stringify({ hostId, hostKey: 'o'.repeat(43), hostName: 'Existing machine', serverUrl, enrollmentId: '0'.repeat(64) });
  writeFileSync(join(dataDir, 'host.id'), hostId);
  writeFileSync(join(dataDir, 'auth.json'), originalAuth);
  writeFileSync(join(dataDir, 'connect-access.json'), JSON.stringify({ hostId, serverUrl, instanceId: randomUUID(), serverId: randomUUID(), machineId: randomUUID(), credential: 'c'.repeat(43) }));
  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, [join(unpack, 'join.mjs'), 'join', '--join-code', token, '--host-id', hostId,
      '--server-url', serverUrl, '--replace-enrollment', '--host-daemon-port', String(await freePort())], {
      cwd: home, detached: true, env: { PATH: process.env.PATH, HOME: home, ZCC_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = ''; child.stderr!.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16_384); });
    const closed = new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve); });
    const timer = setTimeout(() => { if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 30_000);
    let code: number | null;
    try { code = await closed; } finally { clearTimeout(timer); }
    expect(code, stderr).toBe(1);
    expect(stderr).toContain(mode === 'wrong-host' ? 'different machine' : mode === 'oversized' ? 'too large' : mode === 'stalled-body' ? 'timed out' : mode === 'invalid-json' ? 'Invalid host enrollment response' : 'fetch failed');
    expect(stderr).not.toContain(token);
    expect(requests).toEqual(['/internal/hosts/enroll']);
    expect(readFileSync(join(dataDir, 'host.id'), 'utf8')).toBe(hostId);
    expect(readFileSync(join(dataDir, 'auth.json'), 'utf8')).toBe(originalAuth);
    expect(existsSync(join(dataDir, 'daemon.lock'))).toBe(false);
  } finally {
    await stop(child); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 60_000);
