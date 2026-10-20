import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createRelay } from './server.mjs';
import { connectRelay } from './client.mjs';
import { PREVIEW_TARGET, PREVIEW_TTL, edgeCookies, parsePreviewLabel, previewHeaders, previewTargets } from './preview-policy.mjs';

const clean: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { for (const fn of clean.splice(0).reverse()) await fn(); });
async function listen(server: Server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return (server.address() as { port: number }).port; }
async function fixture() {
  let received: unknown;
  const app = createServer(async (req, res) => {
    received = req.headers;
    if (req.url === '/redirect') { res.writeHead(302, { location: `http://localhost:${appPort}/done`, 'set-cookie': ['app=ok; Domain=.example.test; Path=/', 'zcc_connect_session=evil'] }); res.end(); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.end(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(128 * 1024, 'a'));
  });
  const appSockets = new WebSocketServer({ server: app, handleProtocols: protocols => protocols.has('reload') ? 'reload' : false });
  appSockets.on('connection', ws => ws.on('message', (data, binary) => ws.send(data, { binary })));
  const appPort = await listen(app);
  clean.push(async () => { for (const ws of appSockets.clients) ws.terminate(); appSockets.close(); app.closeAllConnections(); await new Promise<void>(r => app.close(() => r())); });
  let shares = [{ port: appPort, expiresAt: Date.now() + PREVIEW_TTL }];
  let selected = appPort;
  const token = randomBytes(32).toString('base64url');
  let relay: ReturnType<typeof createRelay>;
  const edge = createServer((req, res) => { (req as any)[PREVIEW_TARGET] = selected; relay.handleHttp(req, res); });
  const edgePort = await listen(edge);
  const publicUrl = `http://127.0.0.1:${edgePort}`;
  relay = createRelay({ token, publicUrl, allowLocal: true, preview: true });
  edge.on('upgrade', (req, socket, head) => { if (req.url === '/_relay/previews') req.url = '/_relay/connect'; else (req as any)[PREVIEW_TARGET] = selected; relay.handleUpgrade(req, socket, head); });
  clean.push(async () => { relay.close(); edge.closeAllConnections(); await new Promise<void>(r => edge.close(() => r())); });
  const client = connectRelay({ publicUrl, token, gatewayPort: appPort, previews: () => shares, allowLocal: true });
  clean.push(() => client.close());
  await expect.poll(() => relay.hasPreview(appPort)).toBe(true);
  return { publicUrl, appPort, received: () => received, remove: () => { shares = []; }, select: (port: number) => { selected = port; } };
}

it('streams HTTP and upload bodies while stripping control credentials and confining cookies/redirects', async () => {
  const f = await fixture();
  const response = await fetch(f.publicUrl, { headers: { cookie: 'zcc_connect_session=secret; app=visible', authorization: 'Bearer secret', 'x-zcc-connect-gateway': 'secret', origin: f.publicUrl } });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await response.arrayBuffer()).byteLength).toBe(128 * 1024);
  expect(f.received()).toMatchObject({ cookie: 'app=visible', host: `127.0.0.1:${f.appPort}`, origin: `http://127.0.0.1:${f.appPort}` });
  expect(JSON.stringify(f.received())).not.toContain('secret');
  const body = randomBytes(256 * 1024);
  expect(Buffer.from(await (await fetch(f.publicUrl, { method: 'POST', body })).arrayBuffer())).toEqual(body);
  const redirect = await fetch(`${f.publicUrl}/redirect`, { redirect: 'manual' });
  expect(redirect.headers.get('location')).toBe('/done');
  expect(redirect.headers.getSetCookie()).toEqual(['app=ok; Path=/']);
  f.select(f.appPort + 1);
  expect((await fetch(f.publicUrl)).status).toBe(404);
});

it('negotiates the origin WebSocket subprotocol, carries binary frames and closes revoked streams', async () => {
  const f = await fixture();
  const ws = new WebSocket(f.publicUrl.replace('http:', 'ws:') + '/vite-hmr', ['other', 'reload']);
  ws.on('error', () => {}); clean.push(() => ws.terminate());
  await once(ws, 'open'); expect(ws.protocol).toBe('reload');
  const payload = randomBytes(64 * 1024), reply = once(ws, 'message'); ws.send(payload);
  expect((await reply)[0]).toEqual(payload);
  const closed = once(ws, 'close'); f.remove(); await closed;
  await expect.poll(async () => (await fetch(f.publicUrl)).status).toBe(404);
});

it('rejects internal routes and cross-origin visitors', async () => {
  const f = await fixture();
  for (const path of ['/internal/tool', '/_relay/connect', '/_connect/callback']) expect((await fetch(f.publicUrl + path)).status).toBe(404);
  expect((await fetch(f.publicUrl, { headers: { origin: 'https://another.test' } })).status).toBe(403);
});

