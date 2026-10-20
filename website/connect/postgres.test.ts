import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openConnectDatabase } from './database.mjs';
import { createRegistry } from './registry.mjs';
import { browserAccount } from './http.mjs';
import { createHmac } from 'node:crypto';
import { createBrowserAccess } from './browser-access.mjs';

it.skipIf(!process.env.ZCC_CONNECT_TEST_DATABASE_URL)('persists enrollment across processes and supports website accounts on real Postgres', async () => {
  const url = process.env.ZCC_CONNECT_TEST_DATABASE_URL!;
  let db = await openConnectDatabase(url, { production: true });
  const other = await openConnectDatabase(url, { production: true });
  const owner = randomUUID(), sessionId = randomUUID();
  try {
    await Promise.all([db.migrate(), other.migrate()]);
    if (process.env.ZCC_CONNECT_TEST_REQUIRE_TLS === '1') {
      expect((await db.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'))[0].ssl).toBe(true);
    }
    await db.query('INSERT INTO users(id,github_id,github_login,created_at) VALUES($1,$2,$3,$4)', [owner, Math.floor(Math.random() * 1e9), 'fixture', Date.now()]);
    await db.query('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES($1,$2,$3,$4)', [sessionId, owner, Date.now(), Date.now() + 60_000]);
    const secret = 'fixture-secret';
    expect(await browserAccount(db, `zcc_session=${sessionId}.${createHmac('sha256', secret).update(sessionId).digest('base64url')}`, secret)).toMatchObject({ id: owner });
    let registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com' });
    const start = await registry.startEnrollment('PG laptop'); await registry.approveEnrollment(owner, start.userCode);
    const enrolled = await registry.pollEnrollment(start.deviceCode);
    await db.close(); db = await openConnectDatabase(url, { production: true });
    registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com' });
    const server = await registry.authenticateServer(enrolled.credential);
    expect(server.id).toBe(enrolled.serverId);
    const qr = await registry.createPhoneCode(server);
    const secondRegistry = createRegistry(other, { domain: 'connect.example.com', accountUrl: 'https://example.com' });
    const reservedLabel = `reserved-${owner.slice(0, 8)}`;
    const reservations = await Promise.allSettled([registry.reserveComputer(owner, reservedLabel), secondRegistry.reserveComputer(owner, reservedLabel)]);
    expect(reservations.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const reserved = (reservations.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    const freshCode = await secondRegistry.createComputerCode(owner, reserved.serverId);
    await expect(registry.redeemComputerCode(reserved.code, 'Old code')).rejects.toMatchObject({ status: 409 });
    const reservedAttempts = await Promise.allSettled([registry.redeemComputerCode(freshCode.code, 'Reserved Mac'), secondRegistry.redeemComputerCode(freshCode.code, 'Duplicate')]);
    expect(reservedAttempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await secondRegistry.listServers(owner)).find(item => item.id === reserved.serverId)).toMatchObject({ paired: true, browserUrl: reserved.browserUrl });
    const computerCode = await registry.createComputerCode(owner);
    const computerAttempts = await Promise.allSettled([
      registry.redeemComputerCode(computerCode.code, 'Code Mac'),
      secondRegistry.redeemComputerCode(computerCode.code, 'Duplicate Mac')
    ]);
    expect(computerAttempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const label = `pg-${owner.slice(0, 8)}`;
    const pendingOther = await secondRegistry.startEnrollment('Second computer'); await secondRegistry.approveEnrollment(owner, pendingOther.userCode);
    const otherServer = await secondRegistry.authenticateServer((await secondRegistry.pollEnrollment(pendingOther.deviceCode)).credential);
    const claims = await Promise.allSettled([registry.claimAddress(owner, server.id, label), secondRegistry.claimAddress(owner, otherServer.id, label)]);
    expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const claimedServer = await registry.resolveServer(label);
    const browser = createBrowserAccess(db, registry), otherBrowser = createBrowserAccess(other, secondRegistry);
    const handoff = await browser.start(claimedServer, label, '/threads/fixture');
    const code = new URL(handoff.location).searchParams.get('browser');
    await otherBrowser.approve({ id: owner, session_id: sessionId }, code);
    const redemptions = await Promise.allSettled([browser.redeem(claimedServer, label, code, handoff.state), otherBrowser.redeem(claimedServer, label, code, handoff.state)]);
    expect(redemptions.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const browserSession = (redemptions.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
    expect(await otherBrowser.authorizeSession(claimedServer, label, browserSession.value)).toMatchObject({ user_id: owner });
    const results = await Promise.allSettled([registry.redeemPhoneCode(server, qr.code, 'One'), secondRegistry.redeemPhoneCode(server, qr.code, 'Two')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const phones = await registry.listDevices(owner); expect(phones).toHaveLength(1);
    expect(await secondRegistry.revoke(owner, 'device', phones[0].id)).toBe(true);
    expect((await registry.listDevices(owner))[0].revoked).toBe(true);
    await registry.revoke(owner, 'server', server.id);
    expect(await secondRegistry.authenticateServer(enrolled.credential)).toBeNull();
    await expect(secondRegistry.redeemPhoneCode(server, qr.code, 'Revoked computer')).rejects.toMatchObject({ status: 403 });
    // The owner takes a revoked computer's address back; concurrent reclaims bind it once.
    if (claimedServer.id !== server.id) await registry.revoke(owner, 'server', claimedServer.id);
    expect(await registry.addressAvailability(label, owner)).toMatchObject({ available: true });
    const enroll = async (r: any, name: string) => { const pending = await r.startEnrollment(name); await r.approveEnrollment(owner, pending.userCode); return r.authenticateServer((await r.pollEnrollment(pending.deviceCode)).credential); };
    const [first, second] = [await enroll(registry, 'Reclaim A'), await enroll(secondRegistry, 'Reclaim B')];
    const reclaims = await Promise.allSettled([registry.claimAddress(owner, first.id, label), secondRegistry.claimAddress(owner, second.id, label)]);
    expect(reclaims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect([first.id, second.id]).toContain((await secondRegistry.resolveServer(label)).id);
    // Model cleanup holding the sessions table while startup wants to migrate
    // servers/codes first. The common advisory lock prevents table-lock inversion.
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const cleanup = db.transaction(owner, async query => {
      await query('DELETE FROM connect_sessions WHERE expires_at=0');
      entered(); await gate;
      await query('DELETE FROM connect_codes WHERE expires_at=0');
    });
    await started;
    const migration = other.migrate();
    try {
      await expect.poll(async () => Number((await other.query("SELECT COUNT(*) AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=hashtext('connect-schema')::oid"))[0].n)).toBeGreaterThan(0);
    } finally { release(); await Promise.all([cleanup, migration]); }
    // A real idle socket loss must be handled by pg's pool and reconnect cleanly.
    const pid = (await db.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    await other.query('SELECT pg_terminate_backend($1)', [pid]);
    await expect.poll(async () => {
      try { return (await db.query('SELECT pg_backend_pid() AS pid'))[0].pid !== pid; } catch { return false; }
    }).toBe(true);
  } finally {
    await db.query('DELETE FROM connect_sessions WHERE server_id IN (SELECT id FROM connect_servers WHERE user_id=$1)', [owner]);
    await db.query('DELETE FROM connect_codes WHERE user_id=$1', [owner]);
    await db.query('DELETE FROM connect_servers WHERE user_id=$1', [owner]);
    await db.query('DELETE FROM connect_addresses WHERE user_id=$1', [owner]);
    await db.query('DELETE FROM connect_devices WHERE user_id=$1', [owner]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [owner]);
    await db.query('DELETE FROM users WHERE id=$1', [owner]);
    await db.close(); await other.close();
  }
});
