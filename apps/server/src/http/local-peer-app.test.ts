import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { afterEach, expect, it, vi } from 'vitest';
import { createStoredLocalPeerAppResolver } from '@zana-ai/zcc-host-daemon/peer-forward';
import { registerBoundLocalPeerApp } from './local-peer-app.js';
import { startProductServer, type ProductServer } from './product-server.js';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';
import { startStaticHost, type StaticHost } from '../static-host.js';

const roots: string[] = [], servers: Server[] = [], products: ProductServer[] = [], hosts: StaticHost[] = [], contexts: ProductHttpContext[] = [];
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'zcc-local-peer-')); roots.push(dir); return dir; };
const resolvePort = (dir: string) => createStoredLocalPeerAppResolver(dir)(new AbortController().signal);
async function listener(host = '127.0.0.1') {
  const server = createServer((_req, res) => res.end('local')); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  return server;
}
const closeListener = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
afterEach(async () => {
  for (const product of products.splice(0)) await product.close();
  for (const host of hosts.splice(0)) await host.close();
  for (const context of contexts.splice(0)) { context.hostHub.close(); context.dispose(); context.db.close(); }
  for (const server of servers.splice(0)) await closeListener(server);
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('publishes only real bound IPv4 loopback listeners; retirement precedes socket close', async () => {
  const dir = root(), unbound = createServer(); servers.push(unbound);
  await expect(registerBoundLocalPeerApp(unbound, dir, randomUUID())).rejects.toThrow('bound IPv4 loopback');
  const publicListener = await listener('0.0.0.0');
  await expect(registerBoundLocalPeerApp(publicListener, dir, randomUUID())).rejects.toThrow('bound IPv4 loopback');
  expect(existsSync(join(dir, 'peer-app'))).toBe(false);
  const bound = await listener(), remove = await registerBoundLocalPeerApp(bound, dir, randomUUID());
  expect(await resolvePort(dir)).toBe((bound.address() as { port: number }).port);
  await Promise.all([remove(), remove()]);
  expect(bound.listening).toBe(true);
  expect(await resolvePort(dir)).toBeNull();
});

it.each(['close', 'error'])('removes registration on unexpected listener %s', async event => {
  const dir = root(), bound = await listener();
  const remove = await registerBoundLocalPeerApp(bound, dir, randomUUID());
  if (event === 'close') await closeListener(bound); else bound.emit('error', new Error('listener failed'));
  await vi.waitFor(async () => expect(await resolvePort(dir)).toBeNull());
  await remove();
});

it('old owner shutdown never removes replacement registration', async () => {
  const dir = root(), id = randomUUID(), first = await listener(), second = await listener();
  const oldRemove = await registerBoundLocalPeerApp(first, dir, id);
  const newRemove = await registerBoundLocalPeerApp(second, dir, id);
  await oldRemove();
  expect(await resolvePort(dir)).toBe((second.address() as { port: number }).port);
  await newRemove();
  expect(await resolvePort(dir)).toBeNull();
});

it('retires publication if shutdown races asynchronous registration', async () => {
  const dir = root(), bound = await listener();
  const registration = registerBoundLocalPeerApp(bound, dir, randomUUID());
  await closeListener(bound);
  await expect(registration).rejects.toThrow('closed during registration');
  expect(await resolvePort(dir)).toBeNull();
});

it('product instances register their own routes independently, restart identity stays stable', async () => {
  const dirA = root(), dirB = root();
  const a = await startProductServer({ dataDir: dirA, origins: { serverPort: 1 } }); products.push(a);
  const b = await startProductServer({ dataDir: dirB, origins: { serverPort: a.port } }); products.push(b);
  expect(await resolvePort(dirA)).toBe(a.port);
  expect(await resolvePort(dirB)).toBe(b.port);
  expect(a.ctx.productInstanceId).not.toBe(b.ctx.productInstanceId);
  expect(JSON.parse(readFileSync(join(dirB, 'peer-app', 'endpoint.json'), 'utf8')).instanceId).toBe(b.ctx.productInstanceId);
  expect((await fetch(`${b.url}api/v1/health`)).status).toBe(200);
  await Promise.all([a.close(), a.close()]);
  expect(await resolvePort(dirA)).toBeNull();
  expect(await resolvePort(dirB)).toBe(b.port);
  const restarted = await startProductServer({ dataDir: dirA, origins: { serverPort: 0 } }); products.push(restarted);
  expect(restarted.ctx.productInstanceId).toBe(a.ctx.productInstanceId);
  expect(await resolvePort(dirA)).toBe(restarted.port);
});

it('product bind failure closes without publishing; a registration failure keeps serving unpublished', async () => {
  const occupied = await listener(), dir = root();
  await expect(startProductServer({ dataDir: dir, port: (occupied.address() as { port: number }).port, origins: { serverPort: 0 } })).rejects.toMatchObject({ code: 'EADDRINUSE' });
  expect(await resolvePort(dir)).toBeNull();
  // A file is never a trusted registration directory, on any platform.
  writeFileSync(join(dir, 'peer-app'), '');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const unpublished = await startProductServer({ dataDir: dir, origins: { serverPort: 0 } });
  expect(warn).toHaveBeenCalledWith('[zcc] local peer app registration failed: untrusted local peer app registration directory');
  warn.mockRestore();
  expect((await fetch(`${unpublished.url}api/v1/health`)).status).toBe(200);
  expect(await resolvePort(dir)).toBeNull();
  await unpublished.close();
  rmSync(join(dir, 'peer-app'));
  const product = await startProductServer({ dataDir: dir, origins: { serverPort: 0 } }); products.push(product);
  expect(await resolvePort(dir)).toBe(product.port);
});

it('static product listener publishes actual fallback port and cleans up on close', async () => {
  const dir = root(), renderer = root(), occupied = await listener();
  writeFileSync(join(renderer, 'index.html'), '<main>test</main>');
  const product = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } }); contexts.push(product);
  const host = await startStaticHost({ rootDir: renderer, product, port: (occupied.address() as { port: number }).port }); hosts.push(host);
  expect(await resolvePort(dir)).toBe(Number(new URL(host.url).port));
  expect(await resolvePort(dir)).not.toBe((occupied.address() as { port: number }).port);
  expect((await fetch(`${host.url}api/v1/health`)).status).toBe(200);
  await Promise.all([host.close(), host.close()]);
  expect(await resolvePort(dir)).toBeNull();
});

