import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';
import { InvitationError, type PublicInvitationStatus } from '../services/peers/peer-invitation.js';

let server: ProductServer | null = null;
let dataDir = '';

afterEach(async () => {
  await server?.close();
  server = null;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

async function start() {
  dataDir = mkdtempSync(join(tmpdir(), 'zcc-peer-connections-api-'));
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
  server = await startProductServer({ dataDir, enrollToken: 'enroll-token-enroll-token-enroll', origins: { serverPort: 0, devAppPort: 5173 } });
  return server;
}

const ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const JSON_HEADERS = { 'content-type': 'application/json' };
const url = (path: string) => `${server!.url}api/v1${path}`;
const del = (path: string) => fetch(url(path), { method: 'DELETE', headers: JSON_HEADERS });
const post = (path: string, body?: unknown) => fetch(url(path), { method: 'POST', headers: JSON_HEADERS, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function status(extra: Partial<PublicInvitationStatus> = {}): PublicInvitationStatus {
  return {
    invitationId: ID, role: 'inviter', state: 'reserved', localFingerprint: 'local-fp',
    peer: { instanceId: 'a'.repeat(64), name: 'Ada-Mac', fingerprint: 'peer-fp' },
    inviterDecision: 'pending', redeemerDecision: 'approved', pairingId: 'secret-pairing', consentDigest: 'secret-digest',
    generation: 1, expiresAt: 1000, ...extra
  };
}

function fakes(s: ProductServer) {
  const invitations = {
    list: vi.fn(async () => [status(), status({ role: 'redeemer', pairingCode: 'ABCD-EFGH', inviterDecision: 'pending' })]),
    create: vi.fn(async () => ({ invitationId: ID, token: 'zccinv1.token', expiresAt: 5000, code: 'ABCD-EFGH' })),
    redeem: vi.fn(async () => status({ role: 'redeemer', state: 'redeeming' })),
    approvalRequest: vi.fn(async () => ({ binding: { action: 'x', target: 't', targetLabel: 'l', subject: 's' }, title: 't' })),
    decide: vi.fn(async () => status({ inviterDecision: 'approved', state: 'consented' })),
    cancel: vi.fn(async () => status({ state: 'cancelled' })),
    dispose: vi.fn(),
    whenIdle: vi.fn(async () => undefined)
  };
  s.ctx.peerInvitations = invitations as never;
  s.ctx.mintCoreApproval = vi.fn(() => 'proof-token');
  return invitations;
}

describe('/api/v1/peer-connections', () => {
  it('lists core connections without secrets and flags the one awaiting approval', async () => {
    const s = await start(); fakes(s);
    const raw = await (await fetch(url('/peer-connections'))).text();
    const body = JSON.parse(raw) as { connections: Array<Record<string, unknown>> };
    expect(body.connections[0]).toMatchObject({ invitationId: ID, role: 'inviter', awaitingApproval: true, peer: { name: 'Ada-Mac', fingerprint: 'peer-fp' } });
    expect(body.connections[1]).toMatchObject({ role: 'redeemer', pairingCode: 'ABCD-EFGH', awaitingApproval: false });
    expect(raw).not.toContain('secret-pairing');
    expect(raw).not.toContain('secret-digest');
  });

  it('creates a core invitation (no plugin, no scope) and maps failures to fixed reasons', async () => {
    const s = await start(); const inv = fakes(s);
    const ok = await post('/peer-connections');
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ invitationId: ID, token: 'zccinv1.token', expiresAt: 5000, code: 'ABCD-EFGH' });
    expect(inv.create).toHaveBeenCalledWith({});
    inv.create.mockRejectedValueOnce(new InvitationError('ssh_remote_login_off'));
    const off = await post('/peer-connections');
    expect(off.status).toBe(400);
    expect(await off.json()).toMatchObject({ reason: 'ssh_remote_login_off' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    inv.create.mockRejectedValueOnce(new TypeError('/Users/me/.ssh/secret leaked'));
    const crash = await post('/peer-connections');
    expect(crash.status).toBe(503);
    expect(JSON.stringify(await crash.json())).not.toContain('/Users');
    // The local log names the failure without its message.
    expect(warn).toHaveBeenCalledWith('[peer-connections] request failed: TypeError');
    inv.create.mockRejectedValueOnce('bare');
    expect((await post('/peer-connections')).status).toBe(503);
    expect(warn).toHaveBeenLastCalledWith('[peer-connections] request failed: string');
    warn.mockRestore();
  });

  it('joins with a trimmed token and rejects a malformed body', async () => {
    const s = await start(); const inv = fakes(s);
    expect((await post('/peer-connections/join', { token: '  zccinv1.abc  ', code: 'ABCD-EFGH' })).status).toBe(201);
    expect(inv.redeem).toHaveBeenCalledWith({ token: 'zccinv1.abc', code: 'ABCD-EFGH' });
    expect((await post('/peer-connections/join', { token: '', code: 'ABCD-EFGH' })).status).toBe(400);
    expect((await post('/peer-connections/join', { token: 'x' })).status).toBe(400);
    expect((await post('/peer-connections/join', { token: 'x', code: 'ABCD-EFGH', extra: 1 })).status).toBe(400);
    const bad = await fetch(url('/peer-connections/join'), { method: 'POST', headers: JSON_HEADERS, body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('approves only with the typed code, minting the proof server-side', async () => {
    const s = await start(); const inv = fakes(s);
    const ok = await post(`/peer-connections/${ID}/approve`, { code: 'abcd-efgh' });
    expect(ok.status).toBe(200);
    expect(inv.decide).toHaveBeenCalledWith({ invitationId: ID, decision: 'approved', ownerProof: 'proof-token', pairingCode: 'abcd-efgh' });
    expect((await post(`/peer-connections/${ID}/approve`, {})).status).toBe(400);
    expect((await post(`/peer-connections/${ID}/approve`, { code: 'x', ownerProof: 'forged' })).status).toBe(400);
    inv.decide.mockRejectedValueOnce(new InvitationError('identity_mismatch'));
    const wrong = await post(`/peer-connections/${ID}/approve`, { code: 'AAAA-AAAA' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ reason: 'identity_mismatch' });
    const bad = await fetch(url(`/peer-connections/${ID}/approve`), { method: 'POST', headers: JSON_HEADERS, body: '{nope' });
    expect(bad.status).toBe(400);
  });

  it('refuses approval when no signing secret is available', async () => {
    const s = await start(); fakes(s); s.ctx.mintCoreApproval = undefined;
    expect((await post(`/peer-connections/${ID}/approve`, { code: 'ABCD-EFGH' })).status).toBe(503);
  });

  it('validates ids in main: a non-uuid id never reaches the invitation store', async () => {
    const s = await start(); const inv = fakes(s);
    expect((await post('/peer-connections/not-a-uuid/approve', { code: 'ABCD-EFGH' })).status).toBe(404);
    expect((await del('/peer-connections/..%2Fetc')).status).toBe(404);
    expect(inv.approvalRequest).not.toHaveBeenCalled();
    expect(inv.cancel).not.toHaveBeenCalled();
    inv.cancel.mockRejectedValueOnce(new InvitationError('not_found'));
    expect((await del(`/peer-connections/${ID}`)).status).toBe(404);
  });

  it('denies and cancels', async () => {
    const s = await start(); const inv = fakes(s);
    expect((await post(`/peer-connections/${ID}/deny`)).status).toBe(200);
    expect(inv.decide).toHaveBeenCalledWith({ invitationId: ID, decision: 'denied' });
    const cancelled = await del(`/peer-connections/${ID}`);
    expect(await cancelled.json()).toMatchObject({ state: 'cancelled' });
    expect((await fetch(url(`/peer-connections/${ID}`), { method: 'GET' })).status).toBe(404);
  });

  it('reports the Remote Login check result and its absence', async () => {
    const s = await start(); fakes(s);
    expect((await post('/peer-connections/remote-login')).status).toBe(503);
    s.ctx.peerRemoteLoginCheck = vi.fn(async () => ({ ok: false as const, reason: 'ssh_remote_login_off' as const }));
    expect(await (await post('/peer-connections/remote-login')).json()).toEqual({ ok: false, reason: 'ssh_remote_login_off' });
    s.ctx.peerRemoteLoginCheck = vi.fn(async () => ({ ok: true as const }));
    expect(await (await post('/peer-connections/remote-login')).json()).toEqual({ ok: true });
  });

  it('is unavailable without invitations and refused for the mobile surface', async () => {
    const s = await start();
    const real = s.ctx.peerInvitations;
    s.ctx.peerInvitations = undefined;
    expect((await fetch(url('/peer-connections'))).status).toBe(503);
    s.ctx.peerInvitations = real;
    fakes(s);
    const mobile = await fetch(url('/peer-connections'), { headers: { 'x-zcc-app-surface': 'mobile' } });
    expect(mobile.status).toBe(403);
    expect((await fetch(url('/peer-connections/nope/x/y'))).status).toBe(404);
  });
});
