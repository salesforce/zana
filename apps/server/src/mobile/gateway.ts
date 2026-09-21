import { randomBytes } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { Transform } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { createMobilePushRelay } from './push.js';
import { digest, MobileDeviceStore } from './device-store.js';

const COOKIE = 'zcc_mobile_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const PAIR_MS = 5 * 60 * 1000;
const MAX_BODY = 32 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;

export interface MobileGatewayOptions {
  upstream: string;
  /** Exact URL the phone uses. HTTPS in production; HTTP only on a private network. */
  publicUrl: string;
  host?: string;
  port?: number;
  devices?: MobileDeviceStore;
  now?: () => number;
}

function origin(raw: string): URL {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Use an HTTP(S) server origin without a path or credentials');
  }
  return url;
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new Error('Expected JSON');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 4096) throw new Error('Body too large');
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Expected object');
  return parsed as Record<string, unknown>;
}
function bounded(limit: number) {
  let size = 0;
  return new Transform({
    transform(chunk, _encoding, cb) {
      size += chunk.length;
      cb(size > limit ? new Error('Transfer too large') : null, chunk);
    }
  });
}
/** Only product and renderer routes. Host enrollment, MCP and owner controls never cross this gateway. */
export function isMobileProxyPath(path: string): boolean {
  if (path.includes('\\') || /%2f|%5c|%00/i.test(path)) return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(path, 'http://localhost').pathname);
  } catch {
    return false;
  }
  if (/^\/(internal|mcp|install|_mobile)(\/|$|\.)/.test(pathname)) return false;
  if (pathname.startsWith('/api/')) return pathname.startsWith('/api/v1/');
  if (pathname.startsWith('/_'))
    return pathname === '/_zcc/bootstrap' || pathname === '/_zcc/health';
  return true;
}

