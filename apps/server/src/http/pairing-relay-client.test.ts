import { EventEmitter } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { startFrontDoor } from '../../../../website/relay/front-door.mjs';
import { createPairingRelayClient } from './pairing-relay-client.js';
import { FLAG, TYPE, decodeFrame, decodeJsonPayload, encodeFrame, encodeJsonPayload } from './pairing-relay-protocol.js';

let door: Awaited<ReturnType<typeof startFrontDoor>> | null = null;
let next: ReturnType<typeof createServer> | null = null;
let product: ReturnType<typeof createServer> | null = null;
let client: ReturnType<typeof createPairingRelayClient> | null = null;
let privilegedHits = 0;
const tarball = Buffer.alloc(80 * 1024, 9);
const PLUGIN_DIGEST = 'ab'.repeat(32);
const pluginHostJs = Buffer.from('export default 1;\n');

afterEach(async () => {
  privilegedHits = 0;
  client?.stop();
  client = null;
  await door?.close();
  door = null;
  await closeServer(next);
  next = null;
  await closeServer(product);
  product = null;
});

function closeServer(server: ReturnType<typeof createServer> | null): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('missing port'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function startStack(options?: { joinTtlMs?: number }) {
  next = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html>ok</html>');
  });
  const nextPort = await listen(next);
  product = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/install.sh') {
      const body = Buffer.from('#!/bin/sh\necho join\n');
      response.writeHead(200, {
        'content-type': 'text/x-shellscript; charset=utf-8',
        'content-length': String(body.length)
      });
      response.end(body);
      return;
    }
    if (url.pathname === '/install/zcc-host.tgz') {
      response.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': String(tarball.length)
      });
      response.end(tarball);
      return;
    }
    if (url.pathname === `/internal/plugins/provider-acp/host/${PLUGIN_DIGEST}`) {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': String(pluginHostJs.length)
      });
      response.end(pluginHostJs);
      return;
    }
    if (url.pathname === '/internal/hosts/enroll' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        if (!String(request.headers.host ?? '').startsWith('127.0.0.1')) {
          response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'host is not allowed' }));
          return;
        }
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
          hostId: '33333333-3333-4333-8333-333333333333',
          hostKey: 'k'.repeat(32)
        }));
      });
      return;
    }
    if (url.pathname === '/internal/hosts/tool-call' && request.method === 'POST') {
      response.writeHead(307, { location: '/api/terminals' });
      response.end();
      return;
    }
    if (url.pathname === '/api/terminals') {
      privilegedHits += 1;
      response.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ pid: 1 }));
      return;
    }
    if (url.pathname === '/internal/hosts/interactive-request/interrupt' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ outcome: 'interrupted' }));
      return;
    }
    if (url.pathname === '/internal/hosts/interactive-request' && request.method === 'POST') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ outcome: 'pending' }));
      return;
    }
    response.writeHead(404).end();
  });
  const productWss = new WebSocketServer({ noServer: true });
  product.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/internal/hosts/ws') {
      socket.destroy();
      return;
    }
    productWss.handleUpgrade(request, socket, head, (ws) => {
      ws.on('message', (data) => ws.send(data));
    });
  });
  const productPort = await listen(product);
  door = await startFrontDoor({
    host: '127.0.0.1',
    port: 0,
    token: 'relay-token-relay-token',
    spawnNext: false,
    nextOrigin: `http://127.0.0.1:${nextPort}`,
    ...(options?.joinTtlMs ? { joinTtlMs: options.joinTtlMs } : {})
  });
  client = createPairingRelayClient({
    productPort,
    origin: door.url.replace(/\/$/u, ''),
    token: 'relay-token-relay-token',
    allowLoopbackOrigin: true
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay did not connect')), 5_000);
    const stop = client!.onState((state) => {
      if (state === 'connected') {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
    client!.start();
  });
  for (let i = 0; i < 50 && !client.sessionId(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { door, productPort };
}

function rawRequest(port: number, method: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

/** Stand-in for the hub control socket: lets a test inject frames directly. */
class FakeControlSocket extends EventEmitter {
  static last: FakeControlSocket | null = null;
  readyState: number = WebSocket.CONNECTING;
  readonly sent: Buffer[] = [];
  constructor() {
    super();
    FakeControlSocket.last = this;
    setImmediate(() => {
      this.readyState = WebSocket.OPEN;
      this.emit('open');
    });
  }
  send(data: Buffer): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
  terminate(): void {
    this.readyState = WebSocket.CLOSED;
  }
  deliver(type: number, flags: number, streamId: number, payload: Buffer): void {
    this.emit('message', encodeFrame(type, flags, streamId, payload));
  }
  async response(streamId: number): Promise<{ status: number; headers: Array<[string, string]> }> {
    for (let i = 0; i < 100; i++) {
      for (const raw of this.sent) {
        const frame = decodeFrame(raw);
        if (frame?.streamId === streamId && (frame.type === TYPE.HTTP_RES || frame.type === TYPE.WS_CLOSE) && frame.flags & FLAG.META) {
          return decodeJsonPayload(frame.payload) as { status: number; headers: Array<[string, string]> };
        }
        if (frame?.streamId === streamId && frame.type === TYPE.WS_CLOSE) {
          return { status: (decodeJsonPayload(frame.payload) as { code: number }).code, headers: [] };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no response for stream ${streamId}`);
  }
}

async function startDirectClient(fetchImpl: typeof fetch, WsChild?: typeof WebSocket) {
  const WsImpl = vi.fn(function (this: unknown, url: URL, opts: unknown) {
    if (String(url).includes('/_zcc/relay')) return new FakeControlSocket();
    return WsChild ? new WsChild(url, opts as WebSocket.ClientOptions) : new FakeControlSocket();
  }) as unknown as typeof WebSocket;
  client = createPairingRelayClient({
    productPort: 8781,
    origin: 'https://relay.example',
    token: 'relay-token-relay-token',
    fetchImpl,
    WebSocketImpl: WsImpl
  });
  client.start();
  for (let i = 0; i < 50 && client.state() !== 'connected'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { control: FakeControlSocket.last!, WsImpl: WsImpl as unknown as ReturnType<typeof vi.fn> };
}

describe('pairing relay client', () => {
  it('round-trips install.sh, a tarball, enroll, host ws, and interactive-request', async () => {
    const stack = await startStack();
    expect(client?.sessionId()).toMatch(/^zcrs_/);
    const prefixed = await fetch(new URL(`t/${client!.sessionId()}/install.sh`, stack.door.url));
    expect(prefixed.status).toBe(200);
    await expect(prefixed.text()).resolves.toContain('echo join');
    const script = await fetch(new URL('install.sh', stack.door.url));
    expect(script.status).toBe(200);
    await expect(script.text()).resolves.toContain('echo join');

    const artifact = await fetch(new URL('install/zcc-host.tgz', stack.door.url));
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get('content-length')).toBe(String(tarball.length));
    const bytes = Buffer.from(await artifact.arrayBuffer());
    expect(bytes.equals(tarball)).toBe(true);

    const plugin = await fetch(
      new URL(`internal/plugins/provider-acp/host/${PLUGIN_DIGEST}`, stack.door.url)
    );
    expect(plugin.status).toBe(200);
    expect(plugin.headers.get('content-length')).toBe(String(pluginHostJs.length));
    expect(Buffer.from(await plugin.arrayBuffer()).equals(pluginHostJs)).toBe(true);

    const enrolled = await fetch(new URL('internal/hosts/enroll', stack.door.url), {
      method: 'POST',
      headers: {
        authorization: 'Bearer zcde_test',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ hostName: 'relay-box' })
    });
    expect(enrolled.status).toBe(201);
    await expect(enrolled.json()).resolves.toMatchObject({
      hostId: '33333333-3333-4333-8333-333333333333'
    });

    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(new URL('internal/hosts/ws', stack.door.url.replace(/^http/, 'ws')), {
      headers: { authorization: 'Bearer host-key', 'x-zcc-host-id': 'h1' }
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const echoed = new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(String(data)));
    });
    ws.send('hello', { binary: false });
    await expect(echoed).resolves.toBe('hello');
    ws.close();

    const approval = await fetch(new URL('internal/hosts/interactive-request', stack.door.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer host-key' },
      body: '{}'
    });
    expect(approval.status).toBe(200);
    await expect(approval.json()).resolves.toEqual({ outcome: 'pending' });

    const interrupt = await fetch(new URL('internal/hosts/interactive-request/interrupt', stack.door.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer host-key' },
      body: '{}'
    });
    expect(interrupt.status).toBe(200);
    await expect(interrupt.json()).resolves.toEqual({ outcome: 'interrupted' });
  }, 15_000);

  it('does not forward product API paths to the laptop', async () => {
    const stack = await startStack();
    const config = await fetch(new URL('api/v1/config', stack.door.url));
    const text = await config.text();
    expect(text).toContain('ok');
    expect(text).not.toContain('hostKey');
  });

  it('reports unconfigured without a token and does not dial loopback origins', async () => {
    const idle = createPairingRelayClient({
      productPort: 1,
      origin: 'http://127.0.0.1:9',
      token: 'x'
    });
    idle.start();
    expect(idle.state()).toBe('unconfigured');
    idle.stop();
  });

  it('refuses a token mismatch and stays offline', async () => {
    const stack = await startStack();
    client?.stop();
    client = createPairingRelayClient({
      productPort: 1,
      origin: stack.door.url.replace(/\/$/u, ''),
      token: 'wrong-token-wrong-token',
      allowLoopbackOrigin: true
    });
    const seen: string[] = [];
    const stop = client.onState((state) => seen.push(state));
    client.start();
    for (let i = 0; i < 50 && !seen.includes('offline'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stop();
    expect(client.state()).toBe('offline');
    expect(seen).toContain('offline');
  });

  it('renews the join hint before the ttl elapses so install.sh stays open', async () => {
    const stack = await startStack({ joinTtlMs: 1_500 });
    const firstUntil = client?.joinUntil();
    expect(firstUntil).toBeGreaterThan(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(client?.joinUntil()).toBeGreaterThan(firstUntil ?? 0);
    const script = await fetch(new URL(`t/${client!.sessionId()}/install.sh`, stack.door.url));
    expect(script.status).toBe(200);
  }, 10_000);

  it('hub refuses authority-bearing targets on prefixed and unprefixed routes', async () => {
    const stack = await startStack();
    const port = Number(new URL(stack.door.url).port);
    const sessionId = client!.sessionId()!;
    const prefixed = await rawRequest(port, 'POST', `/t/${sessionId}//127.0.0.1:${stack.productPort}/internal/hosts/enroll`);
    expect(prefixed.status).toBe(400);
    expect(prefixed.body).toContain('invalid_request_target');
    const bare = await rawRequest(port, 'POST', `//127.0.0.1:${stack.productPort}/internal/hosts/enroll`);
    expect(bare.status).toBe(400);
    const control = await rawRequest(port, 'POST', `/t/${sessionId}/internal/hosts/enroll`);
    expect(control.status).toBe(201);
  });

  it('relays a product redirect instead of following it to a non-allowlisted path', async () => {
    const stack = await startStack();
    const relayed = await fetch(new URL(`t/${client!.sessionId()}/internal/hosts/tool-call`, stack.door.url), {
      method: 'POST',
      body: '{}',
      redirect: 'manual'
    });
    expect(relayed.status).toBe(307);
    expect(privilegedHits).toBe(0);
  });

  it('client rejects an authority override even when the hub forwards it', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    const { control } = await startDirectClient(fetchImpl as unknown as typeof fetch);
    for (const [streamId, url] of [
      [1, '//127.0.0.1:9999/internal/hosts/enroll'],
      [3, '/\\127.0.0.1:9999/internal/hosts/enroll'],
      [5, '/internal/hosts/enroll/../../api/terminals'],
      [7, 'http://127.0.0.1:9999/internal/hosts/enroll']
    ] as const) {
      control.deliver(TYPE.HTTP_REQ, FLAG.META | FLAG.FIN, streamId, encodeJsonPayload({ method: 'POST', url, headers: [] }));
      await expect(control.response(streamId)).resolves.toMatchObject({ status: 403 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('client fetches the pinned loopback origin with redirects disabled', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 307, headers: { location: '/api/terminals' } }));
    const { control } = await startDirectClient(fetchImpl as unknown as typeof fetch);
    control.deliver(TYPE.HTTP_REQ, FLAG.META | FLAG.FIN, 1, encodeJsonPayload({
      method: 'POST',
      url: '/internal/hosts/enroll?x=1',
      headers: [['host', 'evil.example']]
    }));
    await expect(control.response(1)).resolves.toMatchObject({ status: 307 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe('http://127.0.0.1:8781/internal/hosts/enroll?x=1');
    expect(init.redirect).toBe('manual');
    expect((init.headers as Record<string, string>).host).toBe('127.0.0.1:8781');
  });

  it('client refuses an authority-bearing WebSocket target and pins allowed ones', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { control, WsImpl } = await startDirectClient(fetchImpl);
    control.deliver(TYPE.WS_OPEN, FLAG.META | FLAG.FIN, 1, encodeJsonPayload({ url: '//evil.example/internal/hosts/ws', headers: [] }));
    await expect(control.response(1)).resolves.toMatchObject({ status: 1008 });
    control.deliver(TYPE.WS_OPEN, FLAG.META | FLAG.FIN, 3, encodeJsonPayload({ url: '/internal/hosts/ws', headers: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const childCall = WsImpl.mock.calls.find(([url]) => !String(url).includes('/_zcc/relay'));
    expect(String(childCall?.[0])).toBe('ws://127.0.0.1:8781/internal/hosts/ws');
    expect(childCall?.[1]).toMatchObject({ followRedirects: false });
  });
});