it('validates preview labels, bounded expiring targets and unsafe headers', () => {
  expect(parsePreviewLabel('alice--5173')).toEqual({ base: 'alice', machine: null, port: 5173 });
  expect(parsePreviewLabel('alice--0123456789abcdef--3000')?.machine).toBe('0123456789abcdef');
  for (const label of ['alice--22', 'alice--99999', 'alice--05173', 'alice--bad--5173']) expect(parsePreviewLabel(label)).toBeNull();
  expect(previewTargets([{ port: 3000, expiresAt: 1 }])).toEqual([]);
  expect(() => previewTargets([{ port: 3000, expiresAt: Date.now() + PREVIEW_TTL * 2 }])).toThrow();
  expect(() => previewTargets(Array(33).fill({ port: 3000, expiresAt: 1 }))).toThrow();
  expect(() => previewHeaders({ unsafe: 'a\r\nb' })).toThrow();
  expect(previewHeaders({ location: 'https://other.test' }, true, 3000)).toEqual({ 'cache-control': 'private, no-store' });
  expect(previewHeaders({ 'cache-control': 'public, max-age=86400', connection: 'x-hop', 'x-hop': 'secret' }, true, 3000)).toEqual({ 'cache-control': 'private, no-store' });
});

it.each(['/\\attacker.example/path', '/\t/attacker.example/path', '//attacker.example/path', 'http://localhost:3000//attacker.example/path', 'https://attacker.example/path'])('drops redirects that can escape the preview origin: %j', location => {
  expect(previewHeaders({ location }, true, 3000)).not.toHaveProperty('location');
});

it.each(['/done?next=%2Fapp#ok', 'http://localhost:3000/done?next=%2Fapp#ok'])('preserves safe redirects on the preview origin: %s', location => {
  expect(previewHeaders({ location }, true, 3000).location).toBe('/done?next=%2Fapp#ok');
});

it.each(['handshake', 'http'])('reports an old peer as update-required (%s) without falling back to the control tunnel', async mode => {
  const edge = createServer(); const port = await listen(edge);
  const wss = new WebSocketServer({ noServer: true });
  let upgrades = 0;
  edge.on('upgrade', (req, socket, head) => {
    upgrades++; expect(req.url).toBe('/_relay/previews');
    if (mode === 'http') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => ws.send(JSON.stringify({ type: 'hello', id: 0 })));
  });
  clean.push(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise<void>(r => edge.close(() => r())); });
  const client = connectRelay({ publicUrl: `http://127.0.0.1:${port}`, token: 'a'.repeat(43), gatewayPort: 1, allowLocal: true, previews: () => [], retryMs: 1 });
  clean.push(() => client.close());
  await expect.poll(() => client.state()).toBe('update-required'); expect(upgrades).toBe(1);
});

it('a preview client rejects undeclared targets even when its authenticated gateway asks for one', async () => {
  const edge = createServer(); const port = await listen(edge); const wss = new WebSocketServer({ server: edge });
  const replies: any[] = [];
  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'hello', id: 0, previewVersion: 1 }));
    ws.send(JSON.stringify({ type: 'request', id: 1, target: 8780, method: 'GET', path: '/api/v1/projects', headers: {} }));
    ws.on('message', raw => replies.push(JSON.parse(raw.toString())));
  });
  clean.push(async () => { for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise<void>(r => edge.close(() => r())); });
  const client = connectRelay({ publicUrl: `http://127.0.0.1:${port}`, token: 'a'.repeat(43), gatewayPort: 1, allowLocal: true, previews: () => { throw new Error('Registry unavailable'); } });
  clean.push(() => client.close());
  await expect.poll(() => replies).toContainEqual({ type: 'error', id: 1 });
  expect(replies).toContainEqual({ type: 'preview-targets', id: 0, targets: [] });
});
it('keeps an edge\'s session cookies off the tunnel and drops cookie Domain widening', () => {
  expect(edgeCookies({ cookie: 'zcc_mobile_session=a; theme=dark;; zcc_connect_session=b', accept: '*/*' })).toEqual({ cookie: 'theme=dark', accept: '*/*' });
  expect(edgeCookies({ cookie: 'zcc_mobile_session=a' })).toEqual({});
  expect(edgeCookies({ accept: '*/*' })).toEqual({ accept: '*/*' });
  expect(edgeCookies({ 'set-cookie': 'app=1; Domain=.example.com; Path=/' }, true)).toEqual({ 'set-cookie': ['app=1; Path=/'] });
  expect(edgeCookies({ 'set-cookie': ['zcc_connect_session=forged', '__Host-x=1'] }, true)).toEqual({});
});
