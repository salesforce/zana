import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import { openConnectDatabase } from './database.mjs';
import { createRegistry } from './registry.mjs';
import { createConnectGateway } from './gateway.mjs';

let db: any, registry: any, gateway: any, http: ReturnType<typeof createServer>, port: number;
const sockets: WebSocket[] = [];
const secret = 'test-signature-secret';
const cookie = (id: string) => `zcc_session=${id}.${createHmac('sha256', secret).update(id).digest('base64url')}`;
beforeEach(async () => {
  db = await openConnectDatabase(':memory:', { production: false }); await db.migrate();
  await db.query('CREATE TABLE users(id TEXT PRIMARY KEY,github_login TEXT)');
  await db.query('CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT,expires_at BIGINT)');
  for (const id of ['alice', 'bob']) { await db.query('INSERT INTO users VALUES($1,$1)', [id]); await db.query('INSERT INTO sessions VALUES($1,$1,$2)', [id, Date.now() + 60_000]); }
  registry = createRegistry(db, { domain: 'connect.example.com', browserDomain: 'example.com', accountUrl: 'https://example.com' });
  gateway = createConnectGateway({ db, registry, sessionSecret: secret, checkIntervalMs: 30 });
  http = createServer((req, res) => void gateway.handleHttp(req, res));
  http.on('upgrade', (req, socket, head) => void gateway.handleUpgrade(req, socket, head));
  http.listen(0, '127.0.0.1'); await once(http, 'listening'); port = (http.address() as any).port;
});
afterEach(async () => { for (const ws of sockets.splice(0)) ws.terminate(); await gateway.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())); await db.close(); });
function call(host: string, path: string, body?: unknown, extra: Record<string, string> = {}, method?: string): Promise<{ status: number; body: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { host, 'x-forwarded-proto': 'https', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra } }, res => {
      let text = ''; res.on('data', data => text += data); res.on('end', () => { let value; try { value = JSON.parse(text); } catch { value = text; } resolve({ status: res.statusCode!, body: value, headers: res.headers }); });
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function enroll(owner: string, name = 'Laptop') {
  const start = await call('example.com', '/api/connect/device/start', { name });
  expect(start.status).toBe(200);
  expect((await call('example.com', '/api/connect/device/poll', { deviceCode: start.body.deviceCode })).body.pending).toBe(true);
  expect((await call('example.com', '/api/connect/device/approve', { code: start.body.userCode, approved: true }, { cookie: cookie(owner), origin: 'https://example.com' })).status).toBe(200);
  const result = (await call('example.com', '/api/connect/device/poll', { deviceCode: start.body.deviceCode })).body;
  return { ...result, host: new URL(result.serverUrl).host };
}
async function phone(server: any) {
  const qr = (await call('example.com', '/api/connect/machine-code', {}, { authorization: `Bearer ${server.credential}` })).body;
  const paired = await call(server.host, '/_mobile/pair', { code: qr.code, label: 'iPhone' }); expect(paired.status).toBe(200);
  const session = await call(server.host, '/_mobile/session', {}, { authorization: `Bearer ${paired.body.credential}` }); expect(session.status).toBe(200);
  return { ...paired.body, cookie: `zcc_mobile_session=${session.body.cookie.value}` };
}
function socket(server: any, path: string, headers: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { host: server.host, 'x-forwarded-proto': 'https', ...headers } });
  sockets.push(ws); ws.on('error', () => {}); return ws;
}
async function laptop(server: any, name: string) {
  const ws = socket(server, '/_relay/connect', { authorization: `Bearer ${server.credential}` });
  const hello = once(ws, 'message'); await once(ws, 'open'); await hello;
  ws.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'request-end') for (const value of [{ type: 'response', status: 200, headers: { 'content-type': 'text/plain' } }, { type: 'response-data', data: Buffer.from(name.repeat(9000)).toString('base64') }, { type: 'response-end' }]) ws.send(JSON.stringify({ id: frame.id, ...value }));
    if (frame.type === 'ws-data') ws.send(JSON.stringify({ ...frame, data: Buffer.from(`${name}:${Buffer.from(frame.data, 'base64')}`).toString('base64') }));
  }); return ws;
}
it('opens a dashboard domain through redirects into the live app without another approval', async () => {
  const a = await enroll('alice'); await laptop(a, 'Zana');
  await registry.claimAddress('alice', a.serverId, 'alice-mac');
  const issued = await call('example.com', '/api/connect/browser/open/', { serverId: a.serverId }, { cookie: cookie('alice'), origin: 'https://example.com' });
  expect(issued.status).toBe(200);
  const accountIntentCookie = issued.headers['set-cookie'][0].split(';')[0];
  const destination = new URL(issued.body.location);
  expect(destination.origin).toBe('https://alice-mac.example.com');
  const start = await call(destination.host, destination.pathname + destination.search, undefined, { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
  expect(start.status).toBe(303);
  const stateCookie = start.headers['set-cookie'][0].split(';')[0];
  const continuation = new URL(start.headers.location);
  expect(continuation.pathname).toBe('/api/connect/browser/open/');
  // Neither a copied URL nor a different account's cookie can approve this browser.
  expect((await call('example.com', continuation.pathname + continuation.search, undefined, { cookie: cookie('alice') })).status).toBe(403);
  expect((await call('example.com', continuation.pathname + continuation.search, undefined, { cookie: `${cookie('bob')}; ${accountIntentCookie}` })).status).toBe(403);
  const approved = await call('example.com', continuation.pathname + continuation.search, undefined, { cookie: `${cookie('alice')}; ${accountIntentCookie}` });
  expect(approved.status).toBe(303);
  expect(approved.headers['set-cookie'][0]).toContain('Max-Age=0');
  const callback = new URL(approved.headers.location);
  expect(callback.origin).toBe(destination.origin);
  expect((await call(callback.host, callback.pathname + callback.search)).status).toBe(403);
  const redeemed = await call(callback.host, callback.pathname + callback.search, undefined, { cookie: stateCookie });
  expect(redeemed.status).toBe(303); expect(redeemed.headers.location).toBe('/');
  const appCookie = redeemed.headers['set-cookie'][0].split(';')[0];
  const app = await call(callback.host, '/', undefined, { cookie: appCookie });
  expect(app.status).toBe(200); expect(app.body).toBe('Zana'.repeat(9000));
  expect((await call(callback.host, callback.pathname + callback.search, undefined, { cookie: stateCookie })).status).toBe(410);
  await db.query('DELETE FROM sessions WHERE id=$1', ['alice']);
  expect((await call(callback.host, '/', undefined, { cookie: appCookie })).status).toBe(401);
});
it('routes concurrent owners/laptops, keeps cookies scoped and discovers only the paired account', async () => {
  const a = await enroll('alice'); const second = await enroll('alice'); const b = await enroll('bob');
  await laptop(a, 'A'); await laptop(second, 'S'); await laptop(b, 'B');
  const pa = await phone(a); const pb = await phone(b);
  const responses = await Promise.all([call(a.host, '/api/v1/health', undefined, { cookie: pa.cookie }), call(b.host, '/api/v1/health', undefined, { cookie: pb.cookie })]);
  expect(responses.map(r => r.body)).toEqual(['A'.repeat(9000), 'B'.repeat(9000)]);
  expect((await call(b.host, '/', undefined, { cookie: pa.cookie })).status).toBe(401);
  expect((await call(second.host, '/', undefined, { cookie: pa.cookie })).status).toBe(401);
  expect((await call(b.host, '/_mobile/session', {}, { authorization: `Bearer ${pa.credential}` })).status).toBe(401);
  const discovered = await call(a.host, '/_mobile/servers', undefined, { authorization: `Bearer ${pa.credential}` });
  expect(discovered.body.servers.map((s: any) => s.id).sort()).toEqual([a.serverId, second.serverId].sort());
  expect((await call(second.host, '/_mobile/session', {}, { authorization: `Bearer ${pa.credential}` })).status).toBe(200);
  const ws = socket(a, '/ws', { cookie: pa.cookie }); await once(ws, 'open'); const message = once(ws, 'message'); ws.send('hi'); expect((await message)[0].toString()).toBe('A:hi');
});
it('reconnect replaces one laptop and device revocation closes live sockets', async () => {
  const a = await enroll('alice'); const b = await enroll('bob');
  const old = await laptop(a, 'old'); await laptop(b, 'B');
  const p = await phone(a); const pb = await phone(b);
  const oldClosed = once(old, 'close'); await laptop(a, 'new'); await oldClosed;
  expect((await call(a.host, '/', undefined, { cookie: p.cookie })).body).toBe('new'.repeat(9000));
  const ws = socket(a, '/ws', { cookie: p.cookie }); await once(ws, 'open');
  expect((await call('example.com', '/api/connect/revoke', { kind: 'device', id: p.deviceId }, { authorization: `Bearer ${b.credential}` })).body.revoked).toBe(false);
  const closed = once(ws, 'close');
  expect((await call('example.com', '/api/connect/revoke', { kind: 'device', id: p.deviceId }, { authorization: `Bearer ${a.credential}` })).body.revoked).toBe(true);
  expect((await closed)[0]).toBe(1008);
  expect((await call(a.host, '/', undefined, { cookie: p.cookie })).status).toBe(401);
  expect((await call(b.host, '/', undefined, { cookie: pb.cookie })).status).toBe(200);
  expect((await call('example.com', '/api/connect/disconnect', {}, { authorization: `Bearer ${a.credential}` })).body.revoked).toBe(true);
  expect((await call(a.host, '/')).status).toBe(404);
});
it('rejects unauthenticated, crossed-origin, malformed and oversized requests', async () => {
  const a = await enroll('alice');
  expect((await call('example.com', '/api/connect/account')).status).toBe(401);
  expect((await call('example.com', '/api/connect/account', undefined, { cookie: cookie('alice') })).body.user.name).toBe('alice');
  expect((await call('example.com', '/api/connect/device/approve', { code: 'a', approved: true }, { cookie: cookie('alice'), origin: 'https://evil.example.com' })).status).toBe(403);
  expect((await call('example.com', '/api/connect/device/start', { name: 'x'.repeat(5000) })).status).toBe(413);
  expect((await call(a.host, '/_mobile/health')).body.connect).toBe(true);
  expect((await call(a.host, '/', undefined, { 'x-forwarded-proto': 'http' })).status).toBe(403);
  expect((await call(a.host, '/', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  expect((await call(a.host, '/_mobile/unknown')).status).toBe(404);
  const wrong = socket(a, '/_relay/connect', { authorization: `Bearer ${'x'.repeat(43)}` });
  expect((await once(wrong, 'unexpected-response'))[1].statusCode).toBe(401); wrong.terminate();
  const p = await phone(a);
  expect((await call(a.host, '/', undefined, { cookie: p.cookie })).status).toBe(503);
});

it.each(['device', 'database', 'expiry', 'unavailable'])('cancels an active HTTP stream on %s revocation/authorization failure', async kind => {
  const a = await enroll('alice');
  const desktop = socket(a, '/_relay/connect', { authorization: `Bearer ${a.credential}` });
  const hello = once(desktop, 'message'); await once(desktop, 'open'); await hello;
  const cancelled = new Promise(resolve => desktop.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'request-end') {
      desktop.send(JSON.stringify({ id: frame.id, type: 'response', status: 200, headers: {} }));
      desktop.send(JSON.stringify({ id: frame.id, type: 'response-data', data: Buffer.from('partial').toString('base64') }));
    }
    if (frame.type === 'cancel') resolve(frame.id);
  }));
  const p = await phone(a);
  const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host: a.host, 'x-forwarded-proto': 'https', cookie: p.cookie } }, resolve);
    req.on('error', reject); req.end();
  });
  const closed = new Promise(resolve => response.once('close', resolve));
  response.on('error', () => {}); response.resume();
  if (kind === 'device') {
    expect((await call('example.com', '/api/connect/revoke', { kind: 'device', id: p.deviceId }, { authorization: `Bearer ${a.credential}` })).body.revoked).toBe(true);
  } else if (kind === 'database') await registry.revoke('alice', 'device', p.deviceId);
  else if (kind === 'expiry') await db.query('UPDATE connect_sessions SET expires_at=$1', [Date.now() - 1]);
  else vi.spyOn(registry, 'authorizeSession').mockRejectedValue(new Error('Unavailable'));
  await closed; await cancelled;
  expect(response.complete).toBe(false);
  expect(gateway.connectionCount()).toBe(1);
});

