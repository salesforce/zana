import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installMachine, assertCompatible, originOf, boundedResponse, validateGrant } from './install.mjs';
const homes: string[] = [];
const home = () => { const h = mkdtempSync(join(tmpdir(), 'zana-machine-install-')); homes.push(h); return h; };
afterEach(() => homes.splice(0).forEach(h => rmSync(h, { recursive: true, force: true })));
const grant = () => ({ serverId: randomUUID(), instanceId: randomUUID(), machineId: randomUUID(), hostId: randomUUID(), accountUrl: 'https://account.example', serverUrl: 'https://alice.example', credential: 'a'.repeat(43), enrollToken: 'zcde_' + 'b'.repeat(24), expiresAt: Date.now() + 60_000 });
const code = 'A'.repeat(32);
it('installs in an instance-specific private home without touching local Zana; never puts credentials in argv', async () => {
  const h = home(), g = grant(); mkdirSync(join(h, '.zcc')); writeFileSync(join(h, '.zcc', 'canary'), 'unchanged');
  const fetcher = vi.fn(async (url: string, options: any) => {
    expect(options.redirect).toBe('error');
    if (url.endsWith('/redeem')) { expect(JSON.parse(options.body).attemptSecret).toHaveLength(43); return Response.json(g); }
    expect(options.headers['x-zcc-machine-credential']).toBe(g.credential);
    return new Response('#!/bin/sh\nexit 0');
  });
  const execute = vi.fn(async (file: string, env: any, args: string[]) => {
    expect(readFileSync(file, 'utf8')).toContain('exit 0');
    expect(args.join(' ')).not.toContain(g.credential);
    expect(args.join(' ')).not.toContain(g.enrollToken);
    expect(JSON.stringify(env)).not.toContain(g.credential);
    expect(readFileSync(env.ZCC_CONNECT_HEADER_FILE, 'utf8')).toContain(g.credential);
    expect(statSync(env.ZCC_CONNECT_HEADER_FILE).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(env.ZCC_DATA_DIR, 'connect-access.json'), 'utf8'))).toMatchObject({ instanceId: g.instanceId });
  });
  const result = await installMachine({ accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher, execute });
  expect(result.dataDir).toBe(join(h, '.zcc-machines', g.instanceId));
  expect(readFileSync(join(h, '.zcc', 'canary'), 'utf8')).toBe('unchanged');
  expect(readdirSync(result.dataDir).sort()).toEqual(['connect-access.json', 'connect-enroll.json']);
  expect(readdirSync(join(h, '.zcc-machines/pairing'))).toEqual([]);
});
it('reuses the private proof after a lost response and cached grant after partial installation', async () => {
  const h = home(), g = grant(); const proofs: string[] = []; let calls = 0;
  const fetcher = vi.fn(async (url: string, options: any) => {
    if (url.endsWith('/redeem')) { proofs.push(JSON.parse(options.body).attemptSecret); if (++calls === 1) throw new Error('lost response'); return Response.json(g); }
    return new Response('installer');
  });
  const options = { accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher, execute: async () => { throw new Error('interrupted'); } };
  await expect(installMachine(options)).rejects.toThrow('lost response');
  await expect(installMachine(options)).rejects.toThrow('interrupted');
  await installMachine({ ...options, execute: async () => {} });
  expect(proofs).toHaveLength(2); expect(proofs[0]).toBe(proofs[1]);
});
it('preserves a conflicting existing identity and secrets', async () => {
  const h = home(), g = grant(), dir = join(h, '.zcc-machines', g.instanceId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'host.id'), randomUUID()); writeFileSync(join(dir, 'auth.json'), 'canary');
  const execute = vi.fn();
  await expect(installMachine({ accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher: async () => Response.json(g), execute })).rejects.toThrow('another machine');
  expect(readFileSync(join(dir, 'auth.json'), 'utf8')).toBe('canary'); expect(execute).not.toHaveBeenCalled();
});
it('forwards explicit replacement consent without exporting it into the service environment', async () => {
  const h = home(), g = grant(), dir = join(h, '.zcc-machines', g.instanceId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'host.id'), randomUUID());
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ hostId: randomUUID(), serverUrl: 'https://other.example' }));
  const execute = vi.fn(async (_file: string, env: any, args: string[]) => {
    expect(args).toContain('--replace-enrollment');
    expect(env.ZCC_HOST_REPLACE_ENROLLMENT).toBeUndefined();
  });
  await installMachine({ accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, replaceEnrollment: true,
    fetcher: async (url: string) => url.endsWith('/redeem') ? Response.json(g) : new Response('script'), execute });
  expect(execute).toHaveBeenCalledOnce();
});
it('parses replacement consent exactly once in the Connect command', async () => {
  const { main } = await import('./install.mjs');
  const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } }, install = vi.fn();
  const args = ['--account', 'https://account.example', '--code', code, '--server-id', randomUUID()];
  expect(await main([...args, '--replace-enrollment'], install, io)).toBe(0);
  expect(install).toHaveBeenCalledWith(expect.objectContaining({ replaceEnrollment: true }));
  expect(await main([...args, '--replace-enrollment', '--replace-enrollment'], install, io)).toBe(1);
});
it('allows repair only for the same instance and host, refusing linked data and wrong-server auth', () => {
  const h = home(), g = grant(), dir = join(h, 'machine'); mkdirSync(dir);
  writeFileSync(join(dir, 'host.id'), g.hostId); writeFileSync(join(dir, 'connect-access.json'), JSON.stringify(g));
  expect(() => assertCompatible(dir, g)).not.toThrow();
  expect(() => assertCompatible(dir, { ...g, serverId: randomUUID() })).toThrow('another instance');
  writeFileSync(join(dir, 'auth.json'), JSON.stringify({ hostId: g.hostId, serverUrl: 'https://other.example' }));
  expect(() => assertCompatible(dir, g)).toThrow('another server');
  const linked = join(h, 'linked'); symlinkSync(dir, linked);
  expect(() => assertCompatible(linked, g)).toThrow('symlink');
});
it('bounds responses and rejects malformed grants and insecure destinations before executing', async () => {
  for (const url of ['http://example.com', 'https://user:pw@example.com', 'https://example.com/path', 'https://example.com/?q=1']) expect(() => originOf(url)).toThrow();
  expect(() => validateGrant({}, 'https://account.example', randomUUID())).toThrow();
  const g = grant(); expect(() => validateGrant(g, g.accountUrl, randomUUID())).toThrow();
  await expect(boundedResponse(new Response('x'.repeat(100)), 10)).rejects.toThrow('too large');
  await expect(boundedResponse(new Response('', { status: 403 }), 10)).rejects.toThrow('403');
  await expect(boundedResponse(new Response(null), 10)).rejects.toThrow('Empty');
  await expect(installMachine({ accountUrl: g.accountUrl, code: 'bad', serverId: g.serverId, home: home() })).rejects.toThrow('complete');
});
it('serializes concurrent attempts and releases the installation lock on failure', async () => {
  const h = home(), g = grant(); let release!: () => void;
  const options = { accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher: async (url: string) => url.endsWith('/redeem') ? Response.json(g) : new Response('script'), execute: () => new Promise<void>(r => { release = r; }) };
  const first = installMachine(options);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(installMachine(options)).rejects.toThrow('in progress');
  release(); await first;
});

