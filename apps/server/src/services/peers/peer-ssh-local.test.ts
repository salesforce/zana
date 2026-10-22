import { createServer, connect, type Server } from 'node:net';
import { access } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizedKeyInput, AuthorizedKeys } from './peer-ssh-contract.js';
import { createLocalEndpoint, preflightPeerSsh, probeSshBanner, type PeerSshLocalDeps, type SshProcess } from './peer-ssh-local.js';

const HOST_KEY = `ssh-ed25519 ${'A'.repeat(68)}`;
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.(); });
});

function listen(onConnection: (socket: import('node:net').Socket) => void): Promise<number> {
  return new Promise(resolve => {
    const server = createServer(onConnection);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
}

const base = (extra: PeerSshLocalDeps = {}): PeerSshLocalDeps => ({
  env: {},
  user: () => ({ username: 'alice', homedir: '/Users/alice' }),
  home: () => '/Users/alice',
  localHostName: async () => 'Alices-MacBook\n',
  readHostKey: async () => `${HOST_KEY} root@host\n`,
  probeBanner: async () => 'ok',
  selfTest: async () => undefined,
  warn: vi.fn(),
  ...extra
});
const signal = () => new AbortController().signal;
const reason = async (promise: Promise<unknown>) => promise.then(() => 'resolved', (error: Error) => error.message);

describe('createLocalEndpoint', () => {
  it('builds the endpoint from scutil, the OS user and the sshd host key', async () => {
    const selfTest = vi.fn(async () => undefined);
    const endpoint = await createLocalEndpoint(base({ selfTest }))(signal());
    expect(endpoint).toEqual({ host: 'Alices-MacBook.local', port: 22, user: 'alice', hostKey: HOST_KEY });
    expect(selfTest).toHaveBeenCalledWith(endpoint, expect.anything());
  });

  it('serves from Zana\'s own sshd without probing or reading the system Remote Login', async () => {
    const selfTest = vi.fn(async () => undefined);
    const probeBanner = vi.fn(async () => 'refused' as const);
    const readHostKey = vi.fn(async () => { throw new Error('ENOENT'); });
    const sshd = { ensure: vi.fn(async () => ({ port: 47123, hostKey: HOST_KEY })) };
    const endpoint = await createLocalEndpoint(base({ sshd, selfTest, probeBanner, readHostKey }))(signal());
    expect(endpoint).toEqual({ host: 'Alices-MacBook.local', port: 47123, user: 'alice', hostKey: HOST_KEY });
    expect(selfTest).toHaveBeenCalledWith(endpoint, expect.anything());
    expect(probeBanner).not.toHaveBeenCalled();
    expect(readHostKey).not.toHaveBeenCalled();
    const broken = { ensure: async () => { throw new Error('ssh_remote_login_off'); } };
    expect(await reason(createLocalEndpoint(base({ sshd: broken }))(signal()))).toBe('ssh_remote_login_off');
    const badKey = { ensure: async () => ({ port: 47123, hostKey: 'ssh-rsa AAAA' }) };
    expect(await reason(createLocalEndpoint(base({ sshd: badKey }))(signal()))).toBe('ssh_remote_login_off');
  });

  it.each(['refused', 'no-banner'] as const)('maps a %s banner probe to ssh_remote_login_off', async result => {
    expect(await reason(createLocalEndpoint(base({ probeBanner: async () => result }))(signal()))).toBe('ssh_remote_login_off');
  });

  it('rejects an unreadable or malformed host key as ssh_remote_login_off', async () => {
    expect(await reason(createLocalEndpoint(base({ readHostKey: async () => { throw new Error('ENOENT'); } }))(signal()))).toBe('ssh_remote_login_off');
    expect(await reason(createLocalEndpoint(base({ readHostKey: async () => 'ssh-rsa AAAA' }))(signal()))).toBe('ssh_remote_login_off');
  });

  it('rejects a missing or unsafe LocalHostName as ssh_unreachable', async () => {
    expect(await reason(createLocalEndpoint(base({ localHostName: async () => { throw new Error('x'); } }))(signal()))).toBe('ssh_unreachable');
    expect(await reason(createLocalEndpoint(base({ localHostName: async () => 'bad host;rm' }))(signal()))).toBe('ssh_unreachable');
  });

  it('propagates the self-test failure reason', async () => {
    const selfTest = async () => { throw new Error('ssh_auth_refused'); };
    expect(await reason(createLocalEndpoint(base({ selfTest }))(signal()))).toBe('ssh_auth_refused');
  });

  it('warns when the account home differs from $HOME', async () => {
    const warn = vi.fn();
    await createLocalEndpoint(base({ warn, home: () => '/tmp/other' }))(signal());
    expect(warn).toHaveBeenCalledTimes(1);
    const quiet = vi.fn();
    await createLocalEndpoint(base({ warn: quiet }))(signal());
    expect(quiet).not.toHaveBeenCalled();
  });

  it('returns the validated E2E override only when ZCC_E2E_HOME is set', async () => {
    const override = { host: 'localhost', port: 45022, user: 'e2e', hostKey: HOST_KEY };
    const env = { ZCC_E2E_PEER_SSH_ENDPOINT: JSON.stringify(override) };
    const probeBanner = vi.fn(async () => 'refused' as const);
    const selfTest = vi.fn(async () => undefined);
    expect(await createLocalEndpoint(base({ env: { ...env, ZCC_E2E_HOME: '/tmp/e2e' }, probeBanner, selfTest }))(signal())).toEqual(override);
    expect(selfTest).toHaveBeenCalledWith(override, expect.anything());
    expect(probeBanner).not.toHaveBeenCalled();
    // Without the isolation marker the override is ignored and the real probe decides.
    expect(await reason(createLocalEndpoint(base({ env, probeBanner }))(signal()))).toBe('ssh_remote_login_off');
  });

  it.each(['not json', '{"host":"h"}', JSON.stringify({ host: 'h', port: 0, user: 'u', hostKey: HOST_KEY }),
    JSON.stringify({ host: 'h', port: 22, user: 'u', hostKey: 'ssh-ed25519 short' }),
    JSON.stringify({ host: '-oProxyCommand=x', port: 22, user: 'u', hostKey: HOST_KEY }),
    JSON.stringify({ host: 'a b', port: 22, user: 'u', hostKey: HOST_KEY }),
    JSON.stringify({ host: 'h', port: 22, user: '-oFoo=bar', hostKey: HOST_KEY }),
    JSON.stringify({ host: 'h', port: 22, user: 'u v', hostKey: HOST_KEY })])('ignores an invalid E2E override %s', async raw => {
    const deps = base({ env: { ZCC_E2E_HOME: '/tmp/e2e', ZCC_E2E_PEER_SSH_ENDPOINT: raw } });
    expect((await createLocalEndpoint(deps)(signal())).host).toBe('Alices-MacBook.local');
  });
});

describe('default self-test', () => {
  const recorder = () => {
    const calls: string[] = [];
    const lines = new Map<string, AuthorizedKeyInput>();
    const authorizedKeys: AuthorizedKeys = {
      upsert: async input => { calls.push('upsert'); lines.set(input.linkId, input); },
      remove: async linkId => { calls.push('remove'); lines.delete(linkId); },
      reconcile: async () => undefined,
      list: async () => []
    };
    return { calls, lines, authorizedKeys };
  };
  const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;
  /** Fake ssh that, like the real one, listens on the -L port and relays to the -L target. */
  const proxySsh = (mode: 'ok' | 'drop', streamLocal: 'refused' | 'allowed' = 'refused') => (args: string[]): SshProcess => {
    const remote = arg(args, '-R');
    if (remote.startsWith('/')) {
      const path = remote.split(':')[0]!;
      if (streamLocal === 'refused') return {
        exited: Promise.resolve({ code: 255, stderr: `Error: remote port forwarding failed for listen path ${path}\r\n` }),
        kill: () => undefined
      };
      const socket = createServer();
      socket.listen(path);
      return { exited: new Promise(() => undefined), kill: () => { socket.close(); } };
    }
    const [, localPort, , targetPort] = arg(args, '-L').split(':');
    const server = createServer(client => {
      if (mode === 'drop') { client.destroy(); return; }
      const upstream = connect({ host: '127.0.0.1', port: Number(targetPort) });
      client.pipe(upstream); upstream.pipe(client);
      client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
    });
    server.listen(Number(localPort), '127.0.0.1');
    return { exited: new Promise(() => undefined), kill: () => { server.close(); server.closeAllConnections?.(); } };
  };
  const run = (spawnSsh: (args: string[]) => SshProcess, authorizedKeys?: AuthorizedKeys) =>
    createLocalEndpoint({ ...base({ spawnSsh, authorizedKeys }), selfTest: undefined })(signal());

  it('passes only after TCP works and the Unix-socket remote forward is explicitly refused', async () => {
    const { calls, lines, authorizedKeys } = recorder();
    const captured: string[][] = [];
    await run(args => { captured.push(args); return proxySsh('ok')(args); }, authorizedKeys);
    expect(calls).toEqual(['upsert', 'remove']);
    expect(lines.size).toBe(0);
    const args = captured[0]!;
    expect(args).toContain('-N');
    expect(args.slice(-4)).toEqual(['-l', 'alice', '--', 'localhost']);
    expect(args[args.length - 1]).toBe('localhost');
    expect(captured).toHaveLength(2);
    expect(arg(captured[1]!, '-R')).toMatch(/^\/.*:127\.0\.0\.1:\d+$/);
    expect(captured[1]).toContain('ExitOnForwardFailure=yes');
    expect(captured[1]).not.toContain('-L');
  });

  it('refuses setup when sshd creates a Unix-socket remote listener and cleans every resource', async () => {
    const { authorizedKeys, calls, lines } = recorder();
    const paths: string[] = [];
    const kills: ReturnType<typeof vi.fn>[] = [];
    const result = run(args => {
      const remote = arg(args, '-R');
      if (remote.startsWith('/')) paths.push(remote.split(':')[0]!);
      const process = proxySsh('ok', 'allowed')(args);
      const kill = vi.fn(process.kill); kills.push(kill);
      return { ...process, kill };
    }, authorizedKeys);
    expect(await reason(result)).toBe('ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
    expect(paths).toHaveLength(1);
    await expect(access(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(kills).toHaveLength(2);
    for (const kill of kills) expect(kill).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['upsert', 'remove']);
    expect(lines.size).toBe(0);
  });

  it.each([
    { code: 255, stderr: 'Permission denied (publickey).' },
    { code: 255, stderr: 'Host key verification failed.' },
    { code: 0, stderr: '' },
    { code: null, stderr: 'spawn failed' },
    { code: 255, stderr: 'remote port forwarding failed for listen path /another/path' }
  ])('fails closed on an unproven stream-local rejection: %j', async exit => {
    const { authorizedKeys, lines } = recorder();
    expect(await reason(run(args => arg(args, '-R').startsWith('/')
      ? { exited: Promise.resolve(exit), kill: () => undefined } : proxySsh('ok')(args), authorizedKeys)))
      .toBe('ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
    expect(lines.size).toBe(0);
  });

  it('fails closed without an authorizedKeys manager', async () => {
    const spawnSsh = vi.fn();
    expect(await reason(run(spawnSsh as never))).toBe('ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
    expect(spawnSsh).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort'] as const)('fails closed on stream-local probe %s and kills ssh', async mode => {
    const { authorizedKeys, lines } = recorder();
    const controller = new AbortController();
    const kill = vi.fn();
    const spawnSsh = (args: string[]): SshProcess => {
      if (!arg(args, '-R').startsWith('/')) return proxySsh('ok')(args);
      if (mode === 'abort') controller.abort();
      else {
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => { now += 11_000; return now; });
      }
      return { exited: new Promise(() => undefined), kill };
    };
    const out = createLocalEndpoint({ ...base({ spawnSsh, authorizedKeys }), selfTest: undefined })(controller.signal);
    expect(await reason(out)).toBe('ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
    expect(kill).toHaveBeenCalledTimes(1);
    expect(lines.size).toBe(0);
  });

  it('reports ssh_forwarding_refused when the forward closes without data', async () => {
    const { authorizedKeys, lines } = recorder();
    expect(await reason(run(proxySsh('drop'), authorizedKeys))).toBe('ssh_forwarding_refused');
    expect(lines.size).toBe(0);
  });

  it('classifies an ssh exit by its stderr', async () => {
    const { authorizedKeys, lines } = recorder();
    const dead = (stderr: string) => (): SshProcess => ({ exited: Promise.resolve({ code: 255, stderr }), kill: () => undefined });
    expect(await reason(run(dead('alice@localhost: Permission denied (publickey).'), authorizedKeys))).toBe('ssh_auth_refused');
    expect(await reason(run(dead('Host key verification failed.'), authorizedKeys))).toBe('ssh_host_key_mismatch');
    expect(lines.size).toBe(0);
  });

  it('removes the throwaway line even when upsert path fails afterwards', async () => {
    const { authorizedKeys, calls } = recorder();
    const spawnSsh = () => { throw new Error('spawn failed'); };
    expect(await reason(run(spawnSsh, authorizedKeys))).toBe('spawn failed');
    expect(calls).toEqual(['upsert', 'remove']);
  });

  it('aborts promptly when the signal fires', async () => {
    const { authorizedKeys } = recorder();
    const controller = new AbortController();
    controller.abort();
    const out = createLocalEndpoint({ ...base({ spawnSsh: () => ({ exited: new Promise(() => undefined), kill: () => undefined }), authorizedKeys }), selfTest: undefined })(controller.signal);
    expect(await reason(out)).toBe('ssh_unreachable');
  });
});

describe('probeSshBanner', () => {
  it('accepts an SSH-2.0 banner', async () => {
    const port = await listen(socket => { socket.write('SSH-2.0-OpenSSH_9.9\r\n'); });
    expect(await probeSshBanner('127.0.0.1', port, signal())).toBe('ok');
  });
  it('rejects a non-SSH banner', async () => {
    const port = await listen(socket => { socket.write('HTTP/1.1 400 Bad\r\n'); });
    expect(await probeSshBanner('127.0.0.1', port, signal())).toBe('no-banner');
  });
  it('reports a refused connection', async () => {
    const port = await listen(() => undefined);
    await new Promise<void>(resolve => { servers.pop()!.close(() => resolve()); });
    expect(await probeSshBanner('127.0.0.1', port, signal())).toBe('refused');
  });
  it('treats an early close and an aborted signal as no banner', async () => {
    const port = await listen(socket => { socket.end(); });
    expect(await probeSshBanner('127.0.0.1', port, signal())).toBe('no-banner');
    const controller = new AbortController();
    controller.abort();
    expect(await probeSshBanner('127.0.0.1', port, controller.signal)).toBe('no-banner');
  });
});

describe('preflightPeerSsh', () => {
  it('resolves when the name resolves and TCP connects', async () => {
    const connectTcp = vi.fn(async () => undefined);
    await preflightPeerSsh('a.local', 22, signal(), { lookup: async () => ({ address: '10.0.0.2' }), connectTcp });
    expect(connectTcp).toHaveBeenCalledWith('a.local', 22, expect.anything());
  });
  it('maps lookup and connect failures to ssh_unreachable', async () => {
    expect(await reason(preflightPeerSsh('a.local', 22, signal(), { lookup: async () => { throw new Error('ENOTFOUND'); } }))).toBe('ssh_unreachable');
    expect(await reason(preflightPeerSsh('a.local', 22, signal(), { lookup: async () => ({}), connectTcp: async () => { throw new Error('ECONNREFUSED'); } }))).toBe('ssh_unreachable');
  });
  it('uses the real TCP connect by default', async () => {
    const port = await listen(socket => { socket.end(); });
    await preflightPeerSsh('127.0.0.1', port, signal(), { lookup: async () => ({}) });
    const dead = await listen(() => undefined);
    await new Promise<void>(resolve => { servers.pop()!.close(() => resolve()); });
    expect(await reason(preflightPeerSsh('127.0.0.1', dead, signal(), { lookup: async () => ({}) }))).toBe('ssh_unreachable');
    const controller = new AbortController();
    controller.abort();
    expect(await reason(preflightPeerSsh('127.0.0.1', port, controller.signal, { lookup: async () => ({}) }))).toBe('ssh_unreachable');
  });
});

describe('checkRemoteLogin', () => {
  it('reports ok, each fixed reason, and unreachable for anything else', async () => {
    const { checkRemoteLogin } = await import('./peer-ssh-local.js');
    const signal = new AbortController().signal;
    expect(await checkRemoteLogin(async () => ({}), signal)).toEqual({ ok: true });
    expect(await checkRemoteLogin(async () => { throw new Error('ssh_remote_login_off'); }, signal)).toEqual({ ok: false, reason: 'ssh_remote_login_off' });
    expect(await checkRemoteLogin(async () => { throw new Error('ssh_auth_refused'); }, signal)).toEqual({ ok: false, reason: 'ssh_auth_refused' });
    expect(await checkRemoteLogin(async () => { throw new Error('/etc/secret path'); }, signal)).toEqual({ ok: false, reason: 'ssh_unreachable' });
    expect(await checkRemoteLogin(async () => { throw 'str'; }, signal)).toEqual({ ok: false, reason: 'ssh_unreachable' });
  });

  it('reports stream-local forwarding separately and keys detailed messages on their reason', async () => {
    const { checkRemoteLogin } = await import('./peer-ssh-local.js');
    const signal = new AbortController().signal;
    expect(await checkRemoteLogin(async () => {
      throw new Error('ssh_forwarding_refused: serving sshd must disable stream-local forwarding (AllowStreamLocalForwarding no)');
    }, signal)).toEqual({ ok: false, reason: 'ssh_stream_local_allowed' });
    expect(await checkRemoteLogin(async () => { throw new Error('ssh_auth_refused: detail'); }, signal)).toEqual({ ok: false, reason: 'ssh_auth_refused' });
    expect(await checkRemoteLogin(async () => { throw new Error('mystery: detail'); }, signal)).toEqual({ ok: false, reason: 'ssh_unreachable' });
  });
});
