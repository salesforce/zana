import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