it('does not reopen a visitor connection if shutdown races its authorization check', async () => {
  const a = await enroll('alice'); await laptop(a, 'A'); const p = await phone(a);
  const original = registry.authorizeSession;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const authorizing = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(registry, 'authorizeSession').mockImplementation(async (...args: any[]) => { entered(); await waiting; return original(...args); });
  const ws = socket(a, '/ws', { cookie: p.cookie });
  const response = once(ws, 'unexpected-response');
  await authorizing; await gateway.close(); release();
  expect((await response)[1].statusCode).toBe(503); ws.terminate();
});

it('claims an address, signs an ordinary browser in, proxies HTTP/WebSocket, and revokes on account sign-out', async () => {
  const a = await enroll('alice'); const b = await enroll('bob'); await laptop(a, 'A');
  const owner = { cookie: cookie('alice'), origin: 'https://example.com' };
  expect((await call('example.com', '/api/connect/address', { serverId: a.serverId, label: 'alice-mac' }, owner)).status).toBe(200);
  expect((await call('example.com', '/api/connect/address?label=alice-mac', undefined, owner)).body.available).toBe(false);
  const host = 'alice-mac.example.com';
  const navigation = { accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-site' };
  const landing = await call(host, '/threads/123?view=full', undefined, navigation);
  expect(landing.status).toBe(303);
  expect((await call(host, '/api/v1/projects')).status).toBe(401);
  const login = await call(host, landing.headers.location, undefined, navigation);
  const stateCookie = login.headers['set-cookie'][0].split(';')[0];
  expect(login.headers['set-cookie'][0]).toContain('HttpOnly; SameSite=Lax; Max-Age=600; Secure');
  expect(login.headers['set-cookie'][0]).not.toContain('Domain');
  const code = new URL(login.headers.location).searchParams.get('browser');
  expect((await call('example.com', `/api/connect/browser/info?code=${code}`, undefined, owner)).body).toMatchObject({ name: 'Laptop', browserUrl: `https://${host}` });
  expect((await call('example.com', '/api/connect/browser/approve', { code }, { cookie: cookie('bob'), origin: 'https://example.com' })).status).toBe(403);
  const approved = await call('example.com', '/api/connect/browser/approve', { code }, owner);
  const callback = new URL(approved.body.location).pathname + new URL(approved.body.location).search;
  expect((await call(host, callback)).status).toBe(403);
  const completed = await call(host, callback, undefined, { ...navigation, cookie: stateCookie });
  expect(completed.status).toBe(303); expect(completed.headers.location).toBe('/threads/123?view=full');
  expect(completed.headers['set-cookie']).toHaveLength(2);
  const browserCookie = completed.headers['set-cookie'].find((value: string) => value.startsWith('zcc_connect_session=')).split(';')[0];
  expect((await call('alice-mac.connect.example.com', '/', undefined, { cookie: browserCookie })).status).toBe(404);
  expect((await call(`${a.host.split('.')[0]}.example.com`, '/', undefined, { cookie: browserCookie })).status).toBe(404);
  expect((await call(host, '/', undefined, { cookie: browserCookie, ...navigation })).body).toBe('A'.repeat(9000));
  expect((await call(host, '/api/v1/config', {}, { cookie: browserCookie, origin: `https://${host}` })).status).toBe(200);
  expect((await call(host, '/api/v1/config', {}, { cookie: browserCookie, origin: 'https://evil.test' })).status).toBe(403);
  expect((await call(a.host, '/', undefined, { cookie: browserCookie })).status).toBe(401);
  expect((await call(b.host, '/', undefined, { cookie: browserCookie })).status).toBe(401);
  expect((await call(host, callback, undefined, { cookie: stateCookie })).status).toBe(410);
  const ws = socket({ host }, '/ws', { cookie: browserCookie, origin: `https://${host}` }); await once(ws, 'open');
  const message = once(ws, 'message'); ws.send('browser'); expect((await message)[0].toString()).toBe('A:browser');
  const closed = once(ws, 'close'); await db.query('DELETE FROM sessions WHERE id=$1', ['alice']); expect((await closed)[0]).toBe(1008);
  expect((await call(host, '/', undefined, { cookie: browserCookie })).status).toBe(401);
});

it('routes the browser namespace without taking over the website or reserved service hosts', () => {
  for (const host of ['example.com', 'www.example.com', 'api.example.com', 'connect.example.com', 'docs.example.com', 'nested.name.example.com', 'alice.other.example']) {
    expect(gateway.matches({ headers: { host }, url: '/' })).toBe(false);
  }
  for (const host of ['alice-mac.example.com', 's-123456789012345678901234.connect.example.com']) {
    expect(gateway.matches({ headers: { host }, url: '/' })).toBe(true);
  }
  expect(gateway.matches({ headers: { host: 'example.com' }, url: '/api/connect/account' })).toBe(true);
});

it('shows an offline page only after browser authorization and refuses unknown Connect endpoints', async () => {
  const a = await enroll('alice');
  const owner = { cookie: cookie('alice'), origin: 'https://example.com' };
  const login = await call(a.host, '/_connect/login?returnTo=//evil.test');
  const code = new URL(login.headers.location).searchParams.get('browser');
  await call('example.com', '/api/connect/browser/approve', { code }, owner);
  const result = await call(a.host, `/_connect/callback?code=${code}`, undefined, { cookie: login.headers['set-cookie'][0].split(';')[0] });
  expect(result.headers.location).toBe('/');
  const cookieHeader = result.headers['set-cookie'][0].split(';')[0];
  const offline = await call(a.host, '/', undefined, { cookie: cookieHeader, accept: 'text/html' });
  expect(offline.status).toBe(503); expect(offline.body).toContain('Your computer is offline');
  expect(offline.body).toContain('Settings → Remote access');
  expect(offline.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect((await call(a.host, '/_connect/missing')).status).toBe(404);
  expect((await call('not.valid.connect.example.com', '/')).status).toBe(404);
});

it('holds a visitor while a recently seen computer redials, and fails at once for one long gone', async () => {
  const a = await enroll('alice'); const old = await laptop(a, 'old'); const p = await phone(a);
  const oldClosed = once(old, 'close'); old.close(); await oldClosed;
  const pending = call(a.host, '/', undefined, { cookie: p.cookie });
  const ws = socket(a, '/ws', { cookie: p.cookie }); const opened = once(ws, 'open');
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(ws.readyState).toBe(WebSocket.CONNECTING);
  const replacement = await laptop(a, 'new');
  expect((await pending).body).toBe('new'.repeat(9000));
  await opened; const message = once(ws, 'message'); ws.send('hi'); expect((await message)[0].toString()).toBe('new:hi');
  const closed = once(replacement, 'close'); replacement.close(); await closed;
  await db.query('UPDATE connect_servers SET last_seen_at=$1 WHERE id=$2', [Date.now() - 120_000, a.serverId]);
  const started = Date.now();
  expect((await call(a.host, '/', undefined, { cookie: p.cookie })).status).toBe(503);
  expect(Date.now() - started).toBeLessThan(1000);
});
it('gives up on a redialing computer once the reconnect grace runs out', async () => {
  await gateway.close();
  gateway = createConnectGateway({ db, registry, sessionSecret: secret, checkIntervalMs: 30, reconnectGraceMs: 250 });
  const a = await enroll('alice'); const old = await laptop(a, 'old'); const p = await phone(a);
  const closed = once(old, 'close'); old.close(); await closed;
  const started = Date.now();
  const offline = await call(a.host, '/', undefined, { cookie: p.cookie, accept: 'text/html' });
  expect(offline.status).toBe(503); expect(offline.body).toContain('Your computer is offline');
  expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  const ws = socket(a, '/ws', { cookie: p.cookie });
  const [, response] = await once(ws, 'unexpected-response');
  expect(response.statusCode).toBe(503);
});
it('keeps Connect session cookies off the tunnel and refuses the ones a computer sets', async () => {
  const a = await enroll('alice'); const p = await phone(a);
  const ws = socket(a, '/_relay/connect', { authorization: `Bearer ${a.credential}` });
  const hello = once(ws, 'message'); await once(ws, 'open'); await hello;
  const seen: any[] = [];
  ws.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'request') seen.push(frame.headers);
    if (frame.type === 'request-end') for (const value of [{ type: 'response', status: 200, headers: { 'content-type': 'text/plain', 'set-cookie': ['app=1; Domain=.example.com; Path=/', 'zcc_connect_session=forged; Path=/', 'zcc_mobile_session=forged'] } }, { type: 'response-end' }]) ws.send(JSON.stringify({ id: frame.id, ...value }));
  });
  const result = await call(a.host, '/', undefined, { cookie: `${p.cookie}; theme=dark; ${cookie('alice')}` });
  expect(result.status).toBe(200);
  expect(seen[0].cookie).toBe('theme=dark');
  expect(result.headers['set-cookie']).toEqual(['app=1; Path=/']);
});

