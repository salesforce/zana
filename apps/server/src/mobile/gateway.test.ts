import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { startMobileGateway, isMobileProxyPath } from './gateway.js';
import { MobileDeviceStore, DEVICE_LIFETIME_MS } from './device-store.js';
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(https = false) {
  let now = Date.now();
  const requests: Array<{ url?: string; headers: IncomingMessage['headers']; body: string }> = [];
  const upstream = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body });
    if (req.url === '/redirect' || req.url === '/bad-redirect') {
      res.writeHead(302, {
        location: req.url === '/redirect' ? 'https://other.example/' : 'http://['
      });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'host-secret=hidden' });
    res.end(JSON.stringify({ ok: true, size: body.length }));
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket) =>
    socket.on('message', (data, binary) => socket.send(data, { binary }))
  );
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  cleanup.push(() => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    upstream.closeAllConnections();
    return new Promise<void>((r) => upstream.close(() => r()));
  });
  const gateway = await startMobileGateway({
    upstream: `http://127.0.0.1:${port}`,
    publicUrl: `${https ? 'https' : 'http'}://phone.local`,
    port: 0,
    now: () => now
  });
  cleanup.push(gateway.close);
  function call(
    path: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ) {
    return new Promise<{ status: number; json: any; headers: IncomingMessage['headers'] }>(
      (resolve, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port: gateway.port,
            path,
            method: opts.method ?? 'GET',
            headers: { host: 'phone.local', ...opts.headers }
          },
          async (res) => {
            let text = '';
            for await (const chunk of res) text += chunk;
            resolve({
              status: res.statusCode!,
              json: text ? JSON.parse(text) : null,
              headers: res.headers
            });
          }
        );
        req.on('error', reject);
        req.end(opts.body);
      }
    );
  }
  async function pair() {
    const payload = gateway.pair();
    return call('/_mobile/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: payload.code, label: 'Phone' })
    });
  }
  async function session(credential: string) {
    const response = await call('/_mobile/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` }
    });
    return { ...response, cookie: response.headers['set-cookie']?.[0]?.split(';')[0] ?? '' };
  }
  return {
    gateway,
    call,
    pair,
    session,
    requests,
    advance: (ms: number) => {
      now += ms;
    }
  };
}
describe('mobile gateway', () => {
  it('pairs once, persists only a credential hash, and scopes a secure session', async () => {
    const f = await setup(true);
    expect((await f.call('/_mobile/health')).json).toEqual({ product: 'zcc', mobileGateway: 1 });
    expect((await f.call('/api/v1/projects')).status).toBe(401);
    const payload = f.gateway.pair();
    const args = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: payload.code })
    };
    const paired = await f.call('/_mobile/pair', args);
    expect(paired.status).toBe(200);
    expect((await f.call('/_mobile/pair', args)).status).toBe(401);
    expect(JSON.stringify(f.gateway.devices())).not.toContain(paired.json.credential);
    const session = await f.session(paired.json.credential);
    expect(session.headers['set-cookie']?.[0]).toContain('HttpOnly; SameSite=Strict');
    expect(session.headers['set-cookie']?.[0]).toContain('; Secure');
    const result = await f.call('/api/v1/projects', { headers: { cookie: session.cookie } });
    expect(result.status).toBe(200);
    expect(result.headers['set-cookie']).toBeUndefined();
    f.gateway.revoke(paired.json.deviceId);
    expect((await f.call('/', { headers: { cookie: session.cookie } })).status).toBe(401);
    expect((await f.session(paired.json.credential)).status).toBe(401);
  });
  it('rejects forged origins, cross-site browser requests and untrusted hosts', async () => {
    const f = await setup();
    for (const headers of [
      { origin: 'https://evil.example' },
      { host: 'evil.example' },
      { 'sec-fetch-site': 'cross-site' }
    ])
      expect((await f.call('/_mobile/health', { headers })).status).toBe(403);
    expect(
      (
        await f.call('/_mobile/health', {
          headers: { origin: 'http://phone.local', 'sec-fetch-site': 'same-origin' }
        })
      ).status
    ).toBe(200);
  });
  it('expires pairing and browser sessions, rotates cookies and rate-limits attempts', async () => {
    const f = await setup();
    const payload = f.gateway.pair();
    f.advance(300_001);
    expect(
      (
        await f.call('/_mobile/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: payload.code })
        })
      ).status
    ).toBe(401);
    const pair = await f.pair();
    const old = await f.session(pair.json.credential);
    const fresh = await f.session(pair.json.credential);
    expect((await f.call('/', { headers: { cookie: old.cookie } })).status).toBe(401);
    expect((await f.call('/', { headers: { cookie: fresh.cookie } })).status).toBe(200);
    f.advance(12 * 60 * 60_000 + 1);
    expect((await f.call('/', { headers: { cookie: fresh.cookie } })).status).toBe(401);
    for (let n = 0; n < 30; n++) await f.session('wrong');
    expect((await f.session('wrong')).status).toBe(429);
    f.advance(60_001);
    expect((await f.session('wrong')).status).toBe(401);
  });
  it('proxies full payloads while stripping host credentials and refusing internal routes', async () => {
    const f = await setup();
    const pair = await f.pair();
    const session = await f.session(pair.json.credential);
    const body = JSON.stringify({ text: 'x'.repeat(26_000) });
    expect(
      (
        await f.call('/api/v1/threads', {
          method: 'POST',
          body,
          headers: {
            cookie: session.cookie,
            authorization: 'secret',
            'x-forwarded-host': 'evil',
            'content-type': 'application/json'
          }
        })
      ).json.size
    ).toBe(body.length);
    const sent = f.requests.at(-1)!;
    expect(sent.body).toBe(body);
    expect(sent.headers.cookie).toBeUndefined();
    expect(sent.headers.authorization).toBeUndefined();
    expect(sent.headers['x-forwarded-host']).toBeUndefined();
    expect(sent.headers['x-zcc-app-surface']).toBe('mobile');
    for (const path of [
      '/internal/hosts',
      '/mcp',
      '/install',
      '/_mobile/private',
      '/api/v2/private',
      '/_private',
      '/api/v1/../../internal/hosts'
    ])
      expect((await f.call(path, { headers: { cookie: session.cookie } })).status).toBe(404);
    expect((await f.call('/redirect', { headers: { cookie: session.cookie } })).status).toBe(502);
    expect((await f.call('/bad-redirect', { headers: { cookie: session.cookie } })).status).toBe(
      502
    );
    expect(
      (await f.call('/', { method: 'OPTIONS', headers: { cookie: session.cookie } })).status
    ).toBe(405);
  });
  it('rejects malformed pairing bodies and missing credentials', async () => {
    const f = await setup();
    for (const value of ['[]', 'null', '{', JSON.stringify({ code: 'x'.repeat(5000) })])
      expect(
        (
          await f.call('/_mobile/pair', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: value
          })
        ).status
      ).toBe(400);
    expect((await f.call('/_mobile/pair', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await f.session('')).status).toBe(401);
  });
  it('authenticates WebSockets and disconnects them on revocation', async () => {
    const f = await setup();
    const pair = await f.pair();
    const session = await f.session(pair.json.credential);
    const socket = new WebSocket(`ws://127.0.0.1:${f.gateway.port}/ws`, {
      headers: { host: 'phone.local', cookie: session.cookie },
      origin: 'http://phone.local'
    });
    cleanup.push(() => socket.terminate());
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send('live thread event');
    expect((await reply)[0].toString()).toBe('live thread event');
    const closed = once(socket, 'close');
    f.gateway.revoke(pair.json.deviceId);
    expect((await closed)[0]).toBe(1008);
    const denied = new WebSocket(`ws://127.0.0.1:${f.gateway.port}/internal/hosts`, {
      headers: { host: 'phone.local' }
    });
    cleanup.push(() => denied.terminate());
    expect((await once(denied, 'error'))[0].message).toContain('403');
  });
  it('requires device credentials for push registration and accepts removal', async () => {
    const f = await setup();
    expect(
      (
        await f.call('/_mobile/push', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: '{"token":"bad"}'
        })
      ).status
    ).toBe(401);
    const pair = await f.pair();
    const headers = {
      authorization: `Bearer ${pair.json.credential}`,
      'content-type': 'application/json'
    };
    expect((await f.call('/_mobile/push', { method: 'PUT', headers, body: '{}' })).status).toBe(
      400
    );
    expect(
      (await f.call('/_mobile/push', { method: 'PUT', headers, body: '{"token":"bad"}' })).status
    ).toBe(400);
    expect(
      (
        await f.call('/_mobile/push', {
          method: 'PUT',
          headers,
          body: '{"token":"ExpoPushToken[test]"}'
        })
      ).json
    ).toEqual({ enabled: true });
    expect((await f.call('/_mobile/push', { method: 'DELETE', headers })).json).toEqual({
      enabled: false
    });
  });
  it('validates upstream and public origins', async () => {
    for (const upstream of [
      'https://public.example',
      'http://public.example',
      'http://u:p@localhost/',
      'http://localhost/path'
    ])
      await expect(
        startMobileGateway({ upstream, publicUrl: 'http://phone.local', port: 0 })
      ).rejects.toThrow();
    await expect(
      startMobileGateway({ upstream: 'http://localhost', publicUrl: 'file:///tmp', port: 0 })
    ).rejects.toThrow();
    for (const path of [
      '/internal/hosts',
      '/%69nternal/hosts',
      '/install.sh',
      '/%zz',
      '/api/v2/test',
      '/_secret',
      '/api/v1%2fsecret',
      '/a\\b'
    ])
      expect(isMobileProxyPath(path)).toBe(false);
    for (const path of [
      '/',
      '/threads/t1',
      '/plugins/a/assets/app.js',
      '/api/v1/threads',
      '/_zcc/bootstrap',
      '/_zcc/health'
    ])
      expect(isMobileProxyPath(path)).toBe(true);
  });
});

describe('mobile device persistence', () => {
  it('atomically persists hashed credentials, bounds devices and removes expired entries', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zcc-mobile-'));
    cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'private', 'devices.json');
    let now = Date.now();
    const store = new MobileDeviceStore(file, () => now);
    const device = store.add(' My phone ');
    expect(store.authorize(device.credential)).toBe(device.deviceId);
    expect(store.authorize('x')).toBe(null);
    expect(readFileSync(file, 'utf8')).not.toContain(device.credential);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(new MobileDeviceStore(file).list()[0]?.label).toBe('My phone');
    for (let i = 1; i < 20; i++) store.add('');
    expect(() => store.add('extra')).toThrow('Device limit');
    expect(store.revoke('unknown')).toBe(false);
    expect(store.revoke(device.deviceId)).toBe(true);
    now += DEVICE_LIFETIME_MS + 1;
    expect(store.list()).toEqual([]);
    expect(store.authorize(device.credential)).toBe(null);
    expect(store.add('new')).toBeTruthy();
    writeFileSync(file, '{}');
    expect(() => new MobileDeviceStore(file)).toThrow('Invalid');
    writeFileSync(file, 'x'.repeat(33_000));
    expect(() => new MobileDeviceStore(file)).toThrow('too large');
  });
});
