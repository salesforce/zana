import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const UUID = '028c8627-a6d8-4c62-964e-8f6b35cb2335';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, { invoke: (...args: any[]) => any; fallback: (...args: any[]) => any }>(),
  sent: [] as Array<[string, unknown]>,
  listeners: new Map<string, (...args: any[]) => void>(),
  session: {
    on: vi.fn(),
    start: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(() => ({ running: false, sshHost: null, backlog: '', exitCode: null }))
  },
  ctx: {
    runtimeSupervisor: null as unknown,
    safeSend: (channel: string, payload: unknown) => { fixture.sent.push([channel, payload]); },
    safeHandle: (channel: string, invoke: (...args: any[]) => any, fallback: (...args: any[]) => any) => {
      fixture.handlers.set(channel, { invoke, fallback });
    }
  }
}));

vi.mock('./ctx.js', () => ({ ctx: fixture.ctx }));
vi.mock('../window/renderer-url.js', () => ({ productServerUrl: () => 'http://127.0.0.1:8780' }));
vi.mock('@zana-ai/zcc-host-daemon/ssh-pairing-pty', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-host-daemon/ssh-pairing-pty')>();
  fixture.session.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
    fixture.listeners.set(event, cb);
  });
  return { ...actual, sshPairingSession: fixture.session };
});

import { registerHostsPairingIpc, startHostPairing } from './hosts-pairing.js';

const request = { sshHost: 'limited-pony', joinCode: 'zcde_abc', hostId: UUID, cols: 90, rows: 30 };

function useTarget(target: unknown): void {
  fixture.ctx.runtimeSupervisor = { pairingTarget: vi.fn(async () => target) };
}

function spawnedArgs(): string[] {
  expect(fixture.session.start).toHaveBeenCalledOnce();
  return fixture.session.start.mock.calls[0]![0].argv.args;
}

beforeEach(() => {
  fixture.handlers.clear();
  fixture.sent.length = 0;
  fixture.ctx.runtimeSupervisor = null;
  fixture.session.start.mockReset();
  fixture.session.write.mockClear();
  fixture.session.resize.mockClear();
  fixture.session.stop.mockClear();
  fixture.session.status.mockClear();
});

