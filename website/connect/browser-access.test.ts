import { afterEach, beforeEach, expect, it } from 'vitest';
import { openConnectDatabase } from './database.mjs';
import { createRegistry, CODE_TTL, SESSION_TTL } from './registry.mjs';
import { createBrowserAccess, browserReturnPath, browserCookie, BROWSER_SESSION_TTL } from './browser-access.mjs';
import { addressError } from './addresses.mjs';

let db: any, registry: any, browser: any, clock: number, server: any;
const account = { id: 'alice', session_id: 'session' };
beforeEach(async () => {
  clock = 1_800_000_000_000;
  db = await openConnectDatabase(':memory:', { production: false }); await db.migrate();
  await db.query('CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at BIGINT)');
  await db.query('INSERT INTO sessions VALUES($1,$2,$3)', ['session', 'alice', clock + SESSION_TTL * 2]);
  registry = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock });
  browser = createBrowserAccess(db, registry, { now: () => clock });
  server = await enroll('alice');
});
afterEach(() => db.close());
async function enroll(owner: string) {
  const start = await registry.startEnrollment('MacBook'); await registry.approveEnrollment(owner, start.userCode);
  return registry.authenticateServer((await registry.pollEnrollment(start.deviceCode)).credential);
}
async function start(label = 'alice-mac', path = '/threads/123?view=full') {
  await registry.claimAddress('alice', server.id, label);
  const result = await browser.start(server, label, path);
  return { ...result, code: new URL(result.location).searchParams.get('browser') };
}

it('claims one permanent alias without changing the tunnel identity or phone discovery URL', async () => {
  expect(await registry.addressAvailability('alice-mac')).toMatchObject({ available: true });
  const claim = await registry.claimAddress('alice', server.id, 'alice-mac');
  expect(claim.browserUrl).toBe('https://alice-mac.connect.example.com');
  expect(await registry.resolveServer('alice-mac')).toEqual(server);
  expect(await registry.resolveServer(server.label)).toEqual(server);
  expect((await registry.listServers('alice'))[0]).toMatchObject({ address: 'alice-mac', browserUrl: claim.browserUrl, serverUrl: registry.serverUrl(server.label) });
  expect(await registry.claimAddress('alice', server.id, 'alice-mac')).toEqual(claim);
  expect(await registry.addressAvailability('alice-mac')).toMatchObject({ available: false });
  await expect(registry.claimAddress('alice', server.id, 'new-name')).rejects.toThrow('address_already_claimed');
  await expect(registry.claimAddress('bob', server.id, 'bobs-mac')).rejects.toThrow('unknown_server');
});

it('uses a separate root browser domain while retaining existing server and phone identities', async () => {
  const short = createRegistry(db, { domain: 'connect.example.com', browserDomain: 'example.com', accountUrl: 'https://example.com', now: () => clock });
  const access = createBrowserAccess(db, short, { now: () => clock });
  expect((await short.addressAvailability('alice-mac')).browserUrl).toBe('https://alice-mac.example.com');
  expect((await short.claimAddress('alice', server.id, 'alice-mac')).browserUrl).toBe('https://alice-mac.example.com');
  expect((await short.listServers('alice'))[0]).toMatchObject({ browserUrl: 'https://alice-mac.example.com', serverUrl: registry.serverUrl(server.label) });
  expect(short.browserUrl(server.label)).toBe(registry.serverUrl(server.label));
  const qr = await short.createPhoneCode(server);
  expect(qr.serverUrl).toBe(registry.serverUrl(server.label));
  expect((await short.redeemPhoneCode(server, qr.code, 'Phone')).connectDomain).toBe('connect.example.com');
  const handoff = await access.start(server, 'alice-mac', '/');
  const code = new URL(handoff.location).searchParams.get('browser');
  expect((await access.info(account, code)).browserUrl).toBe('https://alice-mac.example.com');
  expect((await access.approve(account, code)).location).toBe(`https://alice-mac.example.com/_connect/callback?code=${code}`);
  const result = await access.redeem(server, 'alice-mac', code, handoff.state);
  expect(await access.authorizeSession(server, 'alice-mac', result.value)).toEqual({ user_id: 'alice' });
});