it('recovers a dead enrollment lock but refuses damaged, linked or excessive attempts', async () => {
  const { createHash } = await import('node:crypto');
  const { utimesSync } = await import('node:fs');
  const h = home(), g = grant(), attempts = join(h, '.zcc-machines/pairing'); mkdirSync(attempts, { recursive: true });
  const id = createHash('sha256').update(`${g.accountUrl}:${g.serverId}:${code}`).digest('hex');
  const lock = join(attempts, `${id}.json.lock`);
  writeFileSync(lock, JSON.stringify({ pid: 2147483647, nonce: 'dead' }));
  const expired = join(attempts, `${'b'.repeat(64)}.json`); writeFileSync(expired, '{}'); utimesSync(expired, new Date(0), new Date(0));
  const options = { accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher: async (url: string) => url.endsWith('/redeem') ? Response.json(g) : new Response('script'), execute: async () => {} };
  await installMachine(options);
  expect(readdirSync(attempts)).toEqual([]);
  writeFileSync(lock, JSON.stringify({ pid: -1 })); await expect(installMachine(options)).rejects.toThrow('Invalid enrollment lock'); rmSync(lock);
  const pending = join(attempts, `${id}.json`); writeFileSync(pending, JSON.stringify({ attemptSecret: 'wrong' }));
  await expect(installMachine(options)).rejects.toThrow('Invalid saved pairing'); rmSync(pending);
  writeFileSync(pending, 'x'.repeat(8193)); await expect(installMachine(options)).rejects.toThrow('Invalid saved enrollment'); rmSync(pending);
  symlinkSync(join(h, '.zcc-machines'), pending); await expect(installMachine(options)).rejects.toThrow('Invalid saved enrollment'); rmSync(pending);
  for (let i = 0; i < 1001; i++) writeFileSync(join(attempts, `preserved-${i}`), '');
  await expect(installMachine(options)).rejects.toThrow('Too many saved');
});
it('rejects symlinked roots and pairing directories before any request', async () => {
  const h = home(), target = home(), g = grant(), fetcher = vi.fn();
  symlinkSync(target, join(h, '.zcc-machines'));
  await expect(installMachine({ accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher })).rejects.toThrow('private directory');
  rmSync(join(h, '.zcc-machines')); mkdirSync(join(h, '.zcc-machines')); symlinkSync(target, join(h, '.zcc-machines/pairing'));
  await expect(installMachine({ accountUrl: g.accountUrl, code, serverId: g.serverId, home: h, fetcher })).rejects.toThrow('pairing directory');
  expect(fetcher).not.toHaveBeenCalled();
});
it('executes the real installer process, reports failure, and kills a timed-out process group', async () => {
  const { runInstaller } = await import('./install.mjs');
  const { existsSync } = await import('node:fs');
  const h = home(), script = join(h, 'installer.sh'), marker = join(h, 'escaped-child');
  writeFileSync(script, 'exit 0\n'); await runInstaller(script, { PATH: '/usr/bin:/bin' }, []);
  writeFileSync(script, 'exit 7\n'); await expect(runInstaller(script, {}, [])).rejects.toThrow('failed');
  writeFileSync(script, 'trap "" TERM\n(sleep 0.3; touch "$1") &\nwait\n');
  await expect(runInstaller(script, { PATH: '/usr/bin:/bin' }, [marker], { timeoutMs: 30, killGraceMs: 30 })).rejects.toThrow('timed out');
  await new Promise(resolve => setTimeout(resolve, 350)); expect(existsSync(marker)).toBe(false);
  const { EventEmitter } = await import('node:events');
  const broken = Object.assign(new EventEmitter(), { pid: undefined });
  const failed = runInstaller(script, {}, [], { spawnProcess: () => { queueMicrotask(() => broken.emit('error', new Error('spawn failed'))); return broken; } });
  await expect(failed).rejects.toThrow('spawn failed');
});
it('validates the standalone command and reports success only after installation', async () => {
  const { main } = await import('./install.mjs');
  const io = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } }, install = vi.fn();
  const args = ['--account', 'https://account.example', '--code', code, '--server-id', randomUUID()];
  expect(await main(args, install, io)).toBe(0); expect(install).toHaveBeenCalledOnce(); expect(io.stdout.write).toHaveBeenCalledOnce();
  for (const input of [[], args.slice(0, 5), ['--unknown', 'x', ...args.slice(2)], ['--account', 'x', '--account', 'x', '--code', code], ['--account', '--code', ...args.slice(2)]]) expect(await main(input, install, io)).toBe(1);
  expect(install).toHaveBeenCalledOnce();
  install.mockRejectedValueOnce(new Error('offline')); expect(await main(args, install, io)).toBe(1);
  install.mockRejectedValueOnce(null); expect(await main(args, install, io)).toBe(1);
  expect(io.stdout.write).toHaveBeenCalledOnce();
});
