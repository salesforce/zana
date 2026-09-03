import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startStaticHost, type StaticHost } from './static-host.js';

let host: StaticHost | null = null;

afterEach(async () => {
  await host?.close();
  host = null;
});

describe('startStaticHost', () => {
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
});