it.each(['https://example.com', 'example.com/path', '..bad', 'UPPER.test', 'example.com@evil.test', ''])('refuses malformed browser namespace %s', browserDomain => {
  expect(() => createRegistry(db, { domain: 'connect.example.com', browserDomain, accountUrl: 'https://example.com' })).toThrow('Invalid Connect origins');
});
it('arbitrates concurrent claims across accounts and keeps revoked addresses reserved', async () => {
  const other = await enroll('bob');
  const results = await Promise.allSettled([registry.claimAddress('alice', server.id, 'my-computer'), registry.claimAddress('bob', other.id, 'my-computer')]);
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('address_taken');
  await registry.revoke('alice', 'server', server.id);
  expect(await registry.resolveServer('my-computer')).toBeNull();
  expect(await registry.addressAvailability('my-computer')).toMatchObject({ available: false });
  clock += 91 * 24 * 60 * 60_000; await registry.prune();
  expect(await registry.addressAvailability('my-computer')).toMatchObject({ available: false });
  expect((await db.query('SELECT server_id FROM connect_addresses'))[0].server_id).toBeNull();
});
it('lets the owner take a revoked or purged computer address back for a new enrollment', async () => {
  await registry.claimAddress('alice', server.id, 'my-computer');
  const replacement = await enroll('alice');
  expect(await registry.addressAvailability('my-computer', 'alice')).toMatchObject({ available: false });
  await expect(registry.claimAddress('alice', replacement.id, 'my-computer')).rejects.toThrow('address_taken');
  await registry.revoke('alice', 'server', server.id);
  expect(await registry.addressAvailability('my-computer', 'bob')).toMatchObject({ available: false });
  expect(await registry.addressAvailability('my-computer', 'alice')).toMatchObject({ available: true });
  const bobs = await enroll('bob');
  await expect(registry.claimAddress('bob', bobs.id, 'my-computer')).rejects.toThrow('address_taken');
  const limited = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  expect(await limited.claimAddress('alice', replacement.id, 'my-computer')).toMatchObject({ label: 'my-computer' });
  expect(await registry.resolveServer('my-computer')).toEqual(replacement);
  await registry.revoke('alice', 'server', replacement.id);
  clock += 91 * 24 * 60 * 60_000; await registry.prune();
  expect((await db.query('SELECT server_id FROM connect_addresses'))[0].server_id).toBeNull();
  const third = await enroll('alice');
  expect(await registry.addressAvailability('my-computer', 'alice')).toMatchObject({ available: true });
  await registry.claimAddress('alice', third.id, 'my-computer');
  expect(await registry.resolveServer('my-computer')).toEqual(third);
});
it.each(['ab', 'a'.repeat(31), 'UPPER', 'end-', '-start', 'two--dashes', 'a.b', 'www', 'admin', 's-computer', null])('rejects invalid or reserved address %s', async label => {
  expect(addressError(label)).not.toBeNull();
  await expect(registry.claimAddress('alice', server.id, label)).rejects.toThrow();
  await expect(registry.addressAvailability(label)).rejects.toThrow();
});
it('limits the total number of permanent address reservations per account', async () => {
  const limited = createRegistry(db, { domain: 'connect.example.com', accountUrl: 'https://example.com', now: () => clock, limit: 1 });
  const other = await enroll('alice');
  await limited.claimAddress('alice', server.id, 'alice-mac');
  await expect(limited.claimAddress('alice', other.id, 'alice-air')).rejects.toThrow('account_limit');
});
it('binds a single-use browser handoff to its hostname, starting browser and account session', async () => {
  const login = await start();
  expect(await browser.info(account, login.code)).toEqual({ name: 'MacBook', browserUrl: 'https://alice-mac.connect.example.com' });
  await expect(browser.approve({ ...account, id: 'bob' }, login.code)).rejects.toThrow('not_your_server');
  await expect(browser.info({ ...account, id: 'bob' }, login.code)).rejects.toThrow('not_your_server');
  await expect(browser.redeem(server, 'alice-mac', login.code, login.state)).rejects.toThrow('sign_in_required');
  expect((await browser.approve(account, login.code)).location).toBe(`https://alice-mac.connect.example.com/_connect/callback?code=${login.code}`);
  for (const state of ['', 'x'.repeat(43)]) await expect(browser.redeem(server, 'alice-mac', login.code, state)).rejects.toThrow('invalid_browser_state');
  await expect(browser.redeem(server, server.label, login.code, login.state)).rejects.toThrow('invalid_browser_state');
  const second = await enroll('alice');
  await expect(browser.redeem(second, 'alice-mac', login.code, login.state)).rejects.toThrow('invalid_browser_state');
  const result = await browser.redeem(server, 'alice-mac', login.code, login.state);
  expect(result).toMatchObject({ returnPath: '/threads/123?view=full', maxAge: 7200 });
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toEqual({ user_id: 'alice' });
  expect(await browser.authorizeSession(server, server.label, result.value)).toBeNull();
  expect(await browser.authorizeSession(second, 'alice-mac', result.value)).toBeNull();
  expect(await browser.authorizeSession(server, 'alice-mac', 'bad')).toBeNull();
  expect(JSON.stringify(await db.query('SELECT * FROM connect_browser_requests'))).not.toContain(login.state);
  expect(JSON.stringify(await db.query('SELECT * FROM connect_browser_sessions'))).not.toContain(result.value);
  await expect(browser.redeem(server, 'alice-mac', login.code, login.state)).rejects.toThrow('expired_or_used');
  await db.query('DELETE FROM sessions');
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toBeNull();
});
it.each(['expire', 'revoke', 'logout'])('rejects handoffs after %s and fails closed for existing sessions', async reason => {
  const login = await start(); await browser.approve(account, login.code);
  const result = await browser.redeem(server, 'alice-mac', login.code, login.state);
  const pending = await browser.start(server, 'alice-mac', '/'); const code = new URL(pending.location).searchParams.get('browser');
  if (reason === 'expire') clock += SESSION_TTL * 2;
  if (reason === 'revoke') await registry.revoke('alice', 'server', server.id);
  if (reason === 'logout') await db.query('DELETE FROM sessions');
  await expect(browser.approve(account, code)).rejects.toThrow();
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toBeNull();
});
it('rejects malformed codes, caps pending requests, and prunes expired browser state', async () => {
  await expect(browser.info(account, 'bad')).rejects.toThrow('invalid_code');
  const login = await start(); await browser.approve(account, login.code); await browser.redeem(server, 'alice-mac', login.code, login.state);
  await db.query('WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO connect_browser_requests(hash,state_hash,server_id,label,return_path,expires_at) SELECT CAST(x AS TEXT),$1,$2,$3,$4,$5 FROM n', ['state', server.id, 'alice-mac', '/', clock + CODE_TTL]);
  await expect(browser.start(server, 'alice-mac', '/')).rejects.toThrow('busy');
  clock += SESSION_TTL * 3;
  for (let i = 0; i < 6; i++) await registry.prune();
  expect(await db.query('SELECT * FROM connect_browser_sessions')).toEqual([]);
  expect(await db.query('SELECT * FROM connect_browser_requests')).toEqual([]);
});
it('allows exactly one redemption under concurrency and respects the website session expiry', async () => {
  const login = await start(); await browser.approve(account, login.code);
  await db.query('UPDATE sessions SET expires_at=$1', [clock + 30_000]);
  const results = await Promise.allSettled([browser.redeem(server, 'alice-mac', login.code, login.state), browser.redeem(server, 'alice-mac', login.code, login.state)]);
  expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
  expect((results.find(x => x.status === 'fulfilled') as PromiseFulfilledResult<any>).value.maxAge).toBe(30);
});
it('keeps browser access after one hour and caps it at thirty days and the parent login', async () => {
  await db.query('UPDATE sessions SET expires_at=$1', [clock + BROWSER_SESSION_TTL * 2]);
  const login = await start(); await browser.approve(account, login.code);
  const result = await browser.redeem(server, 'alice-mac', login.code, login.state);
  expect(result.maxAge).toBe(BROWSER_SESSION_TTL / 1000);
  clock += SESSION_TTL + 1;
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toEqual({ user_id: 'alice' });
  clock += BROWSER_SESSION_TTL - SESSION_TTL - 2;
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toEqual({ user_id: 'alice' });
  clock += 1;
  expect(await browser.authorizeSession(server, 'alice-mac', result.value)).toBeNull();
});
it('confines post-login navigation and emits host-only secure HttpOnly cookies', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil', '/_connect/login', '/'.repeat(5000), null]) expect(browserReturnPath(value)).toBe('/');
  expect(browserReturnPath('/threads/123?q=a#fragment')).toBe('/threads/123?q=a');
  expect(browserCookie('session', 'token', true, 60)).toBe('session=token; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
  expect(browserCookie('state', '', false, 0)).not.toContain('Secure');
});
