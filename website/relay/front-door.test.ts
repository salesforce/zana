import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startFrontDoor } from './front-door.mjs';
import { FLAG, TYPE, decodeFrame, encodeFrame, encodeJsonPayload } from './protocol.mjs';
import { connectWs } from './ws-raw.mjs';

let door: Awaited<ReturnType<typeof startFrontDoor>> | null = null;
let next: Server | null = null;

afterEach(async () => {
  await door?.close();
  door = null;
  await new Promise<void>((resolve) => {
    if (!next) {
      resolve();
      return;
    }
    next.close(() => resolve());
  });
  next = null;
});

async function listenNext(): Promise<string> {
  next = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html>docs</html>');
  });
  await new Promise<void>((resolve) => next!.listen(0, '127.0.0.1', () => resolve()));
  const address = next.address();
  if (!address || typeof address === 'string') throw new Error('next stub did not bind');
  return `http://127.0.0.1:${address.port}`;
}

describe('pairing front door', () => {
  it('serves Next for marketing paths and 503s install.sh without a laptop (never 308)', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin,
      env: { ZCC_SKIP_NEXT: '1', ZCC_RELAY_TOKEN: 'relay-token-relay-token' } as NodeJS.ProcessEnv
    });
    const site = await fetch(door.url, { redirect: 'manual' });
    expect(site.status).toBe(200);
    await expect(site.text()).resolves.toContain('docs');

    const install = await fetch(new URL('install.sh', door.url), { method: 'HEAD', redirect: 'manual' });
    expect(install.status).toBe(503);
    expect(install.headers.get('location')).toBeNull();
    const body = await fetch(new URL('install.sh', door.url), { redirect: 'manual' });
    expect(body.status).toBe(503);
    await expect(body.json()).resolves.toEqual({ error: 'relay_offline' });

    const relayHttp = await fetch(new URL('_zcc/relay', door.url), { redirect: 'manual' });
    expect(relayHttp.status).toBe(400);
    expect(relayHttp.headers.get('location')).toBeNull();
  });

  it('refuses a laptop with the wrong token', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'expected-token-expected',
      spawnNext: false,
      nextOrigin
    });
    await expect(connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: '/_zcc/relay',
      headers: { Authorization: 'Bearer wrong-token-wrong-token' }
    })).rejects.toThrow(/401/);
  });

  it('relays install.sh and streams a tarball in chunks once a laptop is attached', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin
    });
    const laptop = await connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: '/_zcc/relay',
      headers: { Authorization: 'Bearer relay-token-relay-token' }
    });
    const tarball = Buffer.alloc(80 * 1024, 7);
    laptop.on('message', (payload: Buffer) => {
      const frame = decodeFrame(payload);
      if (!frame) return;
      if (frame.type === TYPE.PING) {
        laptop.send(encodeFrame(TYPE.PONG, 0, frame.streamId));
        return;
      }
      if (frame.type !== TYPE.HTTP_REQ || !(frame.flags & FLAG.META)) return;
      const meta = JSON.parse(frame.payload.toString()) as { url: string };
      if (meta.url.startsWith('/install.sh')) {
        laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.META, frame.streamId, encodeJsonPayload({
          status: 200,
          headers: [['content-type', 'text/x-shellscript; charset=utf-8']]
        })));
        laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.FIN, frame.streamId, Buffer.from('#!/bin/sh\necho ok\n')));
        return;
      }
      if (meta.url.startsWith('/install/zcc-host.tgz')) {
        laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.META, frame.streamId, encodeJsonPayload({
          status: 200,
          headers: [
            ['content-type', 'application/gzip'],
            ['content-length', String(tarball.length)]
          ]
        })));
        laptop.send(encodeFrame(TYPE.HTTP_RES, 0, frame.streamId, tarball.subarray(0, 64 * 1024)));
        laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.FIN, frame.streamId, tarball.subarray(64 * 1024)));
      }
    });
    for (let i = 0; i < 50 && !door.hasLaptop(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(door.hasLaptop()).toBe(true);
    const script = await fetch(new URL('install.sh', door.url), { redirect: 'manual' });
    expect(script.status).toBe(200);
    expect(script.headers.get('location')).toBeNull();
    await expect(script.text()).resolves.toContain('#!/bin/sh');

    const artifact = await fetch(new URL('install/zcc-host.tgz', door.url));
    expect(artifact.status).toBe(200);
    const bytes = Buffer.from(await artifact.arrayBuffer());
    expect(bytes.equals(tarball)).toBe(true);

    laptop.close();
  });

  it('replaces the previous laptop on a second authenticated connect (last-wins)', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin
    });
    const first = await connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: '/_zcc/relay',
      headers: { Authorization: 'Bearer relay-token-relay-token' }
    });
    const firstClosed = new Promise<void>((resolve) => first.on('close', () => resolve()));
    const second = await connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: '/_zcc/relay',
      headers: { Authorization: 'Bearer relay-token-relay-token' }
    });
    await firstClosed;
    expect(door.hasLaptop()).toBe(true);
    second.on('message', (payload: Buffer) => {
      const frame = decodeFrame(payload);
      if (!frame || frame.type !== TYPE.HTTP_REQ || !(frame.flags & FLAG.META)) return;
      second.send(encodeFrame(TYPE.HTTP_RES, FLAG.META | FLAG.FIN, frame.streamId, encodeJsonPayload({
        status: 200,
        headers: [['content-type', 'text/plain; charset=utf-8']]
      })));
    });
    for (let i = 0; i < 50 && !door.hasLaptop(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const script = await fetch(new URL('install.sh', door.url), { redirect: 'manual' });
    expect(script.status).toBe(200);
    second.close();
  });
});
