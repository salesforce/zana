import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startStaticHost, type StaticHost } from './static-host.js';
import { startPairingForwarder } from './http/pairing-forwarder.js';

vi.mock('./http/pairing-forwarder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http/pairing-forwarder.js')>();
  return { ...actual, startPairingForwarder: vi.fn(actual.startPairingForwarder) };
});

let host: StaticHost | null = null;
const mediaRoots: string[] = [];

afterEach(async () => {
  await host?.close();
  host = null;
  for (const root of mediaRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('startStaticHost', () => {
  it.each([
    ['walkthrough.mp4', 'video/mp4'],
    ['walkthrough.jpg', 'image/jpeg'],
    ['walkthrough.en.vtt', 'text/vtt; charset=utf-8'],
  ])('serves bundled release media %s with its browser MIME type', async (name, mime) => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-release-media-'));
    mediaRoots.push(root);
    writeFileSync(join(root, 'index.html'), '<main>Release notes</main>');
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', name), 'bundled media');
    host = await startStaticHost({ rootDir: root });
    const response = await fetch(`${host.url}assets/${name}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(mime);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-length')).toBe('13');
    expect(await response.text()).toBe('bundled media');
  });

  it.each([
    ['bytes=2-5', 206, 'cdef', 'bytes 2-5/10'],
    ['bytes=7-', 206, 'hij', 'bytes 7-9/10'],
    ['bytes=-3', 206, 'hij', 'bytes 7-9/10'],
    ['bytes=0-999', 206, 'abcdefghij', 'bytes 0-9/10'],
    ['bytes=10-', 416, '', 'bytes */10'],
    ['bytes=5-2', 416, '', 'bytes */10'],
    ['bytes=0-1,4-5', 416, '', 'bytes */10'],
  ])('supports seeking in bundled video: %s', async (range, status, body, contentRange) => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-release-media-'));
    mediaRoots.push(root);
    writeFileSync(join(root, 'index.html'), '<main>Release notes</main>');
    writeFileSync(join(root, 'walkthrough.mp4'), 'abcdefghij');
    host = await startStaticHost({ rootDir: root });
    const response = await fetch(`${host.url}walkthrough.mp4`, { headers: { Range: range } });
    expect(response.status).toBe(status);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(body.length));
    expect(await response.text()).toBe(body);
    const head = await fetch(`${host.url}walkthrough.mp4`, { method: 'HEAD', headers: { Range: range } });
    expect(head.status).toBe(status);
    expect(head.headers.get('content-range')).toBe(contentRange);
    expect(await head.text()).toBe('');
  });

  it('keeps range requests confined to the trusted renderer root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-release-media-'));
    mediaRoots.push(root);
    const outside = mkdtempSync(join(tmpdir(), 'zcc-release-media-outside-'));
    mediaRoots.push(outside);
    writeFileSync(join(root, 'index.html'), '<main>Release notes</main>');
    writeFileSync(join(outside, 'private.mp4'), 'private content');
    symlinkSync(join(outside, 'private.mp4'), join(root, 'escape.mp4'));
    host = await startStaticHost({ rootDir: root });
    const response = await fetch(`${host.url}escape.mp4`, { headers: { Range: 'bytes=0-2' } });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private');
  });

  it('serves the trusted renderer and does not expose paths outside its root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    host = await startStaticHost({ rootDir: root });

    await expect(fetch(host.url).then((response) => response.text())).resolves.toContain('zana');
    await expect(fetch(host.url).then((response) => response.headers.get('cache-control'))).resolves.toBe(
      'no-store'
    );
    await expect(fetch(`${host.url}_zcc/health`).then((response) => response.json())).resolves.toEqual({ ok: true });
    await expect(fetch(`${host.url}../package.json`).then((response) => response.status)).resolves.toBe(404);

    const outside = join(tmpdir(), `zcc-static-host-outside-${Date.now()}.txt`);
    writeFileSync(outside, 'not renderer content');
    symlinkSync(outside, join(root, 'escaped.txt'));
    await expect(fetch(`${host.url}escaped.txt`).then((response) => response.status)).resolves.toBe(403);
  });

  it('exposes only an explicit same-origin browser bootstrap projection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    host = await startStaticHost({
      rootDir: root,
      browserBootstrap: () => ({
        appVersion: '1.2.3',
        projects: [{ id: 'project-1', name: 'Project one', color: '#2f81f7' }]
      })
    });

    const response = await fetch(`${host.url}_zcc/bootstrap`);
    await expect(response.json()).resolves.toEqual({
      appVersion: '1.2.3',
      projects: [{ id: 'project-1', name: 'Project one', color: '#2f81f7' }]
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(fetch(`${host.url}_zcc/bootstrap`, {
      headers: { Origin: 'http://untrusted.example' }
    }).then((result) => result.status)).resolves.toBe(403);
  });

  it('refuses to expose browser bootstrap outside loopback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');

    await expect(startStaticHost({
      rootDir: root,
      host: '0.0.0.0',
      browserBootstrap: () => ({ appVersion: '', projects: [] })
    })).rejects.toThrow('loopback');
  });

  it('serves a contained nested plugin asset without exposing sibling paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    const pluginRoot = mkdtempSync(join(tmpdir(), 'zcc-plugin-assets-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    mkdirSync(join(pluginRoot, 'dist'), { recursive: true });
    writeFileSync(join(pluginRoot, 'dist', 'renderer.js'), 'export default 42;');
    host = await startStaticHost({
      rootDir: root,
      pluginAssetRoot: (id) => (id === 'tasks' ? pluginRoot : null)
    });

    await expect(
      fetch(`${host.url}plugins/tasks/assets/dist/renderer.js?v=42`).then((response) => response.text())
    ).resolves.toBe('export default 42;');
    await expect(
      fetch(`${host.url}plugins/tasks/assets/../package.json`).then((response) => response.status)
    ).resolves.toBe(404);
  });

  it('falls back to index.html for unknown extensionless paths so client routes load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    host = await startStaticHost({ rootDir: root });

    const inbox = await fetch(`${host.url}inbox`);
    expect(inbox.status).toBe(200);
    expect(inbox.headers.get('cache-control')).toBe('no-store');
    await expect(inbox.text()).resolves.toContain('zana');

    const project = await fetch(`${host.url}projects/proj-1/terminals`);
    expect(project.status).toBe(200);
    await expect(project.text()).resolves.toContain('zana');

    await expect(fetch(`${host.url}missing.js`).then((response) => response.status)).resolves.toBe(404);
    await expect(fetch(`${host.url}_zcc/health`).then((response) => response.json())).resolves.toEqual({
      ok: true
    });
  });

  it('reloads plugin panel routes whose sub-path names a file, but not missing plugin assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    host = await startStaticHost({ rootDir: root });

    for (const route of ['plugins/design-docs/design-docs/dd_1/spec/api.md', 'plugins/docs/panel/global/notes.md']) {
      const response = await fetch(`${host.url}${route}`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('zana');
    }
    // Without an asset resolver, an asset path still is not an application page.
    await expect(fetch(`${host.url}plugins/tasks/assets/app.js`).then((response) => response.status)).resolves.toBe(404);
    // A panel root with an extension is not a plugin route shape.
    await expect(fetch(`${host.url}plugins/tasks/app.js`).then((response) => response.status)).resolves.toBe(404);
  });

  it('pins the document base so a nested client route reloads its relative assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(
      join(root, 'index.html'),
      '<!DOCTYPE html><html><head><title>Zana</title><script src="./assets/index-abc.js"></script></head><body></body></html>'
    );
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets', 'index-abc.js'), 'export default 1;');
    host = await startStaticHost({ rootDir: root });

    // Without a pinned base, `./assets/index-abc.js` on `/settings/global`
    // resolves to `/settings/assets/index-abc.js`, which does not exist.
    const nested = await fetch(`${host.url}settings/global`);
    expect(nested.status).toBe(200);
    await expect(nested.text()).resolves.toContain('<head><base href="/">');
    await expect(
      fetch(`${host.url}settings/assets/index-abc.js`).then((response) => response.status)
    ).resolves.toBe(404);

    await expect(fetch(host.url).then((response) => response.text())).resolves.toContain('<base href="/">');
    await expect(
      fetch(`${host.url}assets/index-abc.js`).then((response) => response.text())
    ).resolves.toBe('export default 1;');
  });

  it('leaves index markup untouched when it declares no head or its own base', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    host = await startStaticHost({ rootDir: root });
    await expect(fetch(host.url).then((response) => response.text())).resolves.toBe('<main>zana</main>');
    await host.close();

    const scoped = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(scoped, 'index.html'), '<html><head><base href="/ui/"></head></html>');
    host = await startStaticHost({ rootDir: scoped });
    const body = await fetch(host.url).then((response) => response.text());
    expect(body).toContain('<base href="/ui/">');
    expect(body).not.toContain('<base href="/">');
  });

  it('serves the loopback product API beside renderer assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    host = await startStaticHost({ rootDir: root, product });

    await expect(fetch(`${host.url}api/v1/health`).then((response) => response.json())).resolves.toEqual({
      ok: true
    });
    await expect(fetch(`${host.url}install.sh`).then((response) => response.status)).resolves.toBe(200);
    await expect(fetch(host.url).then((response) => response.text())).resolves.toContain('zana');
    expect(readFileSync(join(dataDir, 'host-enroll.token'), 'utf8').trim()).toBe(product.enrollToken);
    product.hostHub.close();
    product.db.close();
  });

  it('routes main squad runtime operations to the signed handler, not the static 405', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    host = await startStaticHost({ rootDir: root, product });
    const url = `${host.url}internal/main/squad-runtime`;
    const post = (headers: Record<string, string> = {}) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}'
    }).then(async (response) => ({ status: response.status, body: await response.json() }));

    await expect(fetch(url).then((response) => response.status)).resolves.toBe(405);
    await expect(post({ origin: host.url.replace(/\/$/, '') })).resolves.toEqual({
      status: 403, body: { error: 'squad runtime requires trusted local main' }
    });
    await expect(post()).resolves.toEqual({ status: 403, body: { error: 'squad runtime request is not signed by main' } });
    product.hostHub.close();
    product.db.close();
  });

  it('exposes an allowlist-only pairing port for SSH tunnels and closes it on shutdown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    host = await startStaticHost({ rootDir: root, product });

    const pairingPort = product.origins.pairingPort;
    expect(pairingPort).toBeGreaterThan(0);
    expect(pairingPort).not.toBe(product.origins.serverPort);
    const pairingUrl = `http://127.0.0.1:${pairingPort}`;
    await expect(fetch(`${pairingUrl}/install.sh`).then((response) => response.status)).resolves.toBe(200);
    await expect(fetch(`${pairingUrl}/api/v1/health`).then((response) => response.status)).resolves.toBe(403);
    await expect(fetch(`${pairingUrl}/api/v1/projects`).then((response) => response.status)).resolves.toBe(403);

    await host.close();
    host = null;
    expect(product.origins.pairingPort).toBeUndefined();
    await expect(fetch(`${pairingUrl}/install.sh`)).rejects.toThrow();
    product.hostHub.close();
    product.db.close();
  });

  it('keeps serving when the pairing forwarder cannot start', async () => {
    vi.mocked(startPairingForwarder).mockRejectedValueOnce(new Error('bind failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    host = await startStaticHost({ rootDir: root, product });

    expect(product.origins.pairingPort).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pairing forwarder failed to start: bind failed'));
    await expect(fetch(`${host.url}api/v1/health`).then((response) => response.status)).resolves.toBe(200);
    warn.mockRestore();
    product.hostHub.close();
    product.db.close();
  });

  it('stringifies non-Error forwarder failures and binds the forwarder to the IPv4 product loopback', async () => {
    vi.mocked(startPairingForwarder).mockRejectedValueOnce('plain failure');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    host = await startStaticHost({ rootDir: root, product });

    expect(vi.mocked(startPairingForwarder).mock.calls.at(-1)?.[1]).toEqual({ productHost: '127.0.0.1' });
    expect(warn).toHaveBeenCalledWith('[zcc] pairing forwarder failed to start: plain failure');
    warn.mockRestore();
    product.hostHub.close();
    product.db.close();
  });

  it('refuses an IPv6 product host before binding: the local peer app is IPv4-loopback only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    const calls = vi.mocked(startPairingForwarder).mock.calls.length;
    await expect(startStaticHost({ rootDir: root, product, host: '::1' })).rejects.toThrow('local peer app requires an IPv4 loopback host');
    expect(vi.mocked(startPairingForwarder).mock.calls.length).toBe(calls);
    product.dispose();
    product.hostHub.close();
    product.db.close();
  });

  it('keeps a pairing port it does not own when closing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-product-'));
    const product = createProductHttpContext({ dataDir, origins: { serverPort: 0 } });
    host = await startStaticHost({ rootDir: root, product });
    const ownPort = product.origins.pairingPort;
    product.origins.pairingPort = 1;
    await host.close();
    host = null;
    expect(product.origins.pairingPort).toBe(1);
    expect(ownPort).not.toBe(1);
    product.hostHub.close();
    product.db.close();
  });

  it('accepts daemon host enroll and websocket hello beside renderer assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');
    const { createProductHttpContext } = await import('./http/product-context.js');
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-static-enroll-'));
    const enrollToken = 'enroll-token-enroll-token-enroll';
    const product = createProductHttpContext({
      dataDir,
      enrollToken,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    host = await startStaticHost({ rootDir: root, product });

    const instanceId = randomUUID();
    await expect(fetch(`${host.url}internal/hosts/enroll`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrollToken}`,
        origin: 'http://untrusted.example',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostName: 'static-host-test',
        instanceId
      })
    }).then((response) => response.status)).resolves.toBe(403);

    const response = await fetch(`${host.url}internal/hosts/enroll`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrollToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostName: 'static-host-test',
        instanceId
      })
    });
    expect(response.status).toBe(201);
    const enrolled = await response.json() as { hostId: string; hostKey: string };

    const url = new URL('internal/hosts/ws', host.url.replace(/^http/, 'ws'));
    url.searchParams.set('hostId', enrolled.hostId);
    url.searchParams.set('hostKey', enrolled.hostKey);
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.on('message', raw => {
      if (JSON.parse(String(raw)).type === 'host.hello-ok') socket.send(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, runtime: { threads: [], loadedEnvironments: [] } }));
    });
    socket.send(JSON.stringify({
      type: 'host.hello',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId
    }));
    await expect.poll(() => product.hostHub.connectedHostIds()).toContain(enrolled.hostId);
    const listed = await fetch(`${host.url}api/v1/hosts`).then((response) => response.json()) as Array<{
      id: string;
      status: string;
      lastSeenAt: number | null;
    }>;
    const row = listed.find((item) => item.id === enrolled.hostId);
    expect(row?.status).toBe('connected');
    expect(Date.now() - (row?.lastSeenAt ?? 0)).toBeLessThan(10_000);
    socket.close();
    product.hostHub.close();
    product.db.close();
  });

  it('binds a preferred port and falls back to ephemeral when that port is taken', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-static-host-'));
    writeFileSync(join(root, 'index.html'), '<main>zana</main>');

    const blocker = createServer();
    const occupied = await new Promise<number>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', () => {
        const addr = blocker.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('blocker did not bind'));
          return;
        }
        resolve(addr.port);
      });
    });

    host = await startStaticHost({ rootDir: root, port: occupied });
    const bound = Number(new URL(host.url).port);
    expect(bound).not.toBe(occupied);
    expect(bound).toBeGreaterThan(0);
    await expect(fetch(`${host.url}_zcc/health`).then((r) => r.json())).resolves.toEqual({ ok: true });
    await host.close();
    host = null;
    await new Promise<void>((resolve, reject) => {
      blocker.close((err) => (err ? reject(err) : resolve()));
    });

    host = await startStaticHost({ rootDir: root, port: occupied });
    expect(Number(new URL(host.url).port)).toBe(occupied);
  });
  it('tracks API requests until the response starts, without query strings', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-diagnostics-'));
    mediaRoots.push(root);
    writeFileSync(join(root, 'index.html'), '<main>App</main>');
    const tracked: string[] = [];
    let ended = 0;
    host = await startStaticHost({
      rootDir: root,
      diagnostics: { track: (label) => { tracked.push(label); return () => { ended++; }; } }
    });
    const api = await fetch(`${host.url}api/v1/threads/98c8a9af-4fe0-4d13-ab55-ae8554916f1f/timeline?token=secret`, { method: 'POST' });
    await api.text();
    const page = await fetch(`${host.url}index.html`);
    await page.text();
    expect(tracked).toEqual(['POST /api/v1/threads/:id/timeline']);
    expect(ended).toBe(1);
  });
});
