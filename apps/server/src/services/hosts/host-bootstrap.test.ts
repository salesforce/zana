import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHost, openDatabase, updateHostSshIdentity, upsertHost } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HostUnavailableError } from '../../http/host-hub.js';
import {
  attachSshFallbackPairingCommand,
  bootstrapHostBySsh,
  reconcileRemoteProjectBindings,
  bootstrapHostForProject,
  createStageTracker,
  installStageReason,
  isTunnelForwardFailure,
  openTunnelWithAutoPort,
  registerFailureFromLog,
  repairHost,
  type HostBootstrapEvent,
  classifyInstallFailure,
  DAEMON_UNRESPONSIVE_ERROR,
  DOCKER_JOIN_ORIGIN_ERROR,
  HostBootstrapError,
  PAIRING_DOOR_ERROR,
  parseSshIdentity,
  resolveBootstrapTarget,
  resolveHostBootstrapPlan,
  resolveRepairPlan,
  reuseRemoteHostId,
  sshFallbackPairingCommand,
  sshRemoteFromProject,
  waitForPeerConnect,
  pairingCommand,
  shQuote,
  tunnelLocalPort,
  PAIRING_FORWARDER_UNAVAILABLE_ERROR
} from './host-bootstrap.js';
import { createJoinCodeStore } from './join-codes.js';

vi.mock('./host-artifact.js', () => ({ resolveHostArtifact: async () => ({ tarballPath: '/private/host.tgz' }) }));
vi.mock('./connect-enrollment.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./connect-enrollment.js')>(),
  usesConnect: () => false
}));

afterEach(() => {
  delete process.env.ZCC_APP_URL;
});

const RELAY = 'https://relay.example.com';
const SESSION = 'zcrs_abcdefghijklmnopqr1234';

function ctxWithRelay(
  url: string,
  pairingRelay: {
    state: () => string;
    snapshot: () => unknown;
    renewJoinWindow?: () => Promise<unknown>;
  },
  tokenPresent = true
) {
  process.env.ZCC_APP_URL = url;
  return {
    config: { getConfig: () => ({}) },
    pairingRelay: {
      renewJoinWindow: async () => pairingRelay.snapshot(),
      relayOrigin: () => RELAY,
      tokenPresent: () => tokenPresent,
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

  it('restarts existing installations and installs only when missing', () => {
    expect(resolveRepairPlan('connected')).toBe('restart');
    expect(resolveRepairPlan('not_installed')).toBe('install');
    expect(resolveRepairPlan('disconnected')).toBe('restart');
  });

  it('falls back to a tunnel instead of relay_offline when the relay is down', async () => {
    const ctx = ctxWithRelay(RELAY, { state: () => 'offline', snapshot: () => ({ state: 'offline' }) });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'relay_offline' });
  });

  it('falls back to a tunnel instead of public_url_required when no origin is configured', async () => {
    const ctx = { config: { getConfig: () => ({}) }, pairingRelay: undefined };
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'no_public_origin' });
  });

  it('falls back to a tunnel for a loopback public origin', async () => {
    process.env.ZCC_APP_URL = 'http://127.0.0.1:8780';
    const ctx = { config: { getConfig: () => ({}) }, pairingRelay: undefined };
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'no_public_origin' });
  });

  it('never returns the bare door URL when the shared relay origin has no token', async () => {
    const ctx = ctxWithRelay(RELAY, { state: () => 'unconfigured', snapshot: () => ({ state: 'unconfigured' }) }, false);
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'relay_unconfigured' });
  });

  it('uses a public origin that is not the relay directly', async () => {
    const ctx = ctxWithRelay('https://machine.example.com', {
      state: () => 'unconfigured',
      snapshot: () => ({ state: 'unconfigured' })
    });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'direct', serverUrl: 'https://machine.example.com' });
  });

  it('treats a Settings-only relay URL as relay not configured, never a direct target', async () => {
    const ctx = { config: { getConfig: () => ({ publicAppUrl: 'https://machine.example.com' }) }, pairingRelay: undefined };
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'relay_unconfigured' });
  });

  it('joins through the relay session when the relay is connected', async () => {
    const ctx = ctxWithRelay(RELAY, {
      state: () => 'connected',
      snapshot: () => ({ state: 'connected', sessionId: SESSION, joinUntil: Date.now() + 60_000 })
    });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'relay', serverUrl: `${RELAY}/t/${SESSION}` });
  });

  it('renews an expired join window before returning the session origin', async () => {
    let joinUntil = Date.now() - 1;
    const ctx = ctxWithRelay(RELAY, {
      state: () => 'connected',
      snapshot: () => ({ state: 'connected', sessionId: SESSION, joinUntil }),
      renewJoinWindow: async () => {
        joinUntil = Date.now() + 60_000;
        return { state: 'connected', sessionId: SESSION, joinUntil };
      }
    });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'relay', serverUrl: `${RELAY}/t/${SESSION}` });
  });

  it('falls back to a tunnel when the connected relay has no session id', async () => {
    const ctx = ctxWithRelay(RELAY, {
      state: () => 'connected',
      snapshot: () => ({ state: 'connected', joinUntil: Date.now() + 60_000 })
    });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'tunnel', reason: 'no_session' });
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

  it('attaches no command when the pairing forwarder is not running', () => {
    const ctx = { joinCodes: createJoinCodeStore(), origins: { serverPort: 8780 } };
    const error = new HostBootstrapError('join_expired', PAIRING_DOOR_ERROR);
    const attached = attachSshFallbackPairingCommand(error, ctx as never, { host: 'limited-pony' });
    expect(attached).toBe(error);
    expect(attached.pairingCommand).toBeUndefined();
    expect(tunnelLocalPort(ctx as never)).toBeNull();
    expect(tunnelLocalPort({} as never)).toBeNull();
  });

  it('attaches a reverse-tunnel command on pairing-door errors', () => {
    const ctx = { joinCodes: createJoinCodeStore(), origins: { serverPort: 8780, pairingPort: 8790 } };
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
      pairingRelay: undefined
    };
    await expect(resolveBootstrapTarget(ctx as never)).rejects.toMatchObject({
      name: 'HostBootstrapError',
      code: 'join_origin_invalid',
      message: DOCKER_JOIN_ORIGIN_ERROR
    });
  });

  it('falls through a leftover Docker Settings URL to the baked public origin', async () => {
    const ctx = ctxWithRelay(RELAY, {
      state: () => 'connected',
      snapshot: () => ({ state: 'connected', sessionId: SESSION, joinUntil: Date.now() + 60_000 })
    });
    (ctx.config as { getConfig: () => { publicAppUrl?: string } }).getConfig = () => ({
      publicAppUrl: 'http://host.docker.internal:18781'
    });
    await expect(resolveBootstrapTarget(ctx as never)).resolves.toEqual({ kind: 'relay', serverUrl: `${RELAY}/t/${SESSION}` });
  });
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});

