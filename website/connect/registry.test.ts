import { afterEach, beforeEach, expect, it } from 'vitest';
import { openConnectDatabase } from './database.mjs';
import { createRegistry, CODE_TTL, SESSION_TTL, digest } from './registry.mjs';

let db: Awaited<ReturnType<typeof openConnectDatabase>>;
let registry: ReturnType<typeof createRegistry>;
let clock: number;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  db = await openConnectDatabase(':memory:', { production: false });
  await db.migrate();
  registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock });
});
afterEach(async () => { await db.close(); });

async function enroll(owner = 'alice', name = 'MacBook') {
  const start = await registry.startEnrollment(name);
  await registry.approveEnrollment(owner, start.userCode);
  const result = await registry.pollEnrollment(start.deviceCode);
  const server = await registry.authenticateServer(result.credential);
  return { ...result, server, start };
}
async function pair(server: any) {
  const qr = await registry.createPhoneCode(server);
  const result = await registry.redeemPhoneCode(server, qr.code, 'Phone');
  return { ...result, device: await registry.authenticateDevice(result.credential), qr };
}

it('enrolls distinct laptops for multiple accounts and idempotently delivers hashed credentials', async () => {
  const a = await enroll(); const b = await enroll('bob'); const a2 = await enroll('alice', 'Mac mini');
  expect(a.serverUrl).not.toBe(b.serverUrl);
  expect((await registry.listServers('alice')).map(x => x.id).sort()).toEqual([a.serverId, a2.serverId].sort());
  expect((await registry.listServers('bob')).map(x => x.id)).toEqual([b.serverId]);
  expect(await registry.pollEnrollment(a.start.deviceCode)).toEqual({ credential: a.credential, serverId: a.serverId, serverUrl: a.serverUrl, accountUrl: 'https://example.com', name: 'MacBook' });
  expect(await registry.enrollmentInfo(a.start.userCode)).toEqual({ name: 'MacBook', serverId: a.serverId, expiresAt: clock + CODE_TTL, approved: true, denied: false });
  expect(await registry.enrollmentInfo(a2.start.userCode)).toMatchObject({ serverId: a2.serverId, name: 'Mac mini' });
  const raw = await db.query('SELECT credential_hash FROM connect_servers WHERE id=$1', [a.serverId]);
  expect(raw[0].credential_hash).toBe(digest(a.credential));
  expect(JSON.stringify(raw)).not.toContain(a.credential);
  expect(await registry.authenticateServer('not-a-credential')).toBeNull();
  expect(await registry.authenticateDevice(a.credential)).toBeNull();
});

it('scopes sessions to the selected laptop and discovery to the device account', async () => {
  const a = await enroll(); const b = await enroll('bob'); const second = await enroll();
  const phone = await pair(a.server);
  const session = await registry.createSession(a.server, phone.device);
  expect(await registry.authorizeSession(a.server, session.cookie.value)).toMatchObject({ id: phone.deviceId });
  expect(await registry.authorizeSession(second.server, session.cookie.value)).toBeNull();
  expect(await registry.authorizeSession(b.server, session.cookie.value)).toBeNull();
  await expect(registry.createSession(b.server, phone.device)).rejects.toMatchObject({ status: 403 });
  expect(await registry.createSession(second.server, phone.device)).toHaveProperty('cookie');
  expect(await registry.listDevices('bob')).toEqual([]);
  expect(await registry.listDevices('alice')).toEqual([expect.objectContaining({ id: phone.deviceId, label: 'Phone', revoked: false })]);
  const next = await registry.createSession(a.server, phone.device);
  expect(await registry.authorizeSession(a.server, session.cookie.value)).toBeNull();
  clock += SESSION_TTL + 1;
  expect(await registry.authorizeSession(a.server, next.cookie.value)).toBeNull();
});

it('atomically consumes a phone code exactly once, refuses the wrong laptop and expires codes', async () => {
  const a = await enroll(); const b = await enroll();
  const qr = await registry.createPhoneCode(a.server);
  await expect(registry.redeemPhoneCode(b.server, qr.code, 'Wrong laptop')).rejects.toMatchObject({ status: 409 });
  const results = await Promise.allSettled([registry.redeemPhoneCode(a.server, qr.code, 'Phone'), registry.redeemPhoneCode(a.server, qr.code, 'Duplicate')]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await registry.listDevices('alice')).toHaveLength(1);
  const expired = await registry.createPhoneCode(a.server);
  clock += CODE_TTL + 1;
  await expect(registry.redeemPhoneCode(a.server, expired.code, 'Late')).rejects.toMatchObject({ status: 409 });
  await expect(registry.redeemPhoneCode(a.server, 'bad', 'Phone')).rejects.toMatchObject({ status: 400 });
});

