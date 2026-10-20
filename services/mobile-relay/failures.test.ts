import { afterEach, expect, it, vi } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { startRelay } from './server.mjs';
import { connectRelay } from './client.mjs';

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const token = 't'.repeat(43);
async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return (server.address() as { port: number }).port;
}
function call(port: number, path = '/', headers = {}, method = 'GET') {
  return new Promise<number>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { host: 'relay.example', 'x-forwarded-proto': 'https', ...headers } }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.end();
  });
}
async function relayPeer() {
  const relay = await startRelay({ token, publicUrl: 'https://relay.example', host: '127.0.0.1' });
  cleanup.push(() => relay.close());
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/_relay/connect`, { headers: { host: 'relay.example', 'x-forwarded-proto': 'https', authorization: `Bearer ${token}` } });
  cleanup.push(() => ws.terminate());
  await once(ws, 'open');
  return { relay, ws };
}
it('requires HTTPS forwarding and confines public request targets and body sizes', async () => {
  const { relay } = await relayPeer();
  expect(await call(relay.port, '/_relay/health')).toBe(200);
  expect(await call(relay.port, '/', { 'x-forwarded-proto': 'http' })).toBe(403);
  expect(await call(relay.port, '/', { host: 'evil.example' })).toBe(403);
  expect(await call(relay.port, '/', { origin: 'https://evil.example' })).toBe(403);
  expect(await call(relay.port, '//elsewhere')).toBe(404);
  expect(await call(relay.port, '/', {}, 'OPTIONS')).toBe(404);
  expect(await call(relay.port, '/', { 'content-length': String(33 * 1024 * 1024) }, 'POST')).toBe(413);
});
it.each([
  { type: 'response', status: 199, headers: {} },
  { type: 'response', status: 200, headers: { 'set-cookie': ['bad\r\nheader'] } },
  { type: 'response-data', data: 'aGk=' },
  { type: 'response-end' },
  { type: 'unexpected' }
])('closes malformed desktop response frames: %j', async frame => {
  const { relay, ws } = await relayPeer();
  ws.on('message', raw => { const request = JSON.parse(raw.toString()); if (request.type === 'request') ws.send(JSON.stringify({ ...frame, id: request.id })); });
  const closed = once(ws, 'close');
  expect(await call(relay.port)).toBe(503);
  expect((await closed)[0]).toBe(1008);
});
it('propagates gateway failures without disconnecting the tunnel', async () => {
  const { relay, ws } = await relayPeer();
  ws.on('message', raw => { const request = JSON.parse(raw.toString()); if (request.type === 'request') ws.send(JSON.stringify({ type: 'error', id: request.id })); });
  expect(await call(relay.port)).toBe(502);
  expect(relay.connected()).toBe(true);
});
it('cleans up a failed listener start without disturbing the existing relay', async () => {
  const { relay } = await relayPeer();
  await expect(startRelay({ token, publicUrl: 'https://relay.example', host: '127.0.0.1', port: relay.port })).rejects.toHaveProperty('code', 'EADDRINUSE');
  expect(relay.connected()).toBe(true);
});

async function fakeRelay(hello = true, helloTimeoutMs = 10_000) {
  const server = createServer((_req, res) => res.destroy());
  const wss = new WebSocketServer({ server });
  const port = await listen(server);
  cleanup.push(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const connected = once(wss, 'connection');
  const client = connectRelay({ publicUrl: `http://127.0.0.1:${port}`, allowLocal: true, token, gatewayPort: port, retryMs: 10_000, helloTimeoutMs });
  cleanup.push(() => client.close());
  const [ws] = await connected as [WebSocket];
  if (hello) { ws.send(JSON.stringify({ type: 'hello', id: 0 })); await expect.poll(client.state).toBe('connected'); }
  return { ws, client };
}
it.each([
  { type: 'request', id: 1, headers: {}, method: 'GET', path: '//outside' },
  { type: 'request', id: 1, headers: {}, method: 'CONNECT', path: '/' },
  { type: 'request', id: 1, headers: { cookie: 'bad\nheader' }, method: 'GET', path: '/' },
  { type: 'request', id: 0, headers: {}, method: 'GET', path: '/' }
])('desktop refuses unconfined relay requests: %j', async frame => {
  const { ws } = await fakeRelay(); const closed = once(ws, 'close');
  ws.send(JSON.stringify(frame)); expect((await closed)[0]).toBe(1008);
});
it('does not process requests until the relay handshake completes', async () => {
  const { ws } = await fakeRelay(false); const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'request', id: 1, headers: {}, method: 'GET', path: '/' }));
  expect((await closed)[0]).toBe(1008);
});
it('reconnects if a WebSocket endpoint never completes the relay handshake', async () => {
  const { ws, client } = await fakeRelay(false, 30);
  expect((await once(ws, 'close'))[0]).toBe(1006);
  await expect.poll(client.state).toBe('reconnecting');
});
it('reports a failed loopback request while keeping the authenticated tunnel usable', async () => {
  const { ws, client } = await fakeRelay(); const reply = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'request', id: 1, headers: {}, method: 'GET', path: '/' }));
  ws.send(JSON.stringify({ type: 'request-end', id: 1 }));
  expect(JSON.parse((await reply)[0].toString())).toEqual({ type: 'error', id: 1 });
  expect(client.state()).toBe('connected');
});
it('bounds queued socket messages before the local gateway has accepted a socket', async () => {
  const { ws, client } = await fakeRelay(); const reply = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'ws-open', id: 1, headers: {} }));
  ws.send(JSON.stringify({ type: 'ws-data', id: 1, data: Buffer.alloc(128 * 1024).toString('base64'), binary: true }));
  expect(JSON.parse((await reply)[0].toString())).toEqual({ type: 'error', id: 1 });
  expect(client.state()).toBe('connected');
});

it.each([
  { random: 0, delay: 500 },
  { random: 0.999999, delay: 999 }
])('spreads each reconnect delay over [0.5x, 1x] of the backoff (random=$random)', async ({ random, delay }) => {
  const server = createServer(); const wss = new WebSocketServer({ server }); const port = await listen(server);
  cleanup.push(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  wss.on('connection', ws => ws.terminate());
  const delays: number[] = []; const realSetTimeout = globalThis.setTimeout;
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => { if (ms === delay) delays.push(ms); return realSetTimeout(fn, ms === delay ? 60_000 : ms, ...args); }) as typeof setTimeout);
  cleanup.push(() => spy.mockRestore());
  const client = connectRelay({ publicUrl: `http://127.0.0.1:${port}`, allowLocal: true, token, gatewayPort: port, retryMs: 1000, random: () => random });
  cleanup.push(() => client.close());
  await expect.poll(() => delays.length).toBeGreaterThan(0);
  expect(delays[0]).toBe(delay);
});