type Snapshot = { state: string; sessionId?: string; joinUntil?: number };

function relay(snapshot: Snapshot, tokenPresent = true) {
  return {
    state: () => snapshot.state,
    snapshot: () => snapshot,
    relayOrigin: () => RELAY,
    tokenPresent: () => tokenPresent,
    renewJoinWindow: async () => snapshot
  };
}

const TARGETS = {
  offline: { url: RELAY, relay: relay({ state: 'offline' }) },
  unconfigured: { url: RELAY, relay: relay({ state: 'unconfigured' }, false) },
  no_session: { url: RELAY, relay: relay({ state: 'connected', joinUntil: Date.now() + 60_000 }) },
  no_origin: { url: undefined, relay: undefined },
  connected: { url: RELAY, relay: relay({ state: 'connected', sessionId: SESSION, joinUntil: Date.now() + 60_000 }) },
  direct: { url: 'https://machine.example.com', relay: undefined }
} as const;

function flow(target: keyof typeof TARGETS = 'offline') {
  const { url, relay: pairingRelay } = TARGETS[target];
  if (url) process.env.ZCC_APP_URL = url;
  const dir = mkdtempSync(join(tmpdir(), 'zcc-bootstrap-flow-'));
  const db = openDatabase(join(dir, 'state.sqlite'));
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const primary = upsertHost(db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
  const connected = new Set<string>([primary.id]);
  const install = vi.fn(async (_command: any): Promise<unknown> => ({ ok: true, log: 'Host daemon connected.' }));
  const status = vi.fn(async (_command: any): Promise<unknown> => ({ state: 'not_installed' }));
  const restart = vi.fn(async (_command: any): Promise<unknown> => ({ ok: true, log: 'restarted' }));
  const logs = vi.fn(async (_command: any): Promise<unknown> => ({ log: '' }));
  const rpc = vi.fn(async ({ command }: { command: any }) => {
    if (command.type === 'peer_daemon.install') return install(command);
    if (command.type === 'peer_daemon.status') return status(command);
    if (command.type === 'peer_daemon.restart') return restart(command);
    return logs(command);
  });
  const wait = vi.fn(async (hostId: string) => {
    if (!getHost(db, hostId)) {
      upsertHost(db, { id: hostId, name: 'Remote', hostKeyHash: createHash('sha256').update(hostId).digest('hex') });
    }
    connected.add(hostId);
  });
  const bind = vi.fn(async () => {});
  const project = { id: 'project', name: 'Remote', path: '/placeholder', remote: { host: 'devbox', user: 'me', remotePath: '/srv/project' } };
  const ctx = {
    db,
    config: { getConfig: () => ({}) },
    pairingRelay,
    origins: { serverPort: 43200, pairingPort: 43210 },
    hostHub: {
      ensureHostSessionReady: vi.fn(),
      connectedHostIds: () => [...connected],
      callHostOnlineRpc: rpc,
      waitUntilConnected: wait
    },
    projects: { list: () => [project], bindToHost: bind },
    hub: { emit: vi.fn() },
    joinCodes: createJoinCodeStore()
  } as unknown as ProductHttpContext;
  const addRemote = () => {
    const remote = upsertHost(db, { name: 'Remote', hostKeyHash: 'b'.repeat(64) });
    updateHostSshIdentity(db, remote.id, { host: 'devbox', user: 'me' });
    return remote;
  };
  /** Make every wait time out by advancing the clock past the connect window. */
  const timeOutWaits = () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    wait.mockImplementation(async (hostId: string, timeoutMs?: number) => {
      clock += timeoutMs ?? 90_000;
      throw new Error(`host ${hostId} did not connect`);
    });
  };
  return { ctx, db, primary, connected, install, status, restart, logs, rpc, wait, bind, addRemote, timeOutWaits };
}

