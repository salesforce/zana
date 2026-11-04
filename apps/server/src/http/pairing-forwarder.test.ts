import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';
import { Server as NetServer, connect, type AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { startPairingForwarder, type PairingForwarder } from './pairing-forwarder.js';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const BIG = 4 * 1024 * 1024;

let product: Server;
let productPort: number;
let wss: WebSocketServer;
let seen: Seen[];
let wsSeen: IncomingHttpHeaders[];
let forwarder: PairingForwarder | undefined;

function listen(server: Server | NetServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

beforeEach(async () => {
  seen = [];
  wsSeen = [];
  wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
  });
  product = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8')
      });
      const path = (request.url ?? '').split('?')[0];
      if (path === '/install/version') {
        response.writeHead(302, { location: '/api/v1/projects' }).end();
        return;
      }
      if (path === '/install/zcc-host.tgz') {
        response.writeHead(200, {
          'content-type': 'application/gzip',
          'set-cookie': ['a=1', 'b=2', 'c=3'],
          connection: 'x-upstream-private',
          'x-upstream-private': 'secret',
          'keep-alive': 'timeout=5'
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        const chunk = Buffer.alloc(64 * 1024, 7);
        let sent = 0;
        const pump = () => {
          while (sent < BIG) {
            sent += chunk.length;
            if (!response.write(chunk)) {
              response.once('drain', pump);
              return;
            }
          }
          response.end();
        };
        pump();
        return;
      }
      if (path === '/internal/hosts/tool-call') {
        // Headers flushed, then the upstream dies mid-body.
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.write('partial');
        setTimeout(() => request.socket.destroy(), 20);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, path }));
    });
  });
  product.on('upgrade', (request: IncomingMessage, socket, head) => {
    wsSeen.push(request.headers);
    if ((request.url ?? '').includes('reject=1')) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  productPort = await listen(product);
});

afterEach(async () => {
  await forwarder?.close();
  forwarder = undefined;
  for (const client of wss.clients) client.terminate();
  wss.close();
  product.closeAllConnections();
  await new Promise<void>((resolve) => product.close(() => resolve()));
  vi.restoreAllMocks();
});

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function send(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string }
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      }
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

