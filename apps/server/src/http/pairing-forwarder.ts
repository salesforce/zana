import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse
} from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  PAIRING_ALLOWLIST,
  PEER_LINK_ALLOWLIST,
  isAllowedHttp,
  isAllowedWs,
  resolvePairingTarget
} from './pairing-allowlist.js';
import { headerPairsToRecord, isStrippedPairingHeader, loopbackHostHeader } from './pairing-headers.js';

/**
 * Loopback listener an SSH reverse tunnel points at instead of the product
 * port. It forwards only the pairing allowlist (installer, enrollment, the
 * enrolled daemon's callbacks and `/internal/hosts/ws`) and refuses everything
 * else, so a remote machine never reaches the full loopback product API.
 */
export interface PairingForwarder {
  readonly port: number;
  close(): Promise<void>;
}

export interface PairingForwarderOptions {
  /** Loopback address the product server is bound to. */
  productHost?: string;
  /** Loopback port to listen on; 0 (default) picks a free one. */
  port?: number;
  /** `pairing` (default) is the relay surface; `peer` is enroll + host websocket only. */
  allow?: 'pairing' | 'peer';
}

const FORBIDDEN = JSON.stringify({ error: 'path is not allowed' });

function rawHeaderPairs(raw: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index + 1 < raw.length; index += 2) pairs.push([raw[index]!, raw[index + 1]!]);
  return pairs;
}

/** Headers a `Connection:` field names are hop-by-hop for this hop only. */
function connectionListed(headers: IncomingHttpHeaders): Set<string> {
  // Node joins repeated Connection fields into one comma-separated string.
  const value = headers.connection;
  const listed = new Set<string>();
  for (const token of String(value ?? '').split(',')) {
    const name = token.trim().toLowerCase();
    if (name) listed.add(name);
  }
  return listed;
}

function forwardedRequestHeaders(request: IncomingMessage, loopbackHost: string): Record<string, string> {
  const listed = connectionListed(request.headers);
  const pairs = rawHeaderPairs(request.rawHeaders).filter(([name]) => !listed.has(name.toLowerCase()));
  return headerPairsToRecord(pairs, loopbackHost);
}

function forwardedResponseHeaders(response: IncomingMessage): OutgoingHttpHeaders {
  const listed = connectionListed(response.headers);
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of rawHeaderPairs(response.rawHeaders)) {
    const key = name.toLowerCase();
    if (isStrippedPairingHeader(key) || listed.has(key)) continue;
    const existing = headers[key];
    if (existing === undefined) headers[key] = value;
    else headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return headers;
}

/**
 * Dot segments and encoded separators are refused outright rather than
 * resolved: no legitimate pairing client sends them, and refusing keeps the
 * checked path and the path the product server parses identical.
 */
function hasAmbiguousPath(target: string): boolean {
  const path = target.split(/[?#]/u, 1)[0]!;
  if (/%(?:2f|5c|00)/iu.test(path)) return true;
  return path.split('/').some((segment) => {
    const decoded = segment.replace(/%2e/giu, '.');
    return decoded === '.' || decoded === '..';
  });
}

function checkedTarget(target: string | undefined, origin: string): URL | null {
  if (typeof target !== 'string' || hasAmbiguousPath(target)) return null;
  return resolvePairingTarget(target, origin)?.url ?? null;
}

function refuseHttp(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    connection: 'close'
  });
  response.end(body);
}

function refuseUpgrade(socket: Duplex, status: number, message: string): void {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export async function startPairingForwarder(
  productPort: number,
  options: PairingForwarderOptions = {}
): Promise<PairingForwarder> {
  const productHost = options.productHost ?? '127.0.0.1';
  const allowlist = options.allow === 'peer' ? PEER_LINK_ALLOWLIST : PAIRING_ALLOWLIST;
  const loopbackHost = loopbackHostHeader(productPort, productHost);
  const origin = `http://${loopbackHost}`;
  const sockets = new Set<Socket>();

  function track(socket: Socket): void {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  }

  function upstreamRequest(method: string, url: URL, headers: OutgoingHttpHeaders) {
    const upstream = httpRequest({
      host: productHost,
      port: productPort,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      agent: false
    });
    upstream.on('socket', track);
    return upstream;
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const method = String(request.method).toUpperCase();
    const url = checkedTarget(request.url, origin);
    if (!url || !isAllowedHttp(method, url.pathname, allowlist)) {
      refuseHttp(response, 403, FORBIDDEN);
      return;
    }
    // http.request never follows redirects: a 3xx is handed back as-is, so a
    // destination the allowlist never saw is never contacted from here.
    const upstream = upstreamRequest(method, url, forwardedRequestHeaders(request, loopbackHost));
    upstream.on('response', (reply) => {
      response.writeHead(reply.statusCode!, forwardedResponseHeaders(reply));
      reply.pipe(response);
      reply.on('error', () => response.destroy());
    });
    upstream.on('error', () => {
      if (!response.headersSent) refuseHttp(response, 502, JSON.stringify({ error: 'pairing_forward_failed' }));
      else response.destroy();
    });
    response.on('close', () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.on('error', () => upstream.destroy());
    request.pipe(upstream);
  });

  server.on('connection', track);
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy());
    const url = checkedTarget(request.url, origin);
    const isWebSocket = String(request.headers.upgrade).toLowerCase() === 'websocket';
    if (String(request.method).toUpperCase() !== 'GET' || !isWebSocket || !url || !isAllowedWs(url.pathname, allowlist)) {
      refuseUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const headers: OutgoingHttpHeaders = {
      ...forwardedRequestHeaders(request, loopbackHost),
      connection: 'Upgrade',
      upgrade: 'websocket'
    };
    const upstream = upstreamRequest('GET', url, headers);
    upstream.on('upgrade', (reply, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}`];
      for (const [name, value] of rawHeaderPairs(reply.rawHeaders)) lines.push(`${name}: ${value}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      socket.write(upstreamHead);
      upstreamSocket.write(head);
      upstreamSocket.on('error', () => socket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('response', (reply) => {
      reply.resume();
      refuseUpgrade(socket, reply.statusCode!, String(reply.statusMessage));
    });
    upstream.on('error', () => refuseUpgrade(socket, 502, 'Bad Gateway'));
    socket.on('close', () => upstream.destroy());
    upstream.end();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const { port } = server.address() as AddressInfo;

  let closing: Promise<void> | null = null;
  return {
    port,
    close() {
      closing ??= new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
        for (const socket of sockets) socket.destroy();
        sockets.clear();
      });
      return closing;
    }
  };
}
