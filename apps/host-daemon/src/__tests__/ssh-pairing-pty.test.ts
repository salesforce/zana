import { describe, expect, it } from 'vitest';
import {
  authorizeSshPairing,
  SshPairingSession,
  type PairingPtyHandle
} from '../ssh-pairing-pty.js';

const UUID = '028c8627-a6d8-4c62-964e-8f6b35cb2335';

function fakeHandle(): PairingPtyHandle & {
  writes: string[];
  killed: boolean;
  dataCb?: (data: string) => void;
  exitCb?: (event: { exitCode: number }) => void;
} {
  const handle = {
    pid: 42,
    writes: [] as string[],
    killed: false,
    dataCb: undefined as ((data: string) => void) | undefined,
    exitCb: undefined as ((event: { exitCode: number }) => void) | undefined,
    write(data: string) { this.writes.push(data); },
    resize() {},
    kill() { this.killed = true; },
    onData(cb: (data: string) => void) { this.dataCb = cb; },
    onExit(cb: (event: { exitCode: number }) => void) { this.exitCb = cb; }
  };
  return handle;
}

describe('authorizeSshPairing', () => {
  it('builds ssh argv from allowlisted fields and the local product URL', () => {
    const result = authorizeSshPairing({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc',
      hostId: UUID,
      cols: 100,
      rows: 30
    }, { localServerUrl: 'http://127.0.0.1:8780/' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.argv.command).toBe('ssh');
    expect(result.argv.args).toEqual([
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      '18782:127.0.0.1:8780',
      'limited-pony',
      expect.stringContaining('--join-code zcde_abc')
    ]);
    expect(result.sshHost).toBe('limited-pony');
    expect(result.cols).toBe(100);
    expect(result.rows).toBe(30);
  });

  it('rejects a renderer-supplied command string and a flag-shaped host', () => {
    expect(authorizeSshPairing({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc',
      hostId: UUID,
      command: 'rm'
    }, { localServerUrl: 'http://127.0.0.1:8780/' })).toEqual({
      ok: false,
      message: 'Pairing spawn does not accept a command string'
    });
    expect(authorizeSshPairing({
      sshHost: '-oProxyCommand=x',
      joinCode: 'zcde_abc',
      hostId: UUID
    }, { localServerUrl: 'http://127.0.0.1:8780/' }).ok).toBe(false);
    expect(authorizeSshPairing({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc;id',
      hostId: UUID
    }, { localServerUrl: 'http://127.0.0.1:8780/' }).ok).toBe(false);
    expect(authorizeSshPairing({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc',
      hostId: 'host;1'
    }, { localServerUrl: 'http://127.0.0.1:8780/' }).ok).toBe(false);
  });

  it('SSHs the public installer when a public origin is configured', () => {
    const result = authorizeSshPairing({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc',
      hostId: UUID
    }, {
      localServerUrl: 'http://127.0.0.1:8780/',
      publicServerUrl: 'https://zcc-7808c5bc8f3d.herokuapp.com'
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.argv.args).toEqual([
      'limited-pony',
      expect.stringContaining('https://zcc-7808c5bc8f3d.herokuapp.com/install.sh')
    ]);
    expect(result.argv.args.some((arg) => arg.includes('-R'))).toBe(false);
  });
});

describe('SshPairingSession', () => {
  it('streams data, retains backlog, and replaces a live spawn', () => {
    const first = fakeHandle();
    const second = fakeHandle();
    const spawned: string[][] = [];
    const session = new SshPairingSession((_command, args) => {
      spawned.push(args);
      return spawned.length === 1 ? first : second;
    });
    const chunks: string[] = [];
    session.on('data', (data: string) => chunks.push(data));
    session.start({
      argv: { command: 'ssh', args: ['limited-pony'] },
      sshHost: 'limited-pony',
      cols: 80,
      rows: 24
    });
    first.dataCb?.('hello');
    expect(session.status()).toMatchObject({ running: true, sshHost: 'limited-pony', backlog: 'hello' });
    session.write('yes\n');
    expect(first.writes).toEqual(['yes\n']);

    session.start({
      argv: { command: 'ssh', args: ['kit-kat'] },
      sshHost: 'kit-kat',
      cols: 80,
      rows: 24
    });
    expect(first.killed).toBe(true);
    expect(session.status().sshHost).toBe('kit-kat');
    expect(session.status().backlog).toBe('');
    second.dataCb?.('ready');
    second.exitCb?.({ exitCode: 0 });
    expect(session.status()).toMatchObject({ running: false, exitCode: 0, backlog: 'ready' });
    expect(chunks).toEqual(['hello', 'ready']);
  });
});
