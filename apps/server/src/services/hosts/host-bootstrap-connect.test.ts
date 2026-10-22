import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost, updateHostSshIdentity, getHost } from '@zana-ai/zcc-db';
import { bootstrapHostForProject, repairHost, isPeerNetworkFailure } from './host-bootstrap.js';
import { issueConnectHostCode } from './connect-enrollment.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ConnectRequestError } from '../../mobile/connect-account.js';

vi.mock('./connect-enrollment.js', async importOriginal => ({
  ...await importOriginal<typeof import('./connect-enrollment.js')>(),
  usesConnect: () => true,
  issueConnectHostCode: vi.fn()
}));
vi.mock('./host-artifact.js', () => ({ resolveHostArtifact: async () => ({ tarballPath: '/private/host.tgz' }) }));
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.clearAllMocks(); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-connect-repair-'));
  const db = openDatabase(join(dir, 'state.sqlite'));
  cleanup.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const primary = upsertHost(db, { name: 'Primary', hostKeyHash: 'a'.repeat(64), isPrimary: true });
  const remote = upsertHost(db, { name: 'Remote', hostKeyHash: 'b'.repeat(64), isPrimary: false });
  updateHostSshIdentity(db, remote.id, { host: 'devbox', user: 'me', proxyJump: 'bastion' });
  const issued = { hostId: remote.id, accountUrl: 'https://account.example', serverUrl: 'https://machine.example', serverId: randomUUID(), code: 'ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD-ABCD', enrollmentId: 'a'.repeat(64), expiresAt: Date.now() + 60_000 };
  vi.mocked(issueConnectHostCode).mockResolvedValue(issued);
  const project = { id: 'project', name: 'Remote project', path: '/placeholder', remote: { host: 'devbox', user: 'me', proxyJump: 'bastion', remotePath: '/srv/project' } };
  const rpc = vi.fn(async () => ({ ok: true, log: 'Machine connected' }));
  const wait = vi.fn(async () => {});
  const bind = vi.fn(async () => {});
  const ctx = {
    db, dataDir: dir, origins: { serverPort: 43200, pairingPort: 43210 },
    hostHub: { ensureHostSessionReady: vi.fn(), connectedHostIds: () => [], callHostOnlineRpc: rpc, waitUntilConnected: wait },
    projects: { list: () => [project], bindToHost: bind },
    hub: { emit: vi.fn() },
    joinCodes: { mint: vi.fn(() => { throw new Error('Legacy enrollment must not run'); }), mintForHost: vi.fn(id => ({ hostId: id, joinCode: 'zcde_tunnel' })) }
  } as unknown as ProductHttpContext;
  return { ctx, primary, remote, issued, rpc, wait, bind };
}

it('repairs through Connect on the primary host while preserving the remote identity and SSH scope', async () => {
  const f = fixture();
  const events = await repairHost(f.ctx, f.remote.id);
  expect(events.at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect(issueConnectHostCode).toHaveBeenCalledWith(f.ctx, { name: 'devbox', hostId: f.remote.id });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hostId: f.primary.id, command: {
    type: 'peer_daemon.install', remote: { host: 'devbox', user: 'me', proxyJump: 'bastion' },
    connect: { accountUrl: f.issued.accountUrl, serverId: f.issued.serverId, code: f.issued.code }
  } }));
  expect(f.wait).toHaveBeenCalledWith(f.remote.id, expect.any(Number));
  expect(getHost(f.ctx.db, f.remote.id)?.sshHost).toBe('devbox');
});