const stagesOf = (events: HostBootstrapEvent[]) =>
  events.filter((event) => event.type === 'stage').map((event) => {
    const stage = event as Extract<HostBootstrapEvent, { type: 'stage' }>;
    return `${stage.stage}:${stage.status}${stage.reason ? `:${stage.reason}` : ''}`;
  });

const forwardFailure = (port = 1) =>
  Object.assign(new Error(`Error: remote port forwarding failed for listen port ${port}`), { code: 'peer_tunnel_port_unavailable' });

describe('bootstrap and repair routing', () => {
  it.each(['offline', 'unconfigured', 'no_session', 'no_origin'] as const)(
    'bootstraps a project through the SSH tunnel when the target is %s', async (target) => {
      const f = flow(target);
      const events = await bootstrapHostForProject(f.ctx, 'project');
      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: 'done' });
      expect(events).toContainEqual(expect.objectContaining({ type: 'log', text: expect.stringMatching(/^Pairing relay unavailable \(\w+\); connecting through SSH…$/) }));
      const command = f.install.mock.calls[0]![0];
      expect(command.sshTunnel).toMatchObject({ localPort: 43210 });
      expect(command.sshTunnel.remotePort).toBeGreaterThanOrEqual(20000);
      expect(command.sshTunnel.remotePort).toBeLessThan(60000);
      expect(command.serverUrl).toBe(`http://127.0.0.1:${command.sshTunnel.remotePort}`);
      expect(f.bind).toHaveBeenCalledWith('project', { hostId: command.hostId, path: '/srv/project' });
      expect(getHost(f.db, command.hostId)?.sshHost).toBe('devbox');
    }
  );

  it.each(['offline', 'unconfigured', 'no_session', 'no_origin'] as const)(
    'repairs a host through the SSH tunnel when the target is %s', async (target) => {
      const f = flow(target);
      const remote = f.addRemote();
      const events = await repairHost(f.ctx, remote.id);
      expect(events.at(-1)).toEqual({ type: 'done', hostId: remote.id });
      expect(events.some((event) => event.type === 'error')).toBe(false);
      expect(f.status).not.toHaveBeenCalled();
      expect(f.install.mock.calls[0]![0]).toMatchObject({ hostId: remote.id, sshTunnel: { localPort: 43210 } });
    }
  );

  it.each(['bootstrap', 'repair', 'machine'] as const)(
    'fails closed on %s when the pairing forwarder is not running, never tunnelling the product port', async (entry) => {
      const f = flow('offline');
      delete (f.ctx.origins as { pairingPort?: number }).pairingPort;
      const events = entry === 'bootstrap'
        ? await bootstrapHostForProject(f.ctx, 'project')
        : entry === 'repair'
          ? await repairHost(f.ctx, f.addRemote().id)
          : await bootstrapHostBySsh(f.ctx, { host: 'fresh-box' });
      expect(events.at(-1)).toEqual({
        type: 'error',
        code: 'pairing_forwarder_unavailable',
        message: PAIRING_FORWARDER_UNAVAILABLE_ERROR
      });
      expect(f.install).not.toHaveBeenCalled();
      expect(JSON.stringify(events)).not.toContain('43200');
    }
  );

  it('forwards the tunnel to the pairing-only listener when one is running', async () => {
    const f = flow('offline');
    (f.ctx.origins as { pairingPort?: number }).pairingPort = 43299;
    f.install.mockRejectedValue(Object.assign(new Error('tunnel closed'), { code: 'peer_tunnel_failed' }));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(f.install.mock.calls[0]![0].sshTunnel.localPort).toBe(43299);
    expect((events.at(-1) as { pairingCommand?: string }).pairingCommand).toContain(':127.0.0.1:43299');
  });

  it('joins through the relay session URL when the relay is connected', async () => {
    const f = flow('connected');
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(f.install.mock.calls[0]![0].serverUrl).toBe(`${RELAY}/t/${SESSION}`);
    expect(f.install.mock.calls[0]![0]).not.toHaveProperty('sshTunnel');
  });

  it('keeps a direct public origin unchanged and records the SSH identity', async () => {
    const f = flow('direct');
    await bootstrapHostForProject(f.ctx, 'project');
    const command = f.install.mock.calls[0]![0];
    expect(command.serverUrl).toBe('https://machine.example.com');
    expect(getHost(f.db, command.hostId)?.sshUser).toBe('me');
  });

  it('reuses the host id already on the machine for a direct install', async () => {
    const f = flow('direct');
    const leftover = '028c8627-a6d8-4c62-964e-8f6b35cb2335';
    f.status.mockResolvedValueOnce({ state: 'disconnected', hostId: leftover });
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(f.install.mock.calls[0]![0].hostId).toBe(leftover);
    expect(events).toContainEqual({ type: 'log', text: 'Reusing the host id already on that machine…' });
  });

  it('attaches the manual SSH command when the automatic tunnel fails', async () => {
    const f = flow('offline');
    f.install.mockRejectedValueOnce(Object.assign(new Error('me@devbox: Permission denied (publickey).'), { code: 'peer_tunnel_failed' }));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    const error = events.at(-1) as Extract<HostBootstrapEvent, { type: 'error' }>;
    expect(error).toMatchObject({ type: 'error', code: 'install_failed', message: 'me@devbox: Permission denied (publickey).' });
    expect(error.pairingCommand).toContain('ssh -o ExitOnForwardFailure=yes');
    expect(stagesOf(events)).toContain('ssh:failed:me@devbox: Permission denied (publickey).');
    expect(stagesOf(events)).toContain('tunnel:failed:me@devbox: Permission denied (publickey).');
    expect(f.bind).not.toHaveBeenCalled();
  });

  it('wraps an unexpected tunnel install error and still attaches the manual command', async () => {
    const f = flow('offline');
    f.install.mockRejectedValueOnce('host rpc closed');
    const events = await repairHost(f.ctx, f.addRemote().id);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'install_failed', message: 'host rpc closed', pairingCommand: expect.stringContaining('ssh -o') });
  });

  it('retries a busy remote port on a new port and succeeds', async () => {
    const f = flow('offline');
    f.install.mockRejectedValueOnce(forwardFailure());
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(f.install).toHaveBeenCalledTimes(2);
    const [first, second] = f.install.mock.calls.map((call) => call[0]);
    expect(second.sshTunnel.remotePort).not.toBe(first.sshTunnel.remotePort);
    expect(second.joinCode).toBe(first.joinCode);
    expect(events).toContainEqual({ type: 'log', text: `Port ${first.sshTunnel.remotePort} is busy on the remote machine; trying another…` });
    expect(stagesOf(events).filter((stage) => stage.startsWith('tunnel:'))).toEqual(['tunnel:running', 'tunnel:passed']);
  });

  it('gives up after five busy ports with tunnel_port_unavailable', async () => {
    const f = flow('offline');
    f.install.mockRejectedValue(forwardFailure());
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(f.install).toHaveBeenCalledTimes(5);
    expect(new Set(f.install.mock.calls.map((call) => call[0].sshTunnel.remotePort)).size).toBe(5);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'tunnel_port_unavailable',
      message: 'No free port on the remote machine',
      pairingCommand: expect.stringContaining('ssh -o ExitOnForwardFailure=yes')
    });
    expect(stagesOf(events)).toContain('tunnel:failed:No free port on the remote machine');
  });

  it('emits stage events in order with their governing limits', async () => {
    const f = flow('offline');
    const events = await bootstrapHostForProject(f.ctx, 'project');
    const stages = events.filter((event) => event.type === 'stage');
    expect(stages).toEqual([
      { type: 'stage', stage: 'ssh', status: 'running', limitMs: 180_000 },
      { type: 'stage', stage: 'tunnel', status: 'running', limitMs: 35_000 },
      { type: 'stage', stage: 'install', status: 'running', limitMs: 240_000 },
      { type: 'stage', stage: 'ssh', status: 'passed' },
      { type: 'stage', stage: 'tunnel', status: 'passed' },
      { type: 'stage', stage: 'install', status: 'passed' },
      { type: 'stage', stage: 'wait', status: 'running', limitMs: 90_000 },
      { type: 'stage', stage: 'wait', status: 'passed' },
      { type: 'stage', stage: 'register', status: 'running' },
      { type: 'stage', stage: 'register', status: 'passed' },
      { type: 'stage', stage: 'connected', status: 'running' },
      { type: 'stage', stage: 'connected', status: 'passed' }
    ]);
  });

  it('passes SSH and the tunnel once a slow install outlives the tunnel open limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    cleanup.push(() => vi.useRealTimers());
    const f = flow('offline');
    let finish!: (value: unknown) => void;
    f.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const seen: HostBootstrapEvent[] = [];
    const run = bootstrapHostForProject(f.ctx, 'project', (event) => seen.push(event));
    await vi.waitFor(() => expect(f.install).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(32_000);
    expect(stagesOf(seen)).toEqual(['ssh:running', 'tunnel:running', 'install:running']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(stagesOf(seen)).toEqual(['ssh:running', 'tunnel:running', 'install:running', 'ssh:passed', 'tunnel:passed']);
    finish({ ok: true, log: '' });
    const events = await run;
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(stagesOf(events).filter((stage) => /^(ssh|tunnel):/.test(stage))).toEqual(['ssh:running', 'tunnel:running', 'ssh:passed', 'tunnel:passed']);
  });

  it('does not confirm the tunnel for a direct install or after the install settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    cleanup.push(() => vi.useRealTimers());
    const direct = flow('direct');
    let finish!: (value: unknown) => void;
    direct.install.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const seen: HostBootstrapEvent[] = [];
    const run = bootstrapHostForProject(direct.ctx, 'project', (event) => seen.push(event));
    await vi.waitFor(() => expect(direct.install).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stagesOf(seen)).toEqual(['ssh:running', 'install:running']);
    finish({ ok: true, log: '' });
    await run;

    const failed = flow('offline');
    failed.install.mockRejectedValueOnce(new Error('zcc-install: failed step=unpack rc=2'));
    const events = await bootstrapHostForProject(failed.ctx, 'project');
    const settled = events.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events).toHaveLength(settled);
    expect(stagesOf(events)).toContain('install:failed:Install step unpack failed (exit 2)');
  });

  it('reports a registration refusal after the last join attempt instead of a silent daemon', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    f.timeOutWaits();
    f.logs.mockResolvedValue({ log: [
      `zcc-join: attempt 2026-01-01T00:00:00Z host=${remote.id}`,
      'Failed to enroll daemon host: 401',
      'zcc-join: attempt 2026-01-02T00:00:00Z host=00000000-0000-4000-8000-000000000000',
      `zcc-join: attempt 2026-01-03T00:00:00Z host=${remote.id}`,
      'Error: Failed to enroll daemon host: 503 Service Unavailable'
    ].join('\n') });
    const events = await repairHost(f.ctx, remote.id);
    expect(f.logs.mock.calls[0]![0].serverHost).toBe(`ssh-${remote.id}`);
    expect(stagesOf(events)).toEqual(expect.arrayContaining(['wait:passed', 'register:failed:Machine could not register (HTTP 503)']));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'register_failed', message: 'Machine could not register (HTTP 503)' });
    expect(f.install).toHaveBeenCalledOnce();
  });

  it('ignores an older registration failure before the last join attempt', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    f.timeOutWaits();
    f.logs.mockResolvedValue({ log: `Failed to enroll daemon host: 401\nzcc-join: attempt 2026-01-03T00:00:00Z host=${remote.id}\nstarting` });
    const events = await repairHost(f.ctx, remote.id);
    expect(stagesOf(events)).toContain('wait:failed:Machine did not connect back in time');
    expect(stagesOf(events).some((stage) => stage.startsWith('register:'))).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'daemon_unresponsive' });
  });

  it('reads a registration refusal from the install script failure dump', async () => {
    const f = flow('direct');
    const remote = f.addRemote();
    f.status.mockResolvedValue({ state: 'not_installed' });
    f.install.mockRejectedValueOnce(new Error([
      'host daemon did not report connected',
      '--- host-daemon.log ---',
      `zcc-join: attempt 2026-01-03T00:00:00Z host=${remote.id}`,
      'Failed to enroll daemon host: 403'
    ].join('\n')));
    const events = await repairHost(f.ctx, remote.id);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'register_failed', message: 'Machine could not register (HTTP 403)' });
    expect((events.at(-1) as { pairingCommand?: string }).pairingCommand).toContain('ssh -o ExitOnForwardFailure=yes');
  });

  it('does not change transport when remote output mentions an HTTP 503', async () => {
    const f = flow('direct');
    f.install.mockRejectedValueOnce(new Error('curl: (22) The requested URL returned error: 503\nzcc-install: artifact-unavailable status=503 origin=https://machine.example.com'));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(f.install).toHaveBeenCalledOnce();
    expect(f.install.mock.calls[0]![0]).not.toHaveProperty('sshTunnel');
    expect(stagesOf(events)).toContain('install:failed:Artifact download failed (HTTP 503)');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'install_failed', pairingCommand: expect.stringContaining('https://machine.example.com/install.sh') });
  });

  it('fails the SSH stage when the primary SSH client could not connect', async () => {
    const f = flow('direct');
    f.install.mockRejectedValueOnce(new Error('ssh: Could not resolve hostname devbox: nodename nor servname provided'));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(stagesOf(events)).toContain('ssh:failed:ssh: Could not resolve hostname devbox: nodename nor servname provided');
    expect(stagesOf(events).some((stage) => stage.startsWith('install:failed'))).toBe(true);
  });

  it('restarts an installed daemon before reinstalling', async () => {
    const f = flow('direct');
    const remote = f.addRemote();
    f.status.mockResolvedValue({ state: 'disconnected' });
    const events = await repairHost(f.ctx, remote.id);
    expect(events.at(-1)).toEqual({ type: 'done', hostId: remote.id });
    expect(f.restart).toHaveBeenCalledOnce();
    expect(f.install).not.toHaveBeenCalled();
    expect(stagesOf(events)).toEqual(['ssh:running', 'ssh:passed', 'install:running', 'install:passed', 'wait:running', 'wait:passed',
      'register:running', 'register:passed', 'connected:running', 'connected:passed']);
  });

  it('reinstalls when a restart does not reconnect', async () => {
    const f = flow('direct');
    const remote = f.addRemote();
    f.status.mockResolvedValue({ state: 'disconnected' });
    f.restart.mockRejectedValueOnce(new Error('Could not restart the host daemon'));
    const events = await repairHost(f.ctx, remote.id);
    expect(events).toContainEqual({ type: 'log', text: 'Restart did not reconnect; reinstalling…' });
    expect(stagesOf(events)).toContain('install:failed:Restart did not reconnect');
    expect(f.install.mock.calls[0]![0]).toMatchObject({ hostId: remote.id, serverUrl: 'https://machine.example.com' });
    expect(events.at(-1)).toEqual({ type: 'done', hostId: remote.id });
  });

  it('reports a failed reinstall with the curl pairing command', async () => {
    const f = flow('direct');
    const remote = f.addRemote();
    f.install.mockRejectedValueOnce(new Error('Could not unpack the host-daemon artifact'));
    const events = await repairHost(f.ctx, remote.id);
    expect(events).toContainEqual({ type: 'log', text: 'Installing a fresh host-daemon artifact…' });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'install_failed', pairingCommand: expect.stringContaining('/install.sh') });
  });

  it('rejects repair of an unknown, primary or identity-less host', async () => {
    const f = flow('direct');
    expect((await repairHost(f.ctx, 'missing')).at(-1)).toMatchObject({ code: 'unknown_host' });
    expect((await repairHost(f.ctx, f.primary.id)).at(-1)).toMatchObject({ code: 'primary_host' });
    const bare = upsertHost(f.db, { name: 'Bare', hostKeyHash: 'c'.repeat(64) });
    expect((await repairHost(f.ctx, bare.id)).at(-1)).toMatchObject({ code: 'ssh_identity_required' });
  });

  it('rejects unknown and local projects', async () => {
    const f = flow('direct');
    expect((await bootstrapHostForProject(f.ctx, 'missing')).at(-1)).toMatchObject({ code: 'unknown_project' });
    (f.ctx.projects.list as () => unknown[]) = () => [{ id: 'local', name: 'Local', path: '/tmp/x' }];
    expect((await bootstrapHostForProject(f.ctx, 'local')).at(-1)).toMatchObject({ code: 'not_remote_project' });
  });

  it('fails stages that are still running when the primary goes away', async () => {
    const f = flow('offline');
    f.ctx.hostHub.ensureHostSessionReady = vi.fn(() => { throw new HostUnavailableError('gone'); });
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'primary_disconnected' });
  });
});

