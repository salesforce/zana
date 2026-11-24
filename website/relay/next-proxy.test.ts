import { createServer, request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { nextOriginFromEnv, proxyToNext, resolveNextTarget, shouldSpawnNext } from './next-proxy.mjs';

let upstream: ReturnType<typeof createServer> | null = null;
let door: ReturnType<typeof createServer> | null = null;

afterEach(async () => {
  await Promise.all([
    new Promise<void>((resolve) => (upstream ? upstream.close(() => resolve()) : resolve())),
    new Promise<void>((resolve) => (door ? door.close(() => resolve()) : resolve()))
  ]);
  upstream = null;
  door = null;
});

describe('next-proxy helpers', () => {
  it('skips spawning Next when a loopback origin or skip flag is set', () => {
    expect(shouldSpawnNext({ ZCC_SKIP_NEXT: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldSpawnNext({ ZCC_NEXT_ORIGIN: 'http://127.0.0.1:9' } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldSpawnNext({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('reads the Next origin from env', () => {
    expect(nextOriginFromEnv({ ZCC_NEXT_ORIGIN: 'http://127.0.0.1:4322/' } as NodeJS.ProcessEnv)).toBe(
      'http://127.0.0.1:4322'
    );
    expect(nextOriginFromEnv({ ZCC_NEXT_PORT: '9999' } as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:9999');
    expect(nextOriginFromEnv({} as NodeJS.ProcessEnv)).toBe('http://127.0.0.1:4322');
  });

  describe('resolveNextTarget', () => {
    const origin = 'http://127.0.0.1:4322';

    it('keeps origin-form paths and queries on the Next origin', () => {
      expect(resolveNextTarget('/docs/?a=1', origin)?.href).toBe('http://127.0.0.1:4322/docs/?a=1');
      expect(resolveNextTarget(undefined, origin)?.href).toBe('http://127.0.0.1:4322/');
      expect(resolveNextTarget('/a/../b', origin)?.pathname).toBe('/b');
    });

    it.each([
      ['protocol-relative', '//evil.example/x'],
      ['backslash host', '/\\evil.example/x'],
      ['absolute-form http', 'http://evil.example/x'],
      ['absolute-form other scheme', 'file:///etc/passwd'],
      ['authority-form', 'evil.example:443'],
      ['bare path without slash', 'docs']
    ])('rejects %s request targets', (_label, target) => {
      expect(resolveNextTarget(target, origin)).toBeNull();
    });

    it('never resolves to a different origin, even after dot-segment normalization', () => {
      for (const target of ['/.//evil.example/x', '/a/..//evil.example/x', '/%2F%2Fevil.example/x']) {
        const resolved = resolveNextTarget(target, origin);
        if (resolved) expect(resolved.origin).toBe('http://127.0.0.1:4322');
      }
    });
  });

  it('answers 400 and never contacts another host for a protocol-relative target', async () => {
    let evilHits = 0;
    const evil = createServer((_request, response) => {
      evilHits += 1;
      response.end('evil');
    });
    await new Promise<void>((resolve) => evil.listen(0, '127.0.0.1', () => resolve()));
    const evilAddress = evil.address();
    if (!evilAddress || typeof evilAddress === 'string') throw new Error('evil did not bind');

    upstream = createServer((_request, response) => response.end('next'));
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', () => resolve()));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') throw new Error('upstream did not bind');
    const origin = `http://127.0.0.1:${upstreamAddress.port}`;

    door = createServer((request, response) => proxyToNext(request, response, origin));
    await new Promise<void>((resolve) => door!.listen(0, '127.0.0.1', () => resolve()));
    const doorAddress = door.address();
    if (!doorAddress || typeof doorAddress === 'string') throw new Error('door did not bind');

    try {
      const statuses = await Promise.all(
        [`//127.0.0.1:${evilAddress.port}/x`, `/.//127.0.0.1:${evilAddress.port}/x`].map(
          (path) =>
            new Promise<number>((resolve, reject) => {
              const req = httpRequest({ host: '127.0.0.1', port: doorAddress.port, path }, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
              });
              req.on('error', reject);
              req.end();
            })
        )
      );
      expect(statuses[0]).toBe(400);
      expect(evilHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => evil.close(() => resolve()));
    }
  });

  it('proxies marketing HTTP to Next without a 308', async () => {
    upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html>docs</html>');
    });
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', () => resolve()));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('upstream did not bind');
    const origin = `http://127.0.0.1:${address.port}`;

    door = createServer((request, response) => proxyToNext(request, response, origin));
    await new Promise<void>((resolve) => door!.listen(0, '127.0.0.1', () => resolve()));
    const doorAddress = door.address();
    if (!doorAddress || typeof doorAddress === 'string') throw new Error('door did not bind');

    const response = await fetch(`http://127.0.0.1:${doorAddress.port}/docs/`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    await expect(response.text()).resolves.toContain('docs');
  });
});