it('forgets a stored SSH tunnel route once Connect reinstalls the machine', async () => {
  const f = fixture();
  const store = { record: vi.fn(), remove: vi.fn(), get: vi.fn(), list: vi.fn(() => []) };
  (f.ctx as { tunnelHosts?: unknown }).tunnelHosts = store;
  expect((await repairHost(f.ctx, f.remote.id)).at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect(store.remove).toHaveBeenCalledWith(f.remote.id);
  expect(store.record).not.toHaveBeenCalled();
});

it('binds a remote project after Connect repairs its existing host', async () => {
  const f = fixture();
  expect((await bootstrapHostForProject(f.ctx, 'project')).at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect(f.bind).toHaveBeenCalledWith('project', { hostId: f.remote.id, path: '/srv/project' });
});

it('uses Connect for a first installation and binds only after the host connects', async () => {
  const f = fixture();
  updateHostSshIdentity(f.ctx.db, f.remote.id, { host: 'another' });
  expect((await bootstrapHostForProject(f.ctx, 'project')).at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect(issueConnectHostCode).toHaveBeenCalledWith(f.ctx, { name: 'devbox' });
  expect(f.bind).toHaveBeenCalledOnce();
});

it('does not re-enroll an already connected machine', async () => {
  const f = fixture();
  f.ctx.hostHub.connectedHostIds = () => [f.remote.id];
  await bootstrapHostForProject(f.ctx, 'project');
  expect(issueConnectHostCode).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});

it('surfaces install failure with the correct Connect command without binding the project', async () => {
  const f = fixture();
  f.rpc.mockRejectedValue(new Error('TLS connection failed'));
  const events = await bootstrapHostForProject(f.ctx, 'project');
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'install_failed', message: 'TLS connection failed', pairingCommand: expect.stringContaining('/api/connect/host-installer') });
  expect(f.bind).not.toHaveBeenCalled();
});

it('does not report a successful install as connected until the host becomes ready', async () => {
  const f = fixture();
  f.wait.mockRejectedValue(new Error('unexpected connection failure'));
  const events = await repairHost(f.ctx, f.remote.id);
  expect(events.at(-1)).toMatchObject({ type: 'error', message: 'unexpected connection failure' });
  expect(events.some(event => event.type === 'done')).toBe(false);
});

it.each(['curl: (35) error:0A0000C6:SSL routines::packet length too long', 'fetch failed', 'curl: (28) Connection timed out'])(
  'repairs a blocked public connection through a primary-owned SSH tunnel: %s', async message => {
    const f = fixture();
    f.rpc.mockRejectedValueOnce(new Error(message));
    const events = await bootstrapHostForProject(f.ctx, 'project');
    expect(events.at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
    expect(f.rpc).toHaveBeenCalledTimes(2);
    const fallback = f.rpc.mock.calls[1][0] as any;
    expect(fallback.hostId).toBe(f.primary.id);
    expect(fallback.command).toMatchObject({ remote: { host: 'devbox', user: 'me', proxyJump: 'bastion' },
      hostId: f.remote.id, joinCode: 'zcde_tunnel', artifactPath: '/private/host.tgz', sshTunnel: { localPort: 43210 } });
    expect(fallback.command.serverUrl).toBe(`http://127.0.0.1:${fallback.command.sshTunnel.remotePort}`);
    expect(fallback.command.replaceEnrollment).toBe(true);
    expect(f.bind).toHaveBeenCalledOnce();
    expect(events).toContainEqual({ type: 'log', text: 'Public HTTPS is unavailable on this machine; connecting through SSH…' });
  }
);

it('surfaces a failed SSH fallback without binding or reporting success', async () => {
  const f = fixture(); f.rpc.mockRejectedValueOnce(new Error('curl: (35) SSL failed')).mockRejectedValueOnce(new Error('SSH forwarding refused'));
  const events = await bootstrapHostForProject(f.ctx, 'project');
  expect(events.at(-1)).toMatchObject({ type: 'error', message: 'SSH forwarding refused' });
  expect(f.bind).not.toHaveBeenCalled();
});

it.each(['curl: (22) The requested URL returned error: 403', 'Enrollment denied', 'Node.js >= 22 is required', 'host did not connect'])(
  'does not bypass application or enrollment failures: %s', message => { expect(isPeerNetworkFailure(new Error(message))).toBe(false); }
);

it.each([
  ['a revoked account credential', new ConnectRequestError(401)],
  ['a forbidden account credential', new ConnectRequestError(403)],
  ['an unreachable account service', new TypeError('fetch failed')],
  ['a timed-out account service', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })]
])('repairs an SSH machine through the primary-owned tunnel despite %s', async (_label, error) => {
  const f = fixture();
  vi.mocked(issueConnectHostCode).mockRejectedValueOnce(error);
  const events = await repairHost(f.ctx, f.remote.id);
  expect(events.at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hostId: f.primary.id, command: expect.objectContaining({
    hostId: f.remote.id, joinCode: 'zcde_tunnel', replaceEnrollment: true, sshTunnel: expect.objectContaining({ localPort: 43210 }) }) }));
  expect(f.rpc.mock.calls[0][0]).not.toHaveProperty('command.connect');
  expect(f.ctx.joinCodes.mintForHost).toHaveBeenCalledWith(f.remote.id);
  expect(events.some(event => event.type === 'log' && /Zana Connect is unavailable.*connecting through SSH/.test(event.text))).toBe(true);
});

it('preserves explicit repair consent when a remote Connect install falls back to SSH', async () => {
  const f = fixture();
  f.rpc.mockRejectedValueOnce(new Error('curl: (35) SSL failed'));
  const events = await repairHost(f.ctx, f.remote.id);
  expect(events.at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect((f.rpc.mock.calls[1][0] as any).command).toMatchObject({ hostId: f.remote.id, replaceEnrollment: true });
});

it('installs a new SSH machine with a local join code when the account refuses enrollment', async () => {
  const f = fixture();
  updateHostSshIdentity(f.ctx.db, f.remote.id, { host: 'another' });
  vi.mocked(issueConnectHostCode).mockRejectedValueOnce(new ConnectRequestError(401));
  vi.mocked(f.ctx.joinCodes.mint).mockReturnValueOnce({ hostId: f.remote.id, joinCode: 'zcde_fresh' } as never);
  const events = await bootstrapHostForProject(f.ctx, 'project');
  expect(events.at(-1)).toEqual({ type: 'done', hostId: f.remote.id });
  expect((f.rpc.mock.calls[0][0] as any).command).toMatchObject({ joinCode: 'zcde_fresh', hostId: f.remote.id });
  expect((f.rpc.mock.calls[0][0] as any).command).not.toHaveProperty('replaceEnrollment');
  expect(f.ctx.joinCodes.mintForHost).not.toHaveBeenCalled();
  expect(f.bind).toHaveBeenCalledWith('project', { hostId: f.remote.id, path: '/srv/project' });
});

it.each([new ConnectRequestError(500), new Error('Invalid machine enrollment response')])(
  'still surfaces account failures that are not an outage or refusal: %s', async error => {
    const f = fixture();
    vi.mocked(issueConnectHostCode).mockRejectedValueOnce(error);
    await expect(repairHost(f.ctx, f.remote.id)).rejects.toBe(error);
    expect(f.rpc).not.toHaveBeenCalled();
  }
);