describe('startPairingForwarder', () => {
  it('binds an ephemeral port on 127.0.0.1 only', async () => {
    const listenSpy = vi.spyOn(NetServer.prototype, 'listen');
    forwarder = await startPairingForwarder(productPort);
    expect(listenSpy).toHaveBeenCalledWith(0, '127.0.0.1', expect.any(Function));
    expect(forwarder.port).toBeGreaterThan(0);
    expect(forwarder.port).not.toBe(productPort);
  });

  it('forwards the installer script with Host pinned and spoofable headers stripped', async () => {
    forwarder = await startPairingForwarder(productPort);
    const reply = await send(forwarder.port, {
      path: '/install.sh?x=1',
      headers: {
        host: 'evil.example:443',
        origin: 'https://evil.example',
        'x-forwarded-for': '10.0.0.1',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        'x-forwarded-port': '443',
        'x-real-ip': '10.0.0.1',
        forwarded: 'for=10.0.0.1',
        'proxy-authorization': 'Basic abc',
        connection: 'x-private-hop, , close',
        'x-private-hop': 'drop-me',
        'x-keep': 'kept'
      }
    });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body.toString())).toEqual({ ok: true, path: '/install.sh' });
    const request = seen.at(-1)!;
    expect(request.url).toBe('/install.sh?x=1');
    expect(request.headers.host).toBe(`127.0.0.1:${productPort}`);
    for (const name of [
      'origin',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-forwarded-port',
      'x-real-ip',
      'forwarded',
      'proxy-authorization',
      'x-private-hop'
    ]) {
      expect(request.headers[name]).toBeUndefined();
    }
    expect(request.headers['x-keep']).toBe('kept');
  });

  it('forwards enrollment and daemon callback POST bodies', async () => {
    forwarder = await startPairingForwarder(productPort);
    for (const path of [
      '/internal/hosts/enroll',
      '/internal/hosts/cli-callback',
      '/internal/hosts/interactive-request',
      '/internal/hosts/interactive-request/interrupt'
    ]) {
      const reply = await send(forwarder.port, {
        method: 'POST',
        path,
        headers: { 'content-type': 'application/json', authorization: 'Bearer host-key' },
        body: JSON.stringify({ path })
      });
      expect(reply.status).toBe(200);
      const request = seen.at(-1)!;
      expect(request).toMatchObject({ method: 'POST', url: path, body: JSON.stringify({ path }) });
      expect(request.headers.authorization).toBe('Bearer host-key');
    }
  });

  it('forwards a chunked request body without a content-length', async () => {
    forwarder = await startPairingForwarder(productPort);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: forwarder!.port, method: 'POST', path: '/internal/hosts/enroll', agent: false },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        }
      );
      request.on('error', reject);
      request.write('part-1,');
      setTimeout(() => request.end('part-2'), 10);
    });
    expect(status).toBe(200);
    expect(seen.at(-1)!.body).toBe('part-1,part-2');
    expect(seen.at(-1)!.headers['transfer-encoding']).toBe('chunked');
  });

  it('allows the plugin host artifact pattern', async () => {
    forwarder = await startPairingForwarder(productPort);
    const reply = await send(forwarder.port, { path: `/internal/plugins/provider-acp/host/${'a'.repeat(64)}` });
    expect(reply.status).toBe(200);
  });

  it('streams the large host package and drops hop-by-hop response headers', async () => {
    forwarder = await startPairingForwarder(productPort);
    const reply = await send(forwarder.port, { path: '/install/zcc-host.tgz' });
    expect(reply.status).toBe(200);
    expect(reply.body.length).toBe(BIG);
    expect(reply.headers['set-cookie']).toEqual(['a=1', 'b=2', 'c=3']);
    expect(reply.headers['x-upstream-private']).toBeUndefined();
    expect(reply.headers['keep-alive']).toBeUndefined();
    const head = await send(forwarder.port, { method: 'HEAD', path: '/install/zcc-host.tgz' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
  });

  it('passes a 3xx back without following it', async () => {
    forwarder = await startPairingForwarder(productPort);
    const reply = await send(forwarder.port, { path: '/install/version' });
    expect(reply.status).toBe(302);
    expect(reply.headers.location).toBe('/api/v1/projects');
    expect(seen.map((entry) => entry.url)).toEqual(['/install/version']);
  });

  it('refuses the product API and wrong methods without contacting the product server', async () => {
    forwarder = await startPairingForwarder(productPort);
    const attempts = [
      { method: 'GET', path: '/api/v1/projects' },
      { method: 'POST', path: '/api/v1/projects', body: '{}' },
      { method: 'GET', path: '/api/v1/relay' },
      { method: 'GET', path: '/' },
      { method: 'GET', path: '/internal/hosts/enroll' },
      { method: 'DELETE', path: '/install.sh' }
    ];
    for (const attempt of attempts) {
      const reply = await send(forwarder.port, attempt);
      expect(reply.status, `${attempt.method} ${attempt.path}`).toBe(403);
      expect(JSON.parse(reply.body.toString())).toEqual({ error: 'path is not allowed' });
    }
    expect(seen).toEqual([]);
  });

  it('refuses plain, encoded, and authority-form traversal', async () => {
    forwarder = await startPairingForwarder(productPort);
    for (const path of [
      '/install/../api/v1/projects',
      '/install/%2e%2e/api/v1/projects',
      '/install/%2E%2E/api/v1/projects',
      '/install/.%2e/api/v1/projects',
      '/install/./zcc-host.tgz',
      '/api/v1/../../install.sh',
      '/internal/hosts/enroll%2f..%2f..%2fapi%2fv1%2fprojects',
      '/internal/plugins/a%2f..%2f..%2fapi/host/' + 'a'.repeat(64),
      '/install.sh%00',
      '/install%5c..%5capi',
      '//evil.example/install.sh'
    ]) {
      const reply = await send(forwarder.port, { path });
      expect(reply.status, path).toBe(403);
    }
    expect(seen).toEqual([]);
  });

  it('refuses an absolute-form request target', async () => {
    forwarder = await startPairingForwarder(productPort);
    const reply = await send(forwarder.port, { path: `http://127.0.0.1:${productPort}/api/v1/projects` });
    expect(reply.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('answers 502 when the product server is unreachable', async () => {
    const dead = createServer();
    const deadPort = await listen(dead);
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    forwarder = await startPairingForwarder(deadPort);
    const reply = await send(forwarder.port, { path: '/install.sh' });
    expect(reply.status).toBe(502);
    expect(JSON.parse(reply.body.toString())).toEqual({ error: 'pairing_forward_failed' });
  });

  it('tears down the response when the product server fails mid-body', async () => {
    forwarder = await startPairingForwarder(productPort);
    await expect(send(forwarder.port, { method: 'POST', path: '/internal/hosts/tool-call', body: '{}' })).rejects.toThrow();
  });

  it('aborts the upstream request when the remote caller disconnects', async () => {
    forwarder = await startPairingForwarder(productPort);
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port: forwarder!.port, path: '/install/zcc-host.tgz', agent: false },
        (response) => {
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        }
      );
      request.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET') reject(error);
      });
      request.end();
    });
  });

  it('bridges /internal/hosts/ws with Host pinned and spoofed headers stripped', async () => {
    forwarder = await startPairingForwarder(productPort);
    const client = new WebSocket(`ws://127.0.0.1:${forwarder.port}/internal/hosts/ws/`, {
      headers: { 'x-forwarded-for': '10.0.0.1', origin: 'https://evil.example', authorization: 'Bearer host-key' }
    });
    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    const echoed = new Promise<string>((resolve) => client.once('message', (data) => resolve(data.toString())));
    client.send('ping');
    expect(await echoed).toBe('ping');
    const headers = wsSeen.at(-1)!;
    expect(headers.host).toBe(`127.0.0.1:${productPort}`);
    expect(headers['x-forwarded-for']).toBeUndefined();
    expect(headers.origin).toBeUndefined();
    expect(headers.authorization).toBe('Bearer host-key');
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.close();
    await closed;
  });

  it('refuses WebSocket upgrades outside the allowlist', async () => {
    forwarder = await startPairingForwarder(productPort);
    for (const path of ['/ws', '/api/v1/ws', '/internal/hosts/../ws', '/internal/hosts/%2e%2e/ws']) {
      const client = new WebSocket(`ws://127.0.0.1:${forwarder.port}${path}`);
      const status = await new Promise<number>((resolve) => {
        client.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
        client.once('error', () => resolve(-1));
      });
      expect(status, path).toBe(403);
    }
    expect(wsSeen).toEqual([]);
  });

  it('refuses a non-WebSocket upgrade on the allowed path', async () => {
    forwarder = await startPairingForwarder(productPort);
    const raw = await rawExchange(
      forwarder.port,
      'GET /internal/hosts/ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: h2c\r\n\r\n'
    );
    expect(raw.startsWith('HTTP/1.1 403')).toBe(true);
    expect(wsSeen).toEqual([]);
  });

  it('forwards a request that carries no Connection header', async () => {
    forwarder = await startPairingForwarder(productPort);
    const raw = await rawExchange(forwarder.port, 'GET /install.sh HTTP/1.0\r\nHost: evil.example\r\n\r\n');
    expect(raw.startsWith('HTTP/1.1 200')).toBe(true);
    expect(seen.at(-1)!.headers.host).toBe(`127.0.0.1:${productPort}`);
  });

  it('relays an upstream WebSocket refusal', async () => {
    forwarder = await startPairingForwarder(productPort);
    const client = new WebSocket(`ws://127.0.0.1:${forwarder.port}/internal/hosts/ws?reject=1`);
    const status = await new Promise<number>((resolve) => {
      client.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    });
    expect(status).toBe(401);
  });

  it('answers 502 to an upgrade when the product server is unreachable', async () => {
    const dead = createServer();
    const deadPort = await listen(dead);
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    forwarder = await startPairingForwarder(deadPort);
    const client = new WebSocket(`ws://127.0.0.1:${forwarder.port}/internal/hosts/ws`);
    const status = await new Promise<number>((resolve) => {
      client.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    });
    expect(status).toBe(502);
  });

  it('closes the listener and live tunnels on close()', async () => {
    forwarder = await startPairingForwarder(productPort);
    const port = forwarder.port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/internal/hosts/ws`);
    await new Promise<void>((resolve) => client.once('open', () => resolve()));
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    const first = forwarder.close();
    expect(forwarder.close()).toBe(first);
    await first;
    await closed;
    await expect(send(port, { path: '/install.sh' })).rejects.toThrow(/ECONNREFUSED/);
  });

  const hasIpv6Loopback = Object.values(networkInterfaces()).flat().some((entry) => entry?.address === '::1');
  it.skipIf(!hasIpv6Loopback)('forwards to an IPv6 loopback product host with a bracketed pinned Host header', async () => {
    let upstreamHost: string | undefined;
    const upstream = createServer((request, response) => {
      upstreamHost = request.headers.host;
      response.writeHead(200).end('ok');
    });
    await new Promise<void>((resolve) => upstream.listen(0, '::1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    try {
      forwarder = await startPairingForwarder(upstreamPort, { productHost: '::1' });
      const reply = await send(forwarder.port, { path: '/install.sh' });
      expect(reply.status).toBe(200);
      expect(upstreamHost).toBe(`[::1]:${upstreamPort}`);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});

function rawExchange(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe("startPairingForwarder allow: 'peer'", () => {
  it('forwards only enrollment and the host websocket', async () => {
    forwarder = await startPairingForwarder(productPort, { allow: 'peer' });
    const enroll = await send(forwarder.port, { method: 'POST', path: '/internal/hosts/enroll', body: '{}' });
    expect(enroll.status).toBe(200);
    expect(seen.at(-1)?.url).toBe('/internal/hosts/enroll');
    const before = seen.length;
    for (const [method, path] of [
      ['GET', '/install.sh'],
      ['GET', '/install/zcc-host.tgz'],
      ['POST', '/internal/hosts/tool-call'],
      ['POST', '/internal/hosts/cli-callback'],
      ['POST', '/internal/hosts/interactive-request'],
      ['GET', '/internal/hosts/enroll'],
      ['GET', '/api/v1/config'],
      ['HEAD', '/']
    ] as const) {
      const reply = await send(forwarder.port, { method, path });
      expect(reply.status, `${method} ${path}`).toBe(403);
      if (method !== 'HEAD') expect(JSON.parse(reply.body.toString())).toEqual({ error: 'path is not allowed' });
    }
    expect(seen.length).toBe(before);
  });

  it('upgrades the host websocket and refuses other websocket paths', async () => {
    forwarder = await startPairingForwarder(productPort, { allow: 'peer' });
    const ok = new WebSocket(`ws://127.0.0.1:${forwarder.port}/internal/hosts/ws`);
    const echoed = await new Promise<string>((resolve, reject) => {
      ok.on('open', () => ok.send('ping'));
      ok.on('message', (data) => resolve(data.toString()));
      ok.on('error', reject);
    });
    expect(echoed).toBe('ping');
    ok.close();
    const bad = new WebSocket(`ws://127.0.0.1:${forwarder.port}/ws`);
    const error = await new Promise<Error>((resolve) => bad.on('error', resolve));
    expect(error.message).toContain('403');
  });

  it('listens on the requested port', async () => {
    const probe = await startPairingForwarder(productPort);
    const free = probe.port;
    await probe.close();
    forwarder = await startPairingForwarder(productPort, { allow: 'peer', port: free });
    expect(forwarder.port).toBe(free);
  });

  it('keeps the default pairing surface unchanged', async () => {
    forwarder = await startPairingForwarder(productPort, { allow: 'pairing' });
    const reply = await send(forwarder.port, { path: '/install.sh' });
    expect(reply.status).toBe(200);
  });
});