async function previewLane(server: any, port = 5173, machineCredential?: string) {
  const ws = socket(server, '/_relay/previews', { authorization: `Bearer ${server.credential}`, 'x-zcc-preview-version': '1', ...(machineCredential ? { 'x-zcc-machine-credential': machineCredential } : {}) });
  const [hello] = await Promise.all([once(ws, 'message'), once(ws, 'open')]);
  expect(JSON.parse(hello[0].toString()).previewVersion).toBe(1);
  ws.send(JSON.stringify({ type: 'preview-targets', id: 0, targets: [{ port, expiresAt: Date.now() + 60_000 }] }));
  const requests: any[] = [];
  ws.on('message', raw => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'request') requests.push(frame);
    if (frame.type === 'request-end') {
      ws.send(JSON.stringify({ type: 'response', id: frame.id, status: 200, headers: { 'content-type': 'application/json', 'set-cookie': ['app=value; Domain=.example.com', 'zcc_session=evil'] } }));
      ws.send(JSON.stringify({ type: 'response-data', id: frame.id, data: Buffer.from(JSON.stringify(requests.at(-1))).toString('base64') }));
      ws.send(JSON.stringify({ type: 'response-end', id: frame.id }));
    }
  });
  return ws;
}
async function previewCookie(host: string) {
  const login = await call(host, '/_connect/login?returnTo=%2Fapp');
  expect(login.status).toBe(303);
  const code = new URL(login.headers.location).searchParams.get('browser');
  expect((await call('example.com', '/api/connect/browser/approve', { code }, { cookie: cookie('bob'), origin: 'https://example.com' })).status).toBe(403);
  const approval = await call('example.com', '/api/connect/browser/approve', { code }, { cookie: cookie('alice'), origin: 'https://example.com' });
  const callback = new URL(approval.body.location);
  const redeemed = await call(host, callback.pathname + callback.search, undefined, { cookie: login.headers['set-cookie'][0].split(';')[0] });
  expect(redeemed.status).toBe(303);
  return redeemed.headers['set-cookie'][0].split(';')[0];
}
it('isolates preview origins, authenticates their owner and strips credentials before forwarding', async () => {
  const a = await enroll('alice'); await laptop(a, 'A'); await registry.claimAddress('alice', a.serverId, 'alice-mac');
  const lane = await previewLane(a); const host = 'alice-mac--5173.example.com';
  await expect.poll(async () => (await call(host, '/')).status).toBe(401);
  expect(gateway.matches({ headers: { host }, url: '/' })).toBe(true);
  const auth = await previewCookie(host);
  const result = await call(host, '/app', undefined, { cookie: `${auth}; app=hello`, authorization: 'Bearer secret', 'x-zcc-host-id': 'forged' });
  expect(result.status).toBe(200); expect(result.body.target).toBe(5173); expect(result.body.headers.cookie).toBe('app=hello');
  expect(JSON.stringify(result.body)).not.toMatch(/secret|forged|zcc_connect_session/);
  expect(result.headers['set-cookie']).toEqual(['app=value']);
  expect((await call('alice-mac.example.com', '/', undefined, { cookie: auth })).status).toBe(401);
  expect((await call('alice-mac--5174.example.com', '/', undefined, { cookie: auth })).status).toBe(404);
  expect((await call(host, '/api/v1/hosts', undefined, { 'x-zcc-machine-credential': 'forged' })).status).toBe(403);
  expect((await call(host, '/internal/hosts', undefined, { cookie: auth })).status).toBe(404);
  lane.send(JSON.stringify({ type: 'preview-targets', id: 0, targets: [] }));
  await expect.poll(async () => (await call(host, '/', undefined, { cookie: auth })).status).toBe(404);
});
it('keeps two execution-machine previews on the same port separate and revokes just one machine', async () => {
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { machinePreviewKey } = await import('../relay/mobile/preview-policy.mjs');
  const a = await enroll('alice'); await laptop(a, 'A'); await registry.claimAddress('alice', a.serverId, 'alice-mac');
  const principal = await registry.authenticateServer(a.credential); const instanceId = randomUUID();
  const machines = [];
  for (let i = 0; i < 2; i++) {
    const hostId = randomUUID(); const issued = await registry.createMachineCode(principal, { hostId, instanceId, name: `Machine ${i}`, enrollToken: `zcde_${randomBytes(18).toString('base64url')}` });
    const joined = await registry.redeemMachineCode(issued.code, randomBytes(32).toString('base64url'));
    const lane = await previewLane(a, 5173, joined.credential); const host = `alice-mac--${machinePreviewKey(hostId)}--5173.example.com`;
    await expect.poll(async () => (await call(host, '/')).status).toBe(401);
    machines.push({ host, hostId, lane, auth: await previewCookie(host) });
  }
  for (const machine of machines) expect((await call(machine.host, '/', undefined, { cookie: machine.auth })).status).toBe(200);
  expect((await call(machines[0].host, '/', undefined, { cookie: machines[1].auth })).status).toBe(401);
  const closed = once(machines[0].lane, 'close'); await registry.revokeMachine(principal, machines[0].hostId); await closed;
  expect((await call(machines[0].host, '/', undefined, { cookie: machines[0].auth })).status).toBe(503);
  expect((await call(machines[1].host, '/', undefined, { cookie: machines[1].auth })).status).toBe(200);
});
it('fails closed for incompatible preview versions and unauthorized preview publishers', async () => {
  const a = await enroll('alice'); const b = await enroll('bob'); await laptop(a, 'A');
  for (const [headers, status] of [[{ authorization: `Bearer ${a.credential}` }, 409], [{ authorization: `Bearer ${b.credential}`, 'x-zcc-preview-version': '1' }, 401]] as const) {
    const ws = socket(a, '/_relay/previews', headers); expect((await once(ws, 'unexpected-response'))[1].statusCode).toBe(status); ws.terminate();
  }
});

