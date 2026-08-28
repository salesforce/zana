import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { startFrontDoor } from '../../../../website/relay/front-door.mjs';
import { createPairingRelayClient } from './pairing-relay-client.js';

let door: Awaited<ReturnType<typeof startFrontDoor>> | null = null;
let next: ReturnType<typeof createServer> | null = null;
let product: ReturnType<typeof createServer> | null = null;
let client: ReturnType<typeof createPairingRelayClient> | null = null;
const tarball = Buffer.alloc(80 * 1024, 9);

afterEach(async () => {
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

async function startStack() {
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
    nextOrigin: `http://127.0.0.1:${nextPort}`
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
    const bytes = Buffer.from(await artifact.arrayBuffer());
    expect(bytes.equals(tarball)).toBe(true);

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
});
