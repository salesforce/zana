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

  it('keeps two laptops on isolated /t/<id> paths (no steal)', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin
    });
    const first = await connectEchoLaptop(door.port, 'one');
    const second = await connectEchoLaptop(door.port, 'two');
    expect(first.hello.sessionId).not.toBe(second.hello.sessionId);
    expect(door.sessionCount()).toBe(2);

    const fromFirst = await fetch(new URL(`t/${first.hello.sessionId}/install.sh`, door.url));
    expect(fromFirst.status).toBe(200);
    await expect(fromFirst.text()).resolves.toBe('one');
    const fromSecond = await fetch(new URL(`t/${second.hello.sessionId}/install.sh`, door.url));
    expect(fromSecond.status).toBe(200);
    await expect(fromSecond.text()).resolves.toBe('two');

    const bare = await fetch(new URL('install.sh', door.url));
    expect(bare.status).toBe(503);
    await expect(bare.json()).resolves.toEqual({ error: 'relay_ambiguous' });

    first.laptop.close();
    second.laptop.close();
  });

  it('reclaims a session after disconnect and 409s a live id', async () => {
    const nextOrigin = await listenNext();
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin
    });
    const first = await connectEchoLaptop(door.port);
    const sessionId = first.hello.sessionId;
    const firstClosed = new Promise<void>((resolve) => first.laptop.on('close', () => resolve()));
    first.laptop.close();
    await firstClosed;
    for (let i = 0; i < 50 && door.sessionCount() > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(door.sessionCount()).toBe(0);

    const reclaimed = await connectEchoLaptop(door.port, 'reclaim', sessionId);
    expect(reclaimed.hello.sessionId).toBe(sessionId);

    await expect(connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: '/_zcc/relay',
      headers: {
        Authorization: 'Bearer relay-token-relay-token',
        'X-Zcc-Relay-Session': sessionId
      }
    })).rejects.toThrow(/409/);

    reclaimed.laptop.close();
  });

  it('expires join paths after the join window while host ws still upgrades', async () => {
    const nextOrigin = await listenNext();
    let now = 1_000_000;
    door = await startFrontDoor({
      host: '127.0.0.1',
      port: 0,
      token: 'relay-token-relay-token',
      spawnNext: false,
      nextOrigin,
      now: () => now,
      joinTtlMs: 5_000
    });
    const attached = await connectEchoLaptop(door.port);
    const script = await fetch(new URL(`t/${attached.hello.sessionId}/install.sh`, door.url));
    expect(script.status).toBe(200);

    now += 6_000;
    const expired = await fetch(new URL(`t/${attached.hello.sessionId}/install.sh`, door.url));
    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toEqual({ error: 'join_expired' });
    const enroll = await fetch(new URL(`t/${attached.hello.sessionId}/internal/hosts/enroll`, door.url), {
      method: 'POST',
      body: '{}'
    });
    expect(enroll.status).toBe(410);

    const hostWs = await connectWs({
      hostname: '127.0.0.1',
      port: door.port,
      path: `/t/${attached.hello.sessionId}/internal/hosts/ws`
    });
    hostWs.close();

    attached.laptop.send(encodeFrame(TYPE.JOIN_RENEW, FLAG.FIN, 0));
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const again = await fetch(new URL(`t/${attached.hello.sessionId}/install.sh`, door.url));
      if (again.status === 200) {
        attached.laptop.close();
        return;
      }
    }
    throw new Error('join window did not renew');
  });
});

async function waitForHello(
  laptop: Awaited<ReturnType<typeof connectWs>>
): Promise<{ sessionId: string; joinUntil: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no HELLO')), 3_000);
    laptop.on('message', (payload: Buffer) => {
      const frame = decodeFrame(payload);
      if (!frame || frame.type !== TYPE.HELLO) return;
      clearTimeout(timer);
      resolve(JSON.parse(frame.payload.toString()) as { sessionId: string; joinUntil: number });
    });
  });
}

function echoInstall(laptop: Awaited<ReturnType<typeof connectWs>>, body: string): void {
  laptop.on('message', (payload: Buffer) => {
    const frame = decodeFrame(payload);
    if (!frame) return;
    if (frame.type === TYPE.PING) {
      laptop.send(encodeFrame(TYPE.PONG, 0, frame.streamId));
      return;
    }
    if (frame.type === TYPE.HELLO) return;
    if (frame.type !== TYPE.HTTP_REQ || !(frame.flags & FLAG.META)) return;
    laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.META, frame.streamId, encodeJsonPayload({
      status: 200,
      headers: [['content-type', 'text/plain; charset=utf-8']]
    })));
    laptop.send(encodeFrame(TYPE.HTTP_RES, FLAG.FIN, frame.streamId, Buffer.from(body)));
  });
}

async function connectEchoLaptop(
  port: number,
  body = 'ok',
  sessionId?: string
): Promise<{ laptop: Awaited<ReturnType<typeof connectWs>>; hello: { sessionId: string; joinUntil: number } }> {
  const headers: Record<string, string> = { Authorization: 'Bearer relay-token-relay-token' };
  if (sessionId) headers['X-Zcc-Relay-Session'] = sessionId;
  const laptop = await connectWs({
    hostname: '127.0.0.1',
    port,
    path: '/_zcc/relay',
    headers
  });
  const helloPromise = waitForHello(laptop);
  echoInstall(laptop, body);
  const hello = await helloPromise;
  return { laptop, hello };
}