describe('reconcileRemoteProjectBindings', () => {
  it('binds a remote project added after its machine, and is a no-op once bound', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(1);
    expect(f.bind).toHaveBeenCalledWith('project', { hostId: remote.id, path: '/srv/project' });
  });

  it('leaves a project unbound when no enrolled machine matches its SSH identity', async () => {
    const f = flow('offline');
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(0);
    expect(f.bind).not.toHaveBeenCalled();
  });

  it('skips projects that are already bound or not SSH remotes', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    f.ctx.hostHub.connectedHostIds = () => [remote.id];
    (f.ctx.projects.list as () => unknown[]) = () => [
      { id: 'bound', name: 'B', path: '/x', hostId: remote.id, remote: { host: 'devbox', user: 'me', remotePath: '/srv/b' } },
      { id: 'local', name: 'L', path: '/x' }
    ];
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(0);
  });

  it('rebinds a project from a removed host to the machine on its SSH identity', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    (f.ctx.projects.list as () => unknown[]) = () => [
      { id: 'stale', name: 'S', path: '/x', hostId: 'gone', remote: { host: 'devbox', user: 'me', remotePath: '/srv/s' } }
    ];
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(1);
    expect(f.bind).toHaveBeenCalledWith('stale', { hostId: remote.id, path: '/srv/s' });
  });

  it('rebinds a project after Remove and re-add to the new machine named by the same alias', async () => {
    const f = flow('offline');
    // Re-added through the laptop ssh -R command: identity recorded by alias alone.
    const readded = upsertHost(f.db, { name: 'pod-hostname', hostKeyHash: 'c'.repeat(64) });
    expect(updateHostSshIdentity(f.db, readded.id, { host: 'devbox' })?.name).toBe('devbox');
    f.ctx.hostHub.connectedHostIds = () => [readded.id];
    (f.ctx.projects.list as () => unknown[]) = () => [
      { id: 'p', name: 'P', path: '/x', hostId: 'removed', remote: { host: 'devbox', user: 'me', remotePath: '/srv/p' } }
    ];
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(1);
    expect(f.bind).toHaveBeenCalledWith('p', { hostId: readded.id, path: '/srv/p' });
  });

  it('warns with the message only when a bind fails, and keeps going', async () => {
    const f = flow('offline');
    f.addRemote();
    f.bind.mockRejectedValueOnce(new Error('path not found'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(0);
    expect(warn).toHaveBeenCalledWith('[zcc] Could not bind remote project to its machine: path not found');
    f.bind.mockRejectedValueOnce('opaque');
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(0);
    expect(warn).toHaveBeenCalledWith('[zcc] Could not bind remote project to its machine: opaque');
  });

  it('keeps a binding to a known offline host when no connected twin exists', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    (f.ctx.projects.list as () => unknown[]) = () => [
      { id: 'p', name: 'P', path: '/x', hostId: remote.id, remote: { host: 'devbox', user: 'me', remotePath: '/srv/p' } }
    ];
    expect(await reconcileRemoteProjectBindings(f.ctx)).toBe(0);
  });
});

