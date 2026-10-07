import { protectPreviewServer } from '../../../../services/mobile-relay/protected-ports.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
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
import { MobileReadiness } from './readiness.js';
import { isMachinePath, machineIdentity, MACHINE_HOST_HEADER, MACHINE_INSTANCE_HEADER } from '../../../../services/mobile-relay/machine-routes.mjs';

const COOKIE = 'zcc_mobile_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const PAIR_MS = 5 * 60 * 1000;
const MAX_BODY = 32 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;

export interface MobileGatewayOptions {
  upstream: string;
  /** Exact URL the phone uses. HTTPS through the relay; loopback HTTP is reserved for internal tests. */
  publicUrl: string;
  host?: string;
  port?: number;
  devices?: MobileDeviceStore;
  now?: () => number;
  /** Ephemeral local capability supplied only by the authenticated Connect tunnel. */
  connectGatewayCredential?: string;
  connectInstanceId?: string;
  /** Main-owned signer, invoked only after phone session and origin authorization. */
  signQueuedSend?: (threadId: string, itemId: string) => string;
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
  // Only route separators affect dispatch. Encoded slashes in query values
  // (e.g. a library relPath) remain data, authorized by the product endpoint.
  const route = path.split(/[?#]/, 1)[0];
  if (route.includes('\\') || /%2f|%5c|%00/i.test(route)) return false;
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
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Mobile gateway must bind to loopback; use Zana Connect for phone access.');
  const upstream = origin(options.upstream);
  if (
    upstream.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(upstream.hostname)
  ) {
    throw new Error('Mobile upstream must be a loopback HTTP origin');
  }
  const publicUrl = origin(options.publicUrl);
  if (options.connectGatewayCredential && (!/^[\w-]{43}$/.test(options.connectGatewayCredential) || options.host !== '127.0.0.1')) {
    throw new Error('Connect gateway must be loopback-only with a valid local capability');
  }
  const devices = options.devices ?? new MobileDeviceStore();
  const now = options.now ?? Date.now;
  const push = createMobilePushRelay(upstream, publicUrl.origin, devices);
  let pairing: { hash: string; expiresAt: number } | null = null;
  const sessions = new Map<string, { deviceId: string; expiresAt: number }>();
  const sockets = new Map<WebSocket, string>();
  const readiness = new MobileReadiness(now);
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
    if (options.connectGatewayCredential) {
      const value = req.headers['x-zcc-connect-gateway'];
      if (req.socket.remoteAddress === '127.0.0.1' && typeof value === 'string' &&
          value.length === options.connectGatewayCredential.length &&
          timingSafeEqual(Buffer.from(value), Buffer.from(options.connectGatewayCredential))) return 'connect';
      return null;
    }
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
  function authenticatedMachine(req: IncomingMessage): { hostId: string; instanceId: string } | null {
    if (!options.connectGatewayCredential || sessionDevice(req) !== 'connect') return null;
    const machine = machineIdentity(req.headers);
    return machine && machine.instanceId === options.connectInstanceId ? machine : null;
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
      const authenticatedDevice = sessionDevice(req);
      if (!authenticatedDevice) return json(res, 401, { error: 'Pair this device with Zana' });
      // Connect authenticates the phone cookie at its edge; this loopback
      // capability has already passed the exact-host and tunnel checks above.
      if (url.pathname === '/_zcc/mobile-ready' && req.method === 'POST') {
        const label = authenticatedDevice === 'connect' ? 'Phone via Connect' :
          devices.list().find(device => device.id === authenticatedDevice)?.label ?? 'Phone';
        const accepted = readiness.record(authenticatedDevice, label, await body(req));
        return json(res, accepted ? 200 : 400, { ready: accepted });
      }
      const machine = authenticatedMachine(req);
      if ((req.headers[MACHINE_HOST_HEADER] || req.headers[MACHINE_INSTANCE_HEADER]) && !machine) return json(res, 403, { error: 'Invalid machine identity' });
      if (machine ? !isMachinePath(req.method, req.url) : !isMobileProxyPath(req.url ?? '/')) return json(res, 404, { error: 'Not found' });
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? 'GET'))
        return json(res, 405, { error: 'Method not allowed' });
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY)
        return json(res, 413, { error: 'Body too large' });
      const queuedSend = req.method === 'POST' && !machine
        ? url.pathname.match(/^\/api\/v1\/threads\/([a-zA-Z0-9_-]{1,128})\/next-turn\/([a-zA-Z0-9_-]{1,128})\/send$/)
        : null;
      let confirmedSendBody: string | undefined;
      if (queuedSend) {
        const input = await body(req);
        if (input.confirmed !== true || !Number.isSafeInteger(input.expectedUpdatedAt) || Number(input.expectedUpdatedAt) < 0) {
          return json(res, 400, { error: 'Confirm the selected queued message before sending' });
        }
        if (!options.signQueuedSend) return json(res, 503, { error: 'Queued send approval is unavailable' });
        confirmedSendBody = JSON.stringify({ confirmed: true, expectedUpdatedAt: input.expectedUpdatedAt });
      }
      // Build a small header allowlist. In particular, never forward caller
      // Authorization, Cookie, proxy credentials, or X-Forwarded-* to the host.
      const headers: Record<string, string> = {
        host: upstream.host,
        origin: upstream.origin,
        'x-zcc-app-surface': 'mobile'
      };
      if (machine) {
        delete headers.origin;
        delete headers['x-zcc-app-surface'];
        headers['x-zcc-host-id'] = machine.hostId;
        headers[MACHINE_HOST_HEADER] = machine.hostId;
        headers[MACHINE_INSTANCE_HEADER] = machine.instanceId;
        if (typeof req.headers.authorization === 'string') headers.authorization = req.headers.authorization;
      }
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
      if (queuedSend && confirmedSendBody !== undefined) {
        // Caller-supplied proof/surface headers never pass the allowlist. Only
        // this authenticated phone edge may mint a mobile approval.
        headers['x-zcc-ui-send-proof'] = options.signQueuedSend!(queuedSend[1]!, queuedSend[2]!);
        headers['x-zcc-ui-send-surface'] = 'mobile';
        headers['content-length'] = String(Buffer.byteLength(confirmedSendBody));
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
      if (confirmedSendBody !== undefined) proxy.end(confirmedSendBody);
      else req.pipe(cap).pipe(proxy);
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
    const machine = authenticatedMachine(req);
    if (
      !requestAllowed(req) ||
      ((req.headers[MACHINE_HOST_HEADER] || req.headers[MACHINE_INSTANCE_HEADER]) && !machine) ||
      !id ||
      (machine ? !isMachinePath('GET', req.url, true) : !['/ws', '/ws/'].includes(req.url ?? '')) ||
      sockets.size >= 40
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      sockets.set(client, id);
      const target = new URL(machine ? req.url! : '/ws', upstream);
      target.protocol = 'ws:';
      const remote = new WebSocket(target, {
        ...(machine ? { headers: {
          'x-zcc-host-id': machine.hostId,
          [MACHINE_HOST_HEADER]: machine.hostId,
          [MACHINE_INSTANCE_HEADER]: machine.instanceId,
          ...(typeof req.headers.authorization === 'string' ? { authorization: req.headers.authorization } : {})
        } } : { origin: upstream.origin }),
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
    // Connect owns session expiry/revocation and closes the tunnel's visitor
    // sockets. Its loopback capability is not a locally paired device.
    if (options.connectGatewayCredential) live.add('connect');
    for (const [socket, id] of sockets) if (!live.has(id)) socket.close(1008, 'Session expired');
  }, 30_000);
  sweep.unref();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      protectPreviewServer(server);
    server.listen(options.port ?? 8785, host, () => {
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
    readySessions: () => readiness.list(id => id === 'connect' ? !!options.connectGatewayCredential :
      [...sessions.values()].some(session => session.deviceId === id && session.expiresAt > now()) &&
      devices.list().some(device => device.id === id)),
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
