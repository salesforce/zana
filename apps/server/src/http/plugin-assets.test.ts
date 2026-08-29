import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isPluginAssetPath, tryServePluginAsset } from './plugin-assets.js';

describe('isPluginAssetPath', () => {
  it('matches renderer bundles and ignores SPA plugin panel routes', () => {
    expect(isPluginAssetPath('/plugins/ask-user-question/assets/app.js')).toBe(true);
    expect(isPluginAssetPath('/plugins/tasks/assets/dist/app.js?v=42')).toBe(true);
    expect(isPluginAssetPath('/plugins/provider-claude-code/assets/app.tsx?import&v=1')).toBe(true);
    expect(isPluginAssetPath('/plugins/github/main')).toBe(false);
    expect(isPluginAssetPath('/plugins/github/issues/org/repo/42')).toBe(false);
    expect(isPluginAssetPath('/api/v1/plugin-apps')).toBe(false);
    expect(isPluginAssetPath('http://[')).toBe(false);
  });
});

describe('tryServePluginAsset', () => {
  const servers: Array<{ close: () => Promise<void>; url: string }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function listen(root: string, id = 'notes') {
    const http = createServer((request, response) => {
      void tryServePluginAsset(request, response, (pluginId) => (pluginId === id ? root : null)).then((handled) => {
        if (!handled) response.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', () => {
        http.off('error', reject);
        resolve();
      });
    });
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const url = `http://127.0.0.1:${address.port}/`;
    servers.push({
      url,
      close: () =>
        new Promise((resolve, reject) => {
          http.close((error) => (error ? reject(error) : resolve()));
        })
    });
    return url;
  }

  it('serves a contained plugin file and refuses sibling/escape paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-plugin-asset-'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'app.js'), 'export default 1;');
    writeFileSync(join(root, 'secret.txt'), 'nope');
    const outside = join(tmpdir(), `zcc-plugin-asset-outside-${Date.now()}.txt`);
    writeFileSync(outside, 'escaped');
    symlinkSync(outside, join(root, 'escaped.txt'));

    const url = await listen(root);
    await expect(fetch(`${url}plugins/notes/assets/dist/app.js`).then((r) => r.text())).resolves.toBe(
      'export default 1;'
    );
    await expect(
      fetch(`${url}plugins/notes/assets/dist/app.js`, { method: 'HEAD' }).then((r) => r.status)
    ).resolves.toBe(200);
    await expect(fetch(`${url}plugins/notes/assets/missing.js`).then((r) => r.status)).resolves.toBe(404);
    await expect(fetch(`${url}plugins/notes/assets/%2e%2e%2fsecret.txt`).then((r) => r.status)).resolves.toBe(400);
    await expect(fetch(`${url}plugins/notes/assets/foo%2`).then((r) => r.status)).resolves.toBe(400);
    await expect(fetch(`${url}plugins/notes/assets/../secret.txt`).then((r) => r.status)).resolves.toBe(404);
    await expect(fetch(`${url}plugins/notes/assets/escaped.txt`).then((r) => r.status)).resolves.toBe(403);
    await expect(fetch(`${url}plugins/missing/assets/app.js`).then((r) => r.status)).resolves.toBe(404);
    await expect(fetch(`${url}plugins/notes/main`).then((r) => r.status)).resolves.toBe(404);
  });

  it('serves playground html, wasm, and font MIME types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-plugin-asset-mime-'));
    mkdirSync(join(root, 'playground', 'dist'), { recursive: true });
    writeFileSync(join(root, 'playground', 'index.html'), '<!doctype html><title>ide</title>');
    writeFileSync(join(root, 'playground', 'dist', 'index.html'), '<!doctype html><title>playground</title>');
    writeFileSync(join(root, 'playground', 'parser.wasm'), Buffer.from([0, 97, 115, 109]));
    writeFileSync(join(root, 'playground', 'editor.woff2'), Buffer.from([1, 2, 3]));
    writeFileSync(join(root, 'playground', 'legacy.woff'), Buffer.from([4, 5, 6]));
    writeFileSync(join(root, 'playground', 'codicon.ttf'), Buffer.from([7, 8, 9]));

    const url = await listen(root, 'salesforce');
    const html = await fetch(`${url}plugins/salesforce/assets/playground/index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(html.text()).resolves.toContain('<!doctype html>');

    const distHtml = await fetch(`${url}plugins/salesforce/assets/playground/dist/index.html`);
    expect(distHtml.status).toBe(200);
    expect(distHtml.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(distHtml.text()).resolves.toContain('playground');

    const wasm = await fetch(`${url}plugins/salesforce/assets/playground/parser.wasm`);
    expect(wasm.status).toBe(200);
    expect(wasm.headers.get('content-type')).toBe('application/wasm');

    const woff2 = await fetch(`${url}plugins/salesforce/assets/playground/editor.woff2`);
    expect(woff2.status).toBe(200);
    expect(woff2.headers.get('content-type')).toBe('font/woff2');

    const woff = await fetch(`${url}plugins/salesforce/assets/playground/legacy.woff`);
    expect(woff.status).toBe(200);
    expect(woff.headers.get('content-type')).toBe('font/woff');

    const ttf = await fetch(`${url}plugins/salesforce/assets/playground/codicon.ttf`);
    expect(ttf.status).toBe(200);
    expect(ttf.headers.get('content-type')).toBe('font/ttf');
  });

  it('ignores non-GET methods and malformed URLs', async () => {
    const response = { writeHead() {}, end() {} } as unknown as ServerResponse;
    await expect(
      tryServePluginAsset({ method: 'POST', url: '/plugins/notes/assets/app.js' } as IncomingMessage, response, () => '/')
    ).resolves.toBe(false);
    await expect(
      tryServePluginAsset({ method: 'GET', url: 'http://[' } as IncomingMessage, response, () => '/')
    ).resolves.toBe(false);
  });
});
