import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { nextOriginFromEnv, proxyToNext, shouldSpawnNext } from './next-proxy.mjs';

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