it('revokes only owned records and immediately rejects credentials and outstanding sessions', async () => {
  const a = await enroll(); const phone = await pair(a.server);
  const session = await registry.createSession(a.server, phone.device);
  expect(await registry.revoke('bob', 'device', phone.deviceId)).toBe(false);
  expect(await registry.revoke('alice', 'device', phone.deviceId)).toBe(true);
  expect(await registry.authenticateDevice(phone.credential)).toBeNull();
  expect(await registry.authorizeSession(a.server, session.cookie.value)).toBeNull();
  expect(await registry.revoke('alice', 'server', a.serverId)).toBe(true);
  expect(await registry.authenticateServer(a.credential)).toBeNull();
  expect(await registry.resolveServer(a.server.label)).toBeNull();
  await expect(registry.pollEnrollment(a.start.deviceCode)).rejects.toMatchObject({ status: 403 });
});

it('handles pending, denied, expired and duplicate browser approvals', async () => {
  const start = await registry.startEnrollment('Mac');
  expect(await registry.pollEnrollment(start.deviceCode)).toEqual({ pending: true });
  expect(await registry.enrollmentInfo(start.userCode)).toMatchObject({ name: 'Mac', approved: false });
  await registry.approveEnrollment('alice', start.userCode, false);
  expect(await registry.enrollmentInfo(start.userCode)).toMatchObject({ denied: true });
  await expect(registry.pollEnrollment(start.deviceCode)).rejects.toMatchObject({ status: 403 });
  await expect(registry.approveEnrollment('bob', start.userCode)).rejects.toMatchObject({ status: 409 });
  clock += CODE_TTL + 1;
  await expect(registry.enrollmentInfo(start.userCode)).rejects.toMatchObject({ status: 410 });
  await expect(registry.pollEnrollment(start.deviceCode)).rejects.toMatchObject({ status: 410 });
  await expect(registry.pollEnrollment('bad')).rejects.toMatchObject({ status: 400 });
  await registry.prune();
  expect(await db.query('SELECT * FROM connect_codes')).toEqual([]);
});

it('rechecks principals inside credential issuance after concurrent account revocation', async () => {
  const a = await enroll(); const phone = await pair(a.server);
  const qr = await registry.createPhoneCode(a.server);
  // These objects represent requests authenticated before revoke completed.
  await registry.revoke('alice', 'device', phone.deviceId);
  await expect(registry.createSession(a.server, phone.device)).rejects.toMatchObject({ status: 403 });
  await registry.revoke('alice', 'server', a.serverId);
  await expect(registry.createPhoneCode(a.server)).rejects.toMatchObject({ status: 403 });
  await expect(registry.redeemPhoneCode(a.server, qr.code, 'Racing phone')).rejects.toMatchObject({ status: 403 });
  await expect(registry.createSession(a.server, phone.device)).rejects.toMatchObject({ status: 403 });
  expect(await registry.listDevices('alice')).toHaveLength(1);
  expect(await db.query('SELECT * FROM connect_sessions')).toHaveLength(0);
});

it('serializes account limits and rolls back codes on failed approval/redemption', async () => {
  registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  const a = await enroll();
  const second = await registry.startEnrollment('Second');
  await expect(registry.approveEnrollment('alice', second.userCode)).rejects.toMatchObject({ status: 409 });
  expect(await registry.enrollmentInfo(second.userCode)).toMatchObject({ approved: false });
  const phone = await pair(a.server);
  await expect(registry.createPhoneCode(a.server)).rejects.toMatchObject({ status: 409 });
  await registry.revoke('alice', 'device', phone.deviceId);
  expect(await registry.createPhoneCode(a.server)).toHaveProperty('code');
});

it('validates labels/origins, reports liveness and rejects malformed cookies', async () => {
  for (const name of ['', 'x'.repeat(81), 'bad\nname']) await expect(registry.startEnrollment(name)).rejects.toMatchObject({ status: 400 });
  expect(() => createRegistry(db, { domain: '..evil', accountUrl: 'https://example.com' })).toThrow();
  expect(() => createRegistry(db, { domain: 'connect.example.com', accountUrl: 'http://example.com' })).toThrow();
  await expect(openConnectDatabase('file:./unsafe.db', { production: true })).rejects.toThrow('persistent Postgres');
  const a = await enroll();
  expect((await registry.listServers('alice'))[0].live).toBe(false);
  await registry.markSeen(a.serverId);
  expect((await registry.listServers('alice'))[0].live).toBe(true);
  clock += 91_000;
  expect((await registry.listServers('alice'))[0].live).toBe(false);
  expect(await registry.authorizeSession(a.server, 'bad')).toBeNull();
});
