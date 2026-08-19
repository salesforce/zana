import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
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
    await expect(fetch(`${host.url}_zcc/health`).then((response) => response.json())).resolves.toEqual({ ok: true });
    await expect(fetch(`${host.url}../package.json`).then((response) => response.status)).resolves.toBe(404);

    const outside = join(tmpdir(), `zcc-static-host-outside-${Date.now()}.txt`);
    writeFileSync(outside, 'not renderer content');
    symlinkSync(outside, join(root, 'escaped.txt'));
    await expect(fetch(`${host.url}escaped.txt`).then((response) => response.status)).resolves.toBe(403);
  });
});