/** Opt-in, authenticated edge in front of the unchanged loopback product server. */
export async function startMobileGateway(options: MobileGatewayOptions) {
  const upstream = origin(options.upstream);
  if (
    upstream.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname)
  ) {
    throw new Error('Mobile upstream must be a loopback HTTP origin');
  }
  const publicUrl = origin(options.publicUrl);
  const devices = options.devices ?? new MobileDeviceStore();
  const now = options.now ?? Date.now;
  const push = createMobilePushRelay(upstream, publicUrl.origin, devices);
  let pairing: { hash: string; expiresAt: number } | null = null;
  const sessions = new Map<string, { deviceId: string; expiresAt: number }>();
  const sockets = new Map<WebSocket, string>();
  let attempts = 0;
  let resetAt = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  function requestAllowed(req: IncomingMessage) {
    return (
      req.headers.host === publicUrl.host &&
      (!req.headers.origin || req.headers.origin === publicUrl.origin) &&
      (!req.headers['sec-fetch-site'] ||
        ['same-origin', 'none'].includes(String(req.headers['sec-fetch-site'])))
    );
  }
  function sessionDevice(req: IncomingMessage): string | null {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (!cookie || cookie.length > 100) return null;
    const session = sessions.get(digest(cookie));
    if (
      !session ||
      session.expiresAt <= now() ||
      !devices.list().some((d) => d.id === session.deviceId)
    )
      return null;
    return session.deviceId;
  }
  function rateAllowed() {
    if (now() >= resetAt) {
      attempts = 0;
      resetAt = now() + 60_000;
    }
    return ++attempts <= 30;
  }
  const server = createServer(async (req, res) => {
    try {
      if (!requestAllowed(req)) return json(res, 403, { error: 'Untrusted origin' });
      const url = new URL(req.url ?? '/', publicUrl);
      if (url.pathname === '/_mobile/health' && req.method === 'GET')
        return json(res, 200, { product: 'zcc', mobileGateway: 1 });
      if (url.pathname === '/_mobile/pair' && req.method === 'POST') {
        if (!rateAllowed())
          return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        const input = await body(req);
        if (
          typeof input.code !== 'string' ||
          input.code.length > 100 ||
          !pairing ||
          pairing.expiresAt <= now() ||
          pairing.hash !== digest(input.code)
        ) {
          return json(res, 401, { error: 'Pairing code is invalid or expired' });
        }
        const result = devices.add(typeof input.label === 'string' ? input.label : 'Phone');
        pairing = null;
        return json(res, 200, result);
      }
      if (url.pathname === '/_mobile/session' && req.method === 'POST') {
        if (!rateAllowed())
          return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        const credential = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
        const deviceId = devices.authorize(credential);
        if (!deviceId) return json(res, 401, { error: 'This device needs to be paired again' });
        for (const [hash, session] of sessions)
          if (session.deviceId === deviceId || session.expiresAt <= now()) sessions.delete(hash);
        const value = randomBytes(32).toString('base64url');
        const expiresAt = now() + SESSION_MS;
        sessions.set(digest(value), { deviceId, expiresAt });
        res.setHeader(
          'Set-Cookie',
          `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${publicUrl.protocol === 'https:' ? '; Secure' : ''}`
        );
        return json(res, 200, {
          cookie: {
            name: COOKIE,
            value,
            expires: new Date(expiresAt).toISOString(),
            secure: publicUrl.protocol === 'https:',
            httpOnly: true,
            path: '/'
          },
          expiresAt
        });
      }
      if (url.pathname === '/_mobile/push' && ['PUT', 'DELETE'].includes(req.method ?? '')) {
        const deviceId = devices.authorize(
          req.headers.authorization?.replace(/^Bearer /, '') ?? ''
        );
        if (!deviceId) return json(res, 401, { error: 'Pair this device first' });
        const input = req.method === 'PUT' ? await body(req) : null;
        if (input && typeof input.token !== 'string')
          return json(res, 400, { error: 'Invalid token' });
        devices.setPushToken(deviceId, input ? (input.token as string) : null);
        push.refresh();
        return json(res, 200, { enabled: !!input });
      }
      if (!sessionDevice(req)) return json(res, 401, { error: 'Pair this device with Zana' });
      if (!isMobileProxyPath(req.url ?? '/')) return json(res, 404, { error: 'Not found' });
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET'))
        return json(res, 405, { error: 'Method not allowed' });
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY)
        return json(res, 413, { error: 'Body too large' });
      // Build a small header allowlist. In particular, never forward caller
      // Authorization, Cookie, proxy credentials, or X-Forwarded-* to the host.
      const headers: Record<string, string> = {
        host: upstream.host,
        origin: upstream.origin,
        'x-zcc-app-surface': 'mobile'
      };
      for (const key of [
        'content-type',
        'content-length',
        'accept',
        'range',
        'if-none-match',
        'if-modified-since'
      ]) {
        const value = req.headers[key];
        if (typeof value === 'string') headers[key] = value;
      }
      const proxy = httpRequest(
        new URL(url.pathname + url.search, upstream),
        { method: req.method, headers, timeout: 120_000 },
        (response) => {
          const outgoing = { ...response.headers };
          for (const key of [
            'set-cookie',
            'access-control-allow-origin',
            'access-control-allow-credentials',
            'connection',
            'transfer-encoding'
          ])
            delete outgoing[key];
          outgoing['cache-control'] = 'no-store';
          outgoing['referrer-policy'] = 'no-referrer';
          if (outgoing.location) {
            const location = URL.canParse(outgoing.location, upstream)
              ? new URL(outgoing.location, upstream)
              : null;
            if (!location || location.origin !== upstream.origin) {
              response.destroy();
              return json(res, 502, { error: 'Upstream redirect refused' });
            }
            outgoing.location = location.pathname + location.search + location.hash;
          }
          res.writeHead(response.statusCode ?? 502, outgoing);
          const cap = bounded(MAX_RESPONSE);
          cap.on('error', () => {
            response.destroy();
            res.destroy();
          });
          response
            .on('error', () => res.destroy())
            .pipe(cap)
            .pipe(res);
        }
      );
      proxy.on('timeout', () => proxy.destroy(new Error('Upstream timeout')));
      proxy.on('error', () => {
        if (!res.headersSent)
          json(res, 502, { error: 'Zana is unavailable. Start the desktop app and retry.' });
        else res.destroy();
      });
      const cap = bounded(MAX_BODY);
      cap.on('error', () => {
        proxy.destroy();
        res.destroy();
      });
      req.on('aborted', () => proxy.destroy());
      res.on('close', () => proxy.destroy());
      req.pipe(cap).pipe(proxy);
    } catch {
      if (!res.headersSent)
        json(res, 400, { error: 'Invalid request or device store unavailable' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxConnections = 100;
  server.on('upgrade', (req, socket, head) => {
    const id = sessionDevice(req);
    if (
      !requestAllowed(req) ||
      !id ||
      !['/ws', '/ws/'].includes(req.url ?? '') ||
      sockets.size >= 40
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      sockets.set(client, id);
      const target = new URL('/ws', upstream);
      target.protocol = 'ws:';
      const remote = new WebSocket(target, {
        origin: upstream.origin,
        handshakeTimeout: 10_000,
        maxPayload: 1024 * 1024
      });
      const pending: Array<{ data: Buffer; binary: boolean }> = [];
      let pendingBytes = 0;
      const send = (to: WebSocket, data: WebSocket.RawData, binary: boolean) => {
        if (to.bufferedAmount > 2 * 1024 * 1024) {
          client.close(1013);
          remote.close();
          return;
        }
        if (to.readyState === WebSocket.OPEN) to.send(data, { binary });
      };
      client.on('message', (data, binary) => {
        if (remote.readyState === WebSocket.CONNECTING) {
          const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          pendingBytes += bytes.length;
          if (pendingBytes > 64 * 1024) {
            client.close(1009);
            remote.close();
          } else pending.push({ data: bytes, binary });
        } else send(remote, data, binary);
      });
      remote.on('open', () => {
        for (const frame of pending) send(remote, frame.data, frame.binary);
        pending.length = 0;
      });
      remote.on('message', (data, binary) => send(client, data, binary));
      client.on('close', () => {
        sockets.delete(client);
        remote.close();
      });
      remote.on('close', () => client.close());
      client.on('error', () => remote.close());
      remote.on('error', () => client.close(1011));
    });
  });
  const sweep = setInterval(() => {
    const activeDevices = new Set(devices.list().map((device) => device.id));
    for (const [hash, session] of sessions)
      if (session.expiresAt <= now() || !activeDevices.has(session.deviceId)) sessions.delete(hash);
    const live = new Set([...sessions.values()].map((s) => s.deviceId));
    for (const [socket, id] of sockets) if (!live.has(id)) socket.close(1008, 'Session expired');
  }, 30_000);
  sweep.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 8785, options.host ?? '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    clearInterval(sweep);
    wss.close();
    throw error;
  }
  push.refresh();
  return {
    port: (server.address() as { port: number }).port,
    pair() {
      const code = randomBytes(16).toString('base64url');
      const expiresAt = now() + PAIR_MS;
      pairing = { hash: digest(code), expiresAt };
      return { version: 1, serverUrl: publicUrl.origin, code, expiresAt };
    },
    devices: () => devices.list(),
    revoke(id: string) {
      const result = devices.revoke(id);
      push.refresh();
      for (const [hash, session] of sessions) if (session.deviceId === id) sessions.delete(hash);
      for (const [socket, deviceId] of sockets)
        if (deviceId === id) socket.close(1008, 'Device revoked');
      return result;
    },
    close: async () => {
      clearInterval(sweep);
      push.close();
      for (const socket of sockets.keys()) socket.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };
}
