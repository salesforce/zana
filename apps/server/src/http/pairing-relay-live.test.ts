import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { createPairingRelayClient } from './pairing-relay-client.js';

const enabled = process.env.ZCC_LIVE_RELAY === '1';
const origin = 'https://zcc-7808c5bc8f3d.herokuapp.com';

let product: ReturnType<typeof createServer> | null = null;
let client: ReturnType<typeof createPairingRelayClient> | null = null;

afterEach(async () => {
  client?.stop();
  client = null;
  await new Promise<void>((resolve) => {
    if (!product) {
      resolve();
      return;
    }
    product.close(() => resolve());
  });
  product = null;
});

describe.skipIf(!enabled)('live heroku pairing relay', () => {
  it('round-trips install.sh, enroll, interactive-request, and host ws', async () => {
    const token = process.env.ZCC_RELAY_TOKEN?.trim();
    if (!token) throw new Error('ZCC_RELAY_TOKEN is required for ZCC_LIVE_RELAY=1');

    product = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/install.sh') {
        response.writeHead(200, { 'content-type': 'text/x-shellscript' });
        response.end('#!/bin/sh\necho heroku-live-pair\n');
        return;
      }
      if (url.pathname === '/internal/hosts/enroll' && request.method === 'POST') {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          hostId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          hostKey: 'k'.repeat(32)
        }));
        return;
      }
      if (url.pathname === '/internal/hosts/interactive-request' && request.method === 'POST') {
        response.writeHead(200, { 'content-type': 'application/json' });
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
    const productPort = await new Promise<number>((resolve, reject) => {
      product!.listen(0, '127.0.0.1', () => {
        const address = product!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('missing port'));
          return;
        }
        resolve(address.port);
      });
    });

    client = createPairingRelayClient({ productPort, origin, token });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay did not connect')), 20_000);
      const stop = client!.onState((state) => {
        if (state === 'connected') {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
      client!.start();
    });
    expect(client.state()).toBe('connected');

    const script = await fetch(`${origin}/install.sh`);
    expect(script.status).toBe(200);
    await expect(script.text()).resolves.toContain('heroku-live-pair');

    const enrolled = await fetch(`${origin}/internal/hosts/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer zcde_test' },
      body: JSON.stringify({ hostName: 'live-pair' })
    });
    expect(enrolled.status).toBe(201);

    const approval = await fetch(`${origin}/internal/hosts/interactive-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer host-key' },
      body: '{}'
    });
    expect(approval.status).toBe(200);
    await expect(approval.json()).resolves.toEqual({ outcome: 'pending' });

    const WebSocket = (await import('ws')).default;
    const ws = new WebSocket(`${origin.replace(/^https/u, 'wss')}/internal/hosts/ws`, {
      headers: { authorization: 'Bearer host-key', 'x-zcc-host-id': 'h1' }
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const echoed = new Promise<string>((resolve) => {
      ws.once('message', (data) => resolve(String(data)));
    });
    ws.send('hello-heroku', { binary: false });
    await expect(echoed).resolves.toBe('hello-heroku');
    ws.close();
  }, 30_000);
});
