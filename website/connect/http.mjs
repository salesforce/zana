import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConnectError, credentialValid } from './registry.mjs';
import { createBrowserAccess, browserCookie } from './browser-access.mjs';
import { OPEN_COOKIE, OPEN_TTL, createBrowserNavigation, verifyBrowserNavigation } from './browser-navigation.mjs';
import { createDesktopLogin } from './desktop-login.mjs';

export const readCookie = (header, name) => (header ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
export const bearer = request => request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
export const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers } });

export async function readJson(request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new ConnectError('expected_json', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ConnectError('missing_body');
  let size = 0; const chunks = [];
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > 4096) { await reader.cancel(); throw new ConnectError('body_too_large', 413); }
      chunks.push(result.value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch (error) { if (error instanceof ConnectError) throw error; throw new ConnectError('invalid_json'); }
  finally { reader.releaseLock(); }
}

/** Matches the existing website session signature and checks its authoritative DB row. */
export async function browserAccount(db, cookieHeader, secret, now = Date.now()) {
  const cookie = readCookie(cookieHeader, 'zcc_session');
  if (!secret || cookie.length > 256) return null;
  const dot = cookie.lastIndexOf('.'); if (dot <= 0) return null;
  const id = cookie.slice(0, dot); const supplied = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', secret).update(id).digest('base64url'));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return (await db.query('SELECT u.id,u.github_login,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>$2', [id, now]))[0] ?? null;
}

export function createConnectApi({ registry, db, sessionSecret, onRevoke = () => {}, now = Date.now }) {
  const browser = createBrowserAccess(db, registry, { now });
  const desktop = createDesktopLogin(db, { now, sessionSecret });
  const buckets = new Map();
  function rate(key) {
    const time = now();
    if (buckets.size >= 2000) for (const [id, row] of buckets) if (row.until <= time) buckets.delete(id);
    let row = buckets.get(key);
    if (!row || row.until <= time) {
      if (buckets.size >= 2000 && !row) throw new ConnectError('busy', 429);
      row = { until: time + 60_000, count: 0 }; buckets.set(key, row);
    }
    if (++row.count > 30) throw new ConnectError('too_many_attempts', 429);
  }
  const account = async request => {
    const user = await browserAccount(db, request.headers.get('cookie'), sessionSecret, now());
    if (!user) throw new ConnectError('sign_in_required', 401);
    if (request.method !== 'GET' && request.headers.get('origin') !== registry.accountUrl) throw new ConnectError('untrusted_origin', 403);
    return user;
  };
  const server = async request => {
    const value = await registry.authenticateServer(bearer(request));
    if (!value) throw new ConnectError('unauthorized', 401);
    return value;
  };
  async function dispatch(request, clientKey = 'native') {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '');
      if (url.origin !== registry.accountUrl) throw new ConnectError('untrusted_origin', 403);
      const suppliedOrigin = request.headers.get('origin');
      if (suppliedOrigin && suppliedOrigin !== registry.accountUrl) throw new ConnectError('untrusted_origin', 403);
      if (path === '/api/connect/host-installer' && request.method === 'GET') {
        return new Response(readFileSync(new URL('./host-installer.mjs', import.meta.url)), { headers: {
          'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
        } });
      }
      if (path === '/api/connect/desktop/start' && request.method === 'POST') {
        rate(`desktop-start:${clientKey}`); await readJson(request);
        return json(await desktop.start());
      }
      if (path === '/api/connect/desktop/poll' && request.method === 'POST') {
        const { deviceCode } = await readJson(request);
        if (!credentialValid(deviceCode)) throw new ConnectError('invalid_code');
        rate(`desktop-poll:${deviceCode}`);
        return json(await desktop.poll(deviceCode));
      }
      if (path === '/api/connect/desktop/info' && request.method === 'GET') {
        const user = await account(request); rate(`desktop-info:${user.id}`);
        return json(await desktop.info(url.searchParams.get('code')));
      }
      if (path === '/api/connect/desktop/approve' && request.method === 'POST') {
        const user = await account(request); rate(`desktop-approve:${user.id}`);
        const input = await readJson(request);
        return json(await desktop.approve(user, input.code, input.approved));
      }
      if (path === '/api/connect/phone/start' && request.method === 'POST') {
        rate(`phone-start:${clientKey}`);
        return json(await registry.startPhoneLogin((await readJson(request)).name));
      }
      if (path === '/api/connect/phone/poll' && request.method === 'POST') {
        const { deviceCode } = await readJson(request);
        if (!credentialValid(deviceCode)) throw new ConnectError('invalid_code');
        rate(`phone-poll:${deviceCode}`);
        return json(await registry.pollPhoneLogin(deviceCode));
      }
      if (path === '/api/connect/phone/info' && request.method === 'GET') {
        await account(request); rate(`phone-info:${clientKey}`);
        return json(await registry.phoneLoginInfo(url.searchParams.get('code')));
      }
      if (path === '/api/connect/phone/approve' && request.method === 'POST') {
        const user = await account(request); const input = await readJson(request);
        rate(`phone-approve:${user.id}`);
        return json(await registry.approvePhoneLogin(user.id, input.code, input.approved));
      }
      if (path === '/api/connect/device/start' && request.method === 'POST') {
        rate(`start:${clientKey}`);
        return json(await registry.startEnrollment((await readJson(request)).name));
      }
      if (path === '/api/connect/device/poll' && request.method === 'POST') {
        const { deviceCode } = await readJson(request);
        if (!credentialValid(deviceCode)) throw new ConnectError('invalid_code');
        rate(`poll:${deviceCode}`);
        return json(await registry.pollEnrollment(deviceCode));
      }
      if (path === '/api/connect/device/info' && request.method === 'GET') {
        await account(request); rate(`info:${clientKey}`);
        return json(await registry.enrollmentInfo(url.searchParams.get('code')));
      }
      if (path === '/api/connect/device/approve' && request.method === 'POST') {
        const user = await account(request); const input = await readJson(request);
        if (typeof input.approved !== 'boolean') throw new ConnectError('invalid_approval');
        return json(await registry.approveEnrollment(user.id, input.code, input.approved));
      }
      if (path === '/api/connect/account' && request.method === 'GET') {
        const user = await account(request);
        return json({ user: { id: user.id, name: user.github_login }, domain: registry.browserDomain, servers: await registry.listServers(user.id), devices: await registry.listDevices(user.id) });
      }
      if (path === '/api/connect/account/hosts' && request.method === 'GET') {
        const user = await account(request); rate(`account-hosts:${user.id}`);
        const serverId = url.searchParams.get('serverId');
        const owned = (await registry.listServers(user.id)).find(row => row.id === serverId && !row.revoked);
        if (!owned) throw new ConnectError('not_your_server', 403);
        return json({ machines: await registry.listMachines(user.id, owned.id) });
      }
      if (path === '/api/connect/computer/reserve' && request.method === 'POST') {
        const user = await account(request); rate(`computer-code:${user.id}`);
        return json(await registry.reserveComputer(user.id, (await readJson(request)).label));
      }
      if (path === '/api/connect/computer/code' && request.method === 'POST') {
        const user = await account(request); rate(`computer-code:${user.id}`);
        return json(await registry.createComputerCode(user.id, (await readJson(request)).serverId));
      }
      if (path === '/api/connect/computer/redeem' && request.method === 'POST') {
        rate(`computer-redeem:${clientKey}`);
        const input = await readJson(request);
        return json(await registry.redeemComputerCode(input.code, input.name));
      }
      if (path === '/api/connect/instance/bind' && request.method === 'POST') {
        const principal = await server(request);
        return json(await registry.bindInstance(principal, (await readJson(request)).instanceId));
      }
      if (path === '/api/connect/hosts/code' && request.method === 'POST') {
        const principal = await server(request); rate(`host-code:${principal.id}`);
        return json(await registry.createMachineCode(principal, await readJson(request)));
      }
      if (path === '/api/connect/hosts/redeem' && request.method === 'POST') {
        rate(`host-redeem:${clientKey}`);
        const input = await readJson(request);
        return json(await registry.redeemMachineCode(input.code, input.attemptSecret));
      }
      if (path === '/api/connect/hosts' && request.method === 'GET') {
        const principal = await server(request);
        return json({ machines: await registry.listMachines(principal.user_id, principal.id) });
      }
      if (path === '/api/connect/hosts/revoke' && request.method === 'POST') {
        const principal = await server(request);
        const id = await registry.revokeMachine(principal, (await readJson(request)).hostId);
        if (id) onRevoke('machine', id);
        return json({ revoked: id !== null });
      }
      if (path === '/api/connect/address' && request.method === 'GET') {
        const user = await account(request); rate(`address:${user.id}`);
        return json(await registry.addressAvailability(url.searchParams.get('label'), user.id));
      }
      if (path === '/api/connect/address' && request.method === 'POST') {
        const user = await account(request); rate(`address:${user.id}`);
        const input = await readJson(request);
        if (typeof input.serverId !== 'string' || input.serverId.length > 80) throw new ConnectError('invalid_target');
        return json(await registry.claimAddress(user.id, input.serverId, input.label));
      }
      if (path === '/api/connect/browser/open' && request.method === 'POST') {
        const user = await account(request); rate(`browser:${user.id}`);
        const { serverId } = await readJson(request);
        const owned = (await registry.listServers(user.id)).find(row => row.id === serverId && !row.revoked && row.browserUrl);
        if (!owned) throw new ConnectError('not_your_server', 403);
        const navigation = createBrowserNavigation(sessionSecret, user, owned.browserUrl, now());
        return json({ location: `${owned.browserUrl}/_connect/login?intent=${navigation.intent}` }, 200, {
          'set-cookie': browserCookie(OPEN_COOKIE, navigation.cookie, url.protocol === 'https:', OPEN_TTL / 1000)
        });
      }
      if (path === '/api/connect/browser/open' && request.method === 'GET') {
        const user = await account(request); rate(`browser:${user.id}`);
        const code = url.searchParams.get('code');
        const info = await browser.info(user, code);
        if (!verifyBrowserNavigation(sessionSecret, user, info.browserUrl, url.searchParams.get('intent'), readCookie(request.headers.get('cookie'), OPEN_COOKIE), now())) throw new ConnectError('invalid_browser_state', 403);
        const result = await browser.approve(user, code);
        return new Response(null, { status: 303, headers: {
          location: result.location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'set-cookie': browserCookie(OPEN_COOKIE, '', url.protocol === 'https:', 0)
        } });
      }
      if (path === '/api/connect/browser/info' && request.method === 'GET') {
        const user = await account(request); rate(`browser:${user.id}`);
        return json(await browser.info(user, url.searchParams.get('code')));
      }
      if (path === '/api/connect/browser/approve' && request.method === 'POST') {
        const user = await account(request); rate(`browser:${user.id}`);
        return json(await browser.approve(user, (await readJson(request)).code));
      }
      if (path === '/api/connect/servers' && request.method === 'GET') {
        const credential = bearer(request);
        const principal = credential ? await registry.authenticateDevice(credential) ?? await registry.authenticateServer(credential) : null;
        const userId = principal?.user_id ?? (credential ? null : (await account(request)).id);
        if (!userId) throw new ConnectError('unauthorized', 401);
        return json({ servers: await registry.listServers(userId) });
      }
      if (path === '/api/connect/machine-code' && request.method === 'POST') return json(await registry.createPhoneCode(await server(request)));
      if (path === '/api/connect/devices' && request.method === 'GET') return json({ devices: await registry.listDevices((await server(request)).user_id) });
      if (path === '/api/connect/disconnect' && request.method === 'POST') {
        const principal = await server(request);
        const revoked = await registry.revoke(principal.user_id, 'server', principal.id);
        if (revoked) onRevoke('server', principal.id);
        return json({ revoked });
      }
      if (path === '/api/connect/revoke' && request.method === 'POST') {
        const input = await readJson(request);
        if (!['server', 'device'].includes(input.kind) || typeof input.id !== 'string' || input.id.length > 80) throw new ConnectError('invalid_target');
        const credential = bearer(request);
        const owner = credential ? (await server(request)).user_id : (await account(request)).id;
        const revoked = await registry.revoke(owner, input.kind, input.id);
        if (revoked) onRevoke(input.kind, input.id);
        return json({ revoked });
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return json({ error: error instanceof ConnectError ? error.message : 'connect_unavailable' }, error instanceof ConnectError ? error.status : 503);
    }
  }
  return { dispatch };
}
