import { afterEach, describe, expect, it } from 'vitest';
import {
  attachSshFallbackPairingCommand,
  classifyInstallFailure,
  DAEMON_UNRESPONSIVE_ERROR,
  DOCKER_JOIN_ORIGIN_ERROR,
  HostBootstrapError,
  PAIRING_DOOR_ERROR,
  parseSshIdentity,
  requirePublicAppUrl,
  resolveHostBootstrapPlan,
  resolveRepairPlan,
  reuseRemoteHostId,
  sshFallbackPairingCommand,
  sshRemoteFromProject,
  waitForPeerConnect
} from './host-bootstrap.js';
import { createJoinCodeStore } from './join-codes.js';

afterEach(() => {
  delete process.env.ZCC_APP_URL;
});

function ctxWithRelay(
  url: string,
  pairingRelay: {
    state: () => string;
    snapshot: () => unknown;
    renewJoinWindow?: () => Promise<unknown>;
  }
) {
  process.env.ZCC_APP_URL = url;
  return {
    config: { getConfig: () => ({}) },
    pairingRelay: {
      renewJoinWindow: async () => pairingRelay.snapshot(),
      ...pairingRelay
    }
  };
}

describe('host bootstrap helpers', () => {
  it('parses a confined SSH identity', () => {
    expect(parseSshIdentity({ host: 'devbox', user: 'me', proxyJump: 'bastion' })).toEqual({
      host: 'devbox',
      user: 'me',
      proxyJump: 'bastion'
    });
  });

  it('rejects a flag-shaped host', () => {
    expect(() => parseSshIdentity({ host: '-oProxyCommand=x' })).toThrow(HostBootstrapError);
  });

  it('reads SSH identity from a remote project record', () => {
    expect(sshRemoteFromProject({
      id: 'p1',
      name: 'Remote',
      path: '/tmp/placeholder',
      createdAt: 1,
      lastActiveAt: 1,
      remote: { host: 'devbox', user: 'me', remotePath: '/home/me/app' }
    })).toEqual({ host: 'devbox', user: 'me', remotePath: '/home/me/app' });
    expect(sshRemoteFromProject({
      id: 'p2',
      name: 'Local',
      path: '/tmp/app',
      createdAt: 1,
      lastActiveAt: 1
    })).toBeNull();
  });

  it('reuses a leftover remote host id instead of minting a conflicting one', () => {
    expect(reuseRemoteHostId('dd727df2-6d9a-43be-9af3-342abe864245')).toBe(
      'dd727df2-6d9a-43be-9af3-342abe864245'
    );
    expect(reuseRemoteHostId('not-a-uuid')).toBeNull();
    expect(reuseRemoteHostId('')).toBeNull();
    expect(reuseRemoteHostId(undefined)).toBeNull();
  });

  it('reuses a connected enrolled host instead of installing again', () => {
    expect(resolveHostBootstrapPlan({ existing: null, connected: false })).toEqual({ kind: 'install' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-primary', isPrimary: true },
      connected: true
    })).toEqual({ kind: 'install' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-remote', isPrimary: false },
      connected: true
    })).toEqual({ kind: 'bind', hostId: 'h-remote' });
    expect(resolveHostBootstrapPlan({
      existing: { id: 'h-remote', isPrimary: false },
      connected: false
    })).toEqual({ kind: 'repair', hostId: 'h-remote' });
  });

  it('refreshes a connected daemon instead of treating the websocket as healthy', () => {
    expect(resolveRepairPlan('connected')).toBe('install');
    expect(resolveRepairPlan('not_installed')).toBe('install');
    expect(resolveRepairPlan('disconnected')).toBe('restart');
  });

  it('fails with relay_offline when a token is configured but the tunnel is down', async () => {
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'offline' as const,
      snapshot: () => ({ state: 'offline' as const })
    });
    await expect(requirePublicAppUrl(ctx as never)).rejects.toMatchObject({
      name: 'HostBootstrapError',
      code: 'relay_offline',
      message: PAIRING_DOOR_ERROR
    });
  });

  it('fails with public_url_required when no origin is configured', async () => {
    const ctx = {
      config: { getConfig: () => ({}) },
      pairingRelay: {
        state: () => 'unconfigured' as const,
        snapshot: () => ({ state: 'unconfigured' as const })
      }
    };
    await expect(requirePublicAppUrl(ctx as never)).rejects.toMatchObject({
      name: 'HostBootstrapError',
      code: 'public_url_required',
      message: 'Set a public app URL before installing a remote host daemon.'
    });
  });

  it('allows bootstrap against a public origin when the relay is unconfigured', async () => {
    const ctx = ctxWithRelay('https://box.tailnet.ts.net', {
      state: () => 'unconfigured' as const,
      snapshot: () => ({ state: 'unconfigured' as const })
    });
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe('https://box.tailnet.ts.net');
  });

  it('reads Settings when env and bake are empty', async () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'https://box.tailnet.ts.net' }) },
      pairingRelay: {
        state: () => 'unconfigured' as const,
        snapshot: () => ({ state: 'unconfigured' as const })
      }
    };
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe('https://box.tailnet.ts.net');
  });

  it('prefixes the session origin when the relay is connected', async () => {
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'connected' as const,
      snapshot: () => ({
        state: 'connected' as const,
        sessionId: 'zcrs_abcdefghijklmnopqr1234',
        joinUntil: Date.now() + 60_000
      })
    });
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe(
      'https://zcc.herokuapp.com/t/zcrs_abcdefghijklmnopqr1234'
    );
  });

  it('renews an expired join window before returning the session origin', async () => {
    const sessionId = 'zcrs_abcdefghijklmnopqr1234';
    let joinUntil = Date.now() - 1;
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'connected' as const,
      snapshot: () => ({
        state: 'connected' as const,
        sessionId,
        joinUntil
      }),
      renewJoinWindow: async () => {
        joinUntil = Date.now() + 60_000;
        return { state: 'connected' as const, sessionId, joinUntil };
      }
    });
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe(
      `https://zcc.herokuapp.com/t/${sessionId}`
    );
  });

  it('returns the session origin while the laptop is connected even if joinUntil lapsed', async () => {
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'connected' as const,
      snapshot: () => ({
        state: 'connected' as const,
        sessionId: 'zcrs_abcdefghijklmnopqr1234',
        joinUntil: Date.now() - 1
      })
    });
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe(
      'https://zcc.herokuapp.com/t/zcrs_abcdefghijklmnopqr1234'
    );
  });

  it('fails with relay_offline when the connected tunnel has no session id', async () => {
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'connected' as const,
      snapshot: () => ({
        state: 'connected' as const,
        joinUntil: Date.now() + 60_000
      })
    });
    await expect(requirePublicAppUrl(ctx as never)).rejects.toMatchObject({
      name: 'HostBootstrapError',
      code: 'relay_offline',
      message: PAIRING_DOOR_ERROR
    });
  });

  it('builds an SSH reverse-tunnel install command when the public door is down', () => {
    expect(sshFallbackPairingCommand({
      sshHost: 'limited-pony',
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335',
      listenPort: 8780
    })).toBe(
      "ssh -o ExitOnForwardFailure=yes -R 18782:127.0.0.1:8780 limited-pony 'curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://127.0.0.1:18782/install.sh | sh -s -- --join-code zcde_abc --host-id 028c8627-a6d8-4c62-964e-8f6b35cb2335 --server http://127.0.0.1:18782 && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity'"
    );
    expect(sshFallbackPairingCommand({
      sshHost: '-evil',
      joinCode: 'zcde_abc',
      hostId: '028c8627-a6d8-4c62-964e-8f6b35cb2335',
      listenPort: 8780
    })).toBeUndefined();
  });

  it('attaches a reverse-tunnel command on pairing-door errors', () => {
    const ctx = { joinCodes: createJoinCodeStore() };
    const attached = attachSshFallbackPairingCommand(
      new HostBootstrapError('join_expired', PAIRING_DOOR_ERROR),
      ctx as never,
      { host: 'limited-pony' }
    );
    expect(attached.pairingCommand).toContain('ssh -o ExitOnForwardFailure=yes');
    expect(attached.pairingCommand).toContain('limited-pony');
    expect(attachSshFallbackPairingCommand(
      new HostBootstrapError('relay_offline', PAIRING_DOOR_ERROR),
      ctx as never,
      { host: 'limited-pony' }
    ).pairingCommand).toContain('-R 18782:127.0.0.1:');
    expect(attachSshFallbackPairingCommand(
      new HostBootstrapError('daemon_unresponsive', DAEMON_UNRESPONSIVE_ERROR),
      ctx as never,
      { host: 'limited-pony' }
    ).pairingCommand).toContain('ssh -o ExitOnForwardFailure=yes');
    expect(attachSshFallbackPairingCommand(
      new HostBootstrapError('public_url_required', 'Set a public app URL first.'),
      ctx as never,
      { host: 'limited-pony' }
    ).pairingCommand).toBeUndefined();
    expect(attachSshFallbackPairingCommand(
      new HostBootstrapError('join_expired', PAIRING_DOOR_ERROR, 'curl already'),
      ctx as never,
      { host: 'limited-pony' }
    ).pairingCommand).toBe('curl already');
    expect(attachSshFallbackPairingCommand(
      new HostBootstrapError('join_origin_invalid', DOCKER_JOIN_ORIGIN_ERROR),
      ctx as never,
      { host: 'limited-pony' }
    ).pairingCommand).toContain('ssh -o ExitOnForwardFailure=yes');
  });

  it('maps a silent join to a short daemon_unresponsive error', () => {
    expect(classifyInstallFailure(new Error('host daemon did not report connected\n--- host-daemon.log ---'))).toEqual({
      code: 'daemon_unresponsive',
      message: DAEMON_UNRESPONSIVE_ERROR
    });
    expect(classifyInstallFailure(new Error('host abc did not connect'))).toMatchObject({
      code: 'daemon_unresponsive'
    });
    expect(classifyInstallFailure(new Error('Could not unpack the host-daemon artifact'))).toEqual({
      code: 'install_failed',
      message: 'Could not unpack the host-daemon artifact'
    });
  });

  it('emits wait ticks until the daemon connects', async () => {
    const logs: string[] = [];
    let calls = 0;
    await waitForPeerConnect(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error('host h1 did not connect');
      },
      (event) => {
        if (event.type === 'log') logs.push(event.text);
      },
      { timeoutMs: 5_000, tickMs: 1 }
    );
    expect(calls).toBe(2);
    expect(logs[0]).toBe('Waiting for the remote daemon to connect…');
    expect(logs.some((line) => line.startsWith('Still waiting for the remote daemon'))).toBe(true);
  });

  it('rejects a leftover Docker Desktop join origin', async () => {
    const ctx = {
      config: { getConfig: () => ({ publicAppUrl: 'http://host.docker.internal:18781' }) },
      pairingRelay: {
        state: () => 'unconfigured' as const,
        snapshot: () => ({ state: 'unconfigured' as const })
      }
    };
    await expect(requirePublicAppUrl(ctx as never)).rejects.toMatchObject({
      name: 'HostBootstrapError',
      code: 'join_origin_invalid',
      message: DOCKER_JOIN_ORIGIN_ERROR
    });
  });

  it('falls through a leftover Docker Settings URL to the baked public origin', async () => {
    const ctx = ctxWithRelay('https://zcc.herokuapp.com', {
      state: () => 'connected' as const,
      snapshot: () => ({
        state: 'connected' as const,
        sessionId: 'zcrs_abcdefghijklmnopqr1234',
        joinUntil: Date.now() + 60_000
      })
    });
    (ctx.config as { getConfig: () => { publicAppUrl: string } }).getConfig = () => ({
      publicAppUrl: 'http://host.docker.internal:18781'
    });
    await expect(requirePublicAppUrl(ctx as never)).resolves.toBe(
      'https://zcc.herokuapp.com/t/zcrs_abcdefghijklmnopqr1234'
    );
  });
});