it('static listener without product never publishes, product rejects public and IPv6 bind', async () => {
  const dir = root(), renderer = root(); writeFileSync(join(renderer, 'index.html'), '<main>test</main>');
  const host = await startStaticHost({ rootDir: renderer }); hosts.push(host);
  expect(await resolvePort(dir)).toBeNull();
  const product = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } }); contexts.push(product);
  for (const bind of ['0.0.0.0', '::1']) {
    await expect(startStaticHost({ rootDir: renderer, product, host: bind })).rejects.toThrow('IPv4 loopback');
    await expect(startProductServer({ dataDir: dir, host: bind, origins: { serverPort: 0 } })).rejects.toThrow('loopback');
  }
});

it('static registration failure keeps serving unpublished; a restart with a fresh context publishes', async () => {
  const dir = root(), renderer = root(); writeFileSync(join(renderer, 'index.html'), '<main>test</main>');
  writeFileSync(join(dir, 'peer-app'), '');
  const product = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } }); contexts.push(product);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const unpublished = await startStaticHost({ rootDir: renderer, product });
  expect(warn).toHaveBeenCalledWith('[zcc] local peer app registration failed: untrusted local peer app registration directory');
  warn.mockRestore();
  expect((await fetch(`${unpublished.url}api/v1/health`)).status).toBe(200);
  expect(await resolvePort(dir)).toBeNull();
  await unpublished.close();
  rmSync(join(dir, 'peer-app'));
  const next = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 } }); contexts.push(next);
  const host = await startStaticHost({ rootDir: renderer, product: next }); hosts.push(host);
  expect(await resolvePort(dir)).toBe(Number(new URL(host.url).port));
});

it('product fallback and websocket connections retain one registration; shutdown closes active clients', async () => {
  const dir = root(), product = await startProductServer({ dataDir: dir, origins: { serverPort: 0 },
    fallback: (request, response) => {
      if (request.url !== '/fallback') return false;
      response.end('fallback'); return true;
    } }); products.push(product);
  expect(await fetch(`${product.url}fallback`).then(res => res.text())).toBe('fallback');
  expect(await fetch(`${product.url}missing`).then(res => res.status)).toBe(404);
  const unknown = new WebSocket(new URL('unknown', product.url.replace('http:', 'ws:')));
  unknown.on('error', () => {});
  await new Promise<void>(resolve => unknown.once('unexpected-response', (_request, response) => { expect(response.statusCode).toBe(404); response.resume(); unknown.terminate(); resolve(); }));
  const client = new WebSocket(new URL('ws', product.url.replace('http:', 'ws:')));
  await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  expect(await resolvePort(dir)).toBe(product.port);
  const closed = new Promise<void>(resolve => client.once('close', () => resolve()));
  await product.close(); await closed;
  expect(await resolvePort(dir)).toBeNull();
});

it('product without fallback returns 404 for non-API paths', async () => {
  const product = await startProductServer({ dataDir: root(), origins: { serverPort: 0 } }); products.push(product);
  expect(await fetch(`${product.url}missing`).then(res => res.status)).toBe(404);
});