it('releases disconnected preview capacity while the parent computer stays online', async () => {
  const { randomUUID, randomBytes } = await import('node:crypto');
  await gateway.close();
  gateway = createConnectGateway({ db, registry, sessionSecret: secret, checkIntervalMs: 30, maxTunnels: 1 });
  const a = await enroll('alice'); await laptop(a, 'A');
  const principal = await registry.authenticateServer(a.credential);
  const issued = await registry.createMachineCode(principal, { hostId: randomUUID(), instanceId: randomUUID(), name: 'Remote', enrollToken: `zcde_${randomBytes(18).toString('base64url')}` });
  const joined = await registry.redeemMachineCode(issued.code, randomBytes(32).toString('base64url'));
  const first = await previewLane(a);
  const closed = once(first, 'close'); first.close(); await closed;
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 16_000);
  try {
    await expect.poll(async () => {
      try { await previewLane(a, 5173, joined.credential); return true; }
      catch { return false; }
    }).toBe(true);
    expect(gateway.connectionCount()).toBe(1);
  } finally { clock.mockRestore(); }
});

it('does not discard a replacement preview while an older authorization check is in flight', async () => {
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { machinePreviewKey } = await import('../relay/mobile/preview-policy.mjs');
  const a = await enroll('alice'); await laptop(a, 'A');
  await registry.claimAddress('alice', a.serverId, 'alice-mac');
  const principal = await registry.authenticateServer(a.credential); const hostId = randomUUID();
  const issued = await registry.createMachineCode(principal, { hostId, instanceId: randomUUID(), name: 'Remote', enrollToken: `zcde_${randomBytes(18).toString('base64url')}` });
  const joined = await registry.redeemMachineCode(issued.code, randomBytes(32).toString('base64url'));
  await previewLane(a, 5173, joined.credential);
  let entered!: () => void, release!: (value: boolean) => void;
  const checking = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<boolean>(resolve => { release = resolve; });
  const authorize = vi.spyOn(registry, 'authorizeMachineGrant').mockImplementationOnce(() => { entered(); return pending; });
  try {
    await checking;
    const replacement = await previewLane(a, 5173, joined.credential);
    release(false);
    await expect.poll(() => authorize.mock.calls.length).toBeGreaterThan(1);
    expect(replacement.readyState).toBe(WebSocket.OPEN);
    const host = `alice-mac--${machinePreviewKey(hostId)}--5173.example.com`;
    expect((await call(host, '/')).status).toBe(401);
  } finally { release(false); authorize.mockRestore(); }
});