describe('startHostPairing', () => {
  it('installs through the relay session origin over a one-shot SSH PTY', async () => {
    useTarget({ kind: 'relay', serverUrl: 'https://relay.example/t/zcrs_abcdefghijklmnop' });
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'pty' });
    const args = spawnedArgs();
    expect(args[0]).toBe('limited-pony');
    expect(args[1]).toContain('https://relay.example/t/zcrs_abcdefghijklmnop/install.sh');
    expect(args[1]).toContain('--server https://relay.example/t/zcrs_abcdefghijklmnop');
    expect(args.join(' ')).not.toContain('-R');
    expect(args.join(' ')).not.toContain('sleep infinity');
    expect(fixture.session.start.mock.calls[0]![0]).toMatchObject({ sshHost: 'limited-pony', cols: 90, rows: 30 });
  });

  it('installs against a direct origin unchanged', async () => {
    useTarget({ kind: 'direct', serverUrl: 'https://own.example' });
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'pty' });
    const args = spawnedArgs();
    expect(args).toEqual([
      'limited-pony',
      'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://own.example/install.sh'
        + ` | sh -s -- --join-code zcde_abc --host-id ${UUID} --server https://own.example`
    ]);
  });

  it('uses the reverse tunnel only for an explicit loopback dev origin', async () => {
    useTarget({ kind: 'direct', serverUrl: 'http://127.0.0.1:8780' });
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'pty' });
    expect(spawnedArgs().slice(0, 4)).toEqual(['-o', 'ExitOnForwardFailure=yes', '-R', '18782:127.0.0.1:8780']);
  });

  it.each(['relay_offline', 'relay_unconfigured', 'no_session', 'no_public_origin'] as const)(
    'hands off to the bootstrap stream without spawning a PTY for %s',
    async (reason) => {
      useTarget({ kind: 'tunnel', reason });
      await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'tunnel', reason });
      expect(fixture.session.start).not.toHaveBeenCalled();
    }
  );

  it('treats a missing supervisor or a failing selector as tunnel', async () => {
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'tunnel', reason: 'relay_offline' });
    fixture.ctx.runtimeSupervisor = {};
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'tunnel', reason: 'relay_offline' });
    fixture.ctx.runtimeSupervisor = { pairingTarget: vi.fn(async () => { throw new Error('down'); }) };
    await expect(startHostPairing(request)).resolves.toEqual({ ok: true, handoff: 'tunnel', reason: 'relay_offline' });
    expect(fixture.session.start).not.toHaveBeenCalled();
  });

  it('still validates the SSH host before a tunnel handoff', async () => {
    useTarget({ kind: 'tunnel', reason: 'no_public_origin' });
    for (const req of [null, 'limited-pony', { sshHost: '-oProxyCommand=x' }, { sshHost: 7 }]) {
      await expect(startHostPairing(req)).resolves.toEqual({ ok: false, message: 'Choose a valid SSH host' });
    }
  });

  it('rejects invalid relay requests and surfaces spawn failures', async () => {
    useTarget({ kind: 'relay', serverUrl: 'https://relay.example/t/zcrs_abcdefghijklmnop' });
    await expect(startHostPairing({ ...request, command: 'rm -rf /' })).resolves.toEqual({
      ok: false,
      message: 'Pairing spawn does not accept a command string'
    });
    fixture.session.start.mockImplementationOnce(() => { throw new Error('pty unavailable'); });
    await expect(startHostPairing(request)).resolves.toEqual({ ok: false, message: 'pty unavailable' });
    fixture.session.start.mockImplementationOnce(() => { throw 'boom'; });
    await expect(startHostPairing(request)).resolves.toEqual({ ok: false, message: 'Could not start SSH pairing' });
  });
});

describe('registerHostsPairingIpc', () => {
  it('wires every pairing channel to the main-owned session and forwards output', async () => {
    registerHostsPairingIpc();
    registerHostsPairingIpc();
    expect(fixture.session.on).toHaveBeenCalledTimes(2);
    fixture.listeners.get('data')!('hello');
    fixture.listeners.get('exit')!(3);
    expect(fixture.sent).toEqual([[IPC.hosts.pairingOnData, 'hello'], [IPC.hosts.pairingOnExit, 3]]);

    useTarget({ kind: 'tunnel', reason: 'no_session' });
    await expect(fixture.handlers.get(IPC.hosts.pairingStart)!.invoke(request))
      .resolves.toEqual({ ok: true, handoff: 'tunnel', reason: 'no_session' });
    expect(fixture.handlers.get(IPC.hosts.pairingStart)!.fallback())
      .toEqual({ ok: false, message: 'Could not start SSH pairing' });

    fixture.handlers.get(IPC.hosts.pairingWrite)!.invoke('ls\r');
    expect(fixture.session.write).toHaveBeenCalledWith('ls\r');
    fixture.handlers.get(IPC.hosts.pairingResize)!.invoke(100, 40);
    expect(fixture.session.resize).toHaveBeenCalledWith(100, 40);
    fixture.handlers.get(IPC.hosts.pairingStop)!.invoke();
    expect(fixture.session.stop).toHaveBeenCalledOnce();
    expect(fixture.handlers.get(IPC.hosts.pairingStatus)!.invoke()).toEqual({ running: false, sshHost: null, backlog: '', exitCode: null });
    for (const channel of [IPC.hosts.pairingWrite, IPC.hosts.pairingResize, IPC.hosts.pairingStop]) {
      expect(fixture.handlers.get(channel)!.fallback()).toBeUndefined();
    }
    expect(fixture.handlers.get(IPC.hosts.pairingStatus)!.fallback()).toEqual({ running: false, sshHost: null, backlog: '', exitCode: null });
  });
});