describe('machine-first install by SSH identity', () => {
  it('installs a host without a project and reuses it for later calls and projects', async () => {
    const f = flow('offline');
    const first = await bootstrapHostBySsh(f.ctx, { host: 'devbox', user: 'me' });
    const done = first.at(-1) as Extract<HostBootstrapEvent, { type: 'done' }>;
    expect(done.type).toBe('done');
    // The existing unbound remote project on this identity is bound right away.
    expect(f.bind).toHaveBeenCalledWith('project', { hostId: done.hostId, path: '/srv/project' });
    expect(getHost(f.db, done.hostId)).toMatchObject({ sshHost: 'devbox', sshUser: 'me' });

    const second = await bootstrapHostBySsh(f.ctx, { host: 'devbox', user: 'me' });
    expect(second).toEqual([{ type: 'log', text: 'This machine is already connected.' }, { type: 'done', hostId: done.hostId }]);
    expect(f.install).toHaveBeenCalledOnce();

    await bootstrapHostForProject(f.ctx, 'project');
    expect(f.install).toHaveBeenCalledOnce();
    expect(f.bind).toHaveBeenCalledWith('project', { hostId: done.hostId, path: '/srv/project' });
  });

  it('binds only unbound remote projects on the same SSH identity and tolerates unresolved paths', async () => {
    const f = flow('offline');
    const list = (f.ctx.projects.list as unknown as () => Array<Record<string, unknown>>)();
    (f.ctx.projects.list as () => unknown[]) = () => [
      ...list,
      { id: 'other-host', name: 'O', path: '/x', remote: { host: 'elsewhere', user: 'me', remotePath: '/srv/o' } },
      { id: 'other-user', name: 'U', path: '/x', remote: { host: 'devbox', user: 'you', remotePath: '/srv/u' } },
      { id: 'already', name: 'A', path: '/x', hostId: 'h-1', remote: { host: 'devbox', user: 'me', remotePath: '/srv/a' } },
      { id: 'no-path', name: 'N', path: '/x', remote: { host: 'devbox', user: 'me' } },
      { id: 'local', name: 'L', path: '/x' }
    ];
    const events = await bootstrapHostBySsh(f.ctx, { host: 'devbox', user: 'me' });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(f.bind.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual(['project', 'already']);
  });

  it('repairs a known disconnected machine on the same identity instead of minting a new host', async () => {
    const f = flow('offline');
    const remote = f.addRemote();
    const events = await bootstrapHostBySsh(f.ctx, { host: 'devbox', user: 'me' });
    expect(f.install.mock.calls[0]![0].hostId).toBe(remote.id);
    expect(events.filter((event) => event.type === 'done')).toEqual([{ type: 'done', hostId: remote.id }]);
  });

  it('stops after a failed repair without binding a project', async () => {
    const f = flow('offline');
    f.addRemote();
    f.install.mockRejectedValue(new Error('boom'));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(f.bind).not.toHaveBeenCalled();
  });

  it('rejects an unsafe SSH identity before touching the machine', async () => {
    const f = flow('offline');
    expect((await bootstrapHostBySsh(f.ctx, { host: '-oProxyCommand=x' })).at(-1)).toMatchObject({ type: 'error', code: 'invalid_ssh' });
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('propagates unexpected failures to the caller', async () => {
    const f = flow('offline');
    (f.ctx as { joinCodes: unknown }).joinCodes = { mint: () => { throw new TypeError('store closed'); } };
    await expect(bootstrapHostBySsh(f.ctx, { host: 'devbox' })).rejects.toThrow('store closed');
  });
});

describe('tunnel port selection', () => {
  it('skips a port it already tried', async () => {
    const ports = [21000, 21000, 22000];
    const attempt = vi.fn(async (port: number) => { if (port === 21000) throw forwardFailure(port); return 'ok'; });
    await expect(openTunnelWithAutoPort(attempt, { pickPort: () => ports.shift()! })).resolves.toEqual({ result: 'ok', remotePort: 22000 });
    expect(attempt.mock.calls.map((call) => call[0])).toEqual([21000, 22000]);
  });

  it('does not retry a failure that is not a forwarding conflict', async () => {
    const attempt = vi.fn(async () => { throw new Error('ssh: connect to host devbox port 22: Connection refused'); });
    await expect(openTunnelWithAutoPort(attempt)).rejects.toThrow('Connection refused');
    expect(attempt).toHaveBeenCalledOnce();
    expect(isTunnelForwardFailure(null)).toBe(false);
    expect(isTunnelForwardFailure({ code: 7 })).toBe(false);
  });
});

describe('stage reasons', () => {
  it('maps installer markers to a short reason', () => {
    expect(installStageReason('zcc-install: artifact-unavailable status=503 origin=https://a.example')).toBe('Artifact download failed (HTTP 503)');
    expect(installStageReason('zcc-install: script-unavailable')).toBe('Installer download failed');
    expect(installStageReason('zcc-install: failed step=unpack rc=2')).toBe('Install step unpack failed (exit 2)');
    expect(installStageReason('all good')).toBeNull();
  });

  it('reads registration failures only after this host\'s last attempt', () => {
    const id = '028c8627-a6d8-4c62-964e-8f6b35cb2335';
    expect(registerFailureFromLog('Failed to enroll daemon host: 503', id)).toBeNull();
    expect(registerFailureFromLog(`zcc-join: attempt t host=${id}\nok`, id)).toBeNull();
    expect(registerFailureFromLog(`zcc-join: attempt t host=${id}\r\nFailed to enroll daemon host: 502`, id)).toBe('Machine could not register (HTTP 502)');
  });

  it('stops at the next join attempt marker, so another run\'s failure is not this host\'s', () => {
    const id = '028c8627-a6d8-4c62-964e-8f6b35cb2335';
    const other = '11111111-2222-4333-8444-555555555555';
    expect(registerFailureFromLog(
      `zcc-join: attempt t host=${id}\nok\nzcc-join: attempt t host=${other}\nFailed to enroll daemon host: 503`,
      id
    )).toBeNull();
    expect(registerFailureFromLog(
      `zcc-join: attempt t host=${id}\nFailed to enroll daemon host: 409\nzcc-join: attempt t host=${other}\nFailed to enroll daemon host: 503`,
      id
    )).toBe('Machine could not register (HTTP 409)');
  });

  it('emits each stage transition once and bounds the reason to one line', () => {
    const events: HostBootstrapEvent[] = [];
    const stages = createStageTracker((event) => events.push(event));
    stages.start('ssh', 5);
    stages.start('ssh', 5);
    stages.pass('tunnel');
    stages.fail('ssh', `first\nsecond ${'x'.repeat(300)}`);
    stages.fail('ssh', 'again');
    stages.fail('install', '');
    expect(events).toEqual([
      { type: 'stage', stage: 'ssh', status: 'running', limitMs: 5 },
      { type: 'stage', stage: 'ssh', status: 'failed', reason: 'first' },
      { type: 'stage', stage: 'install', status: 'failed', reason: 'Failed' }
    ]);
  });
});

describe('tunnel route memory', () => {
  const withStore = (f: ReturnType<typeof flow>) => {
    const store = { record: vi.fn(), remove: vi.fn(), get: vi.fn(), list: vi.fn(() => []) };
    (f.ctx as { tunnelHosts?: unknown }).tunnelHosts = store;
    return store;
  };

  it('records the remote port a tunnel install connected through', async () => {
    const f = flow('offline');
    const store = withStore(f);
    const events = await bootstrapHostForProject(f.ctx, 'project');
    const command = f.install.mock.calls[0]![0];
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(store.record).toHaveBeenCalledWith(command.hostId, command.sshTunnel.remotePort);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('keeps a connected tunnel install when its port cannot be written', async () => {
    const f = flow('offline');
    withStore(f).record.mockImplementation(() => { throw new Error('EACCES'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(warn).toHaveBeenCalledWith('[zcc] Could not save the SSH tunnel route: EACCES');
  });

  it('forgets the tunnel once a machine installs over another route', async () => {
    const f = flow('connected');
    const store = withStore(f);
    await bootstrapHostForProject(f.ctx, 'project');
    expect(store.remove).toHaveBeenCalledWith(f.install.mock.calls[0]![0].hostId);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('forgets the tunnel after a repair restarts or reinstalls over another route', async () => {
    const restarted = flow('direct');
    const restartStore = withStore(restarted);
    const first = restarted.addRemote();
    restarted.status.mockResolvedValue({ state: 'disconnected' });
    await repairHost(restarted.ctx, first.id);
    expect(restartStore.remove).toHaveBeenCalledWith(first.id);

    const reinstalled = flow('direct');
    const reinstallStore = withStore(reinstalled);
    const second = reinstalled.addRemote();
    const events = await repairHost(reinstalled.ctx, second.id);
    expect(events.at(-1)).toEqual({ type: 'done', hostId: second.id });
    expect(reinstallStore.remove).toHaveBeenCalledWith(second.id);
  });
});

describe('pairing command quoting', () => {
  it.each([
    ['plain', 'abc', "'abc'"],
    ['empty', '', "''"],
    ['single quote', "a'b", "'a'\\''b'"],
    ['substitution', '$(id)', "'$(id)'"],
    ['separators', 'a;b && c | d', "'a;b && c | d'"]
  ])('shQuote quotes %s', (_name, value, expected) => {
    expect(shQuote(value)).toBe(expected);
  });

  it('quotes every interpolated value in the curl install command', () => {
    expect(pairingCommand('https://zcc.corp.example', 'zcde_abc', '028c8627-a6d8-4c62-964e-8f6b35cb2335')).toBe(
      "curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 'https://zcc.corp.example/install.sh'" +
      " | sh -s -- --join-code 'zcde_abc' --host-id '028c8627-a6d8-4c62-964e-8f6b35cb2335' --server 'https://zcc.corp.example'"
    );
  });

  it.each([
    "https://a;id",
    "https://x.example'$(touch /tmp/p)'",
    'https://x.example`id`'
  ])('keeps a hostile server value inside one shell word: %s', (server) => {
    const command = pairingCommand(server, 'zcde_abc', 'h');
    expect(command).toContain(`--server ${shQuote(server)}`);
    expect(command).toContain(`${shQuote(`${server}/install.sh`)} | sh`);
  });
});
