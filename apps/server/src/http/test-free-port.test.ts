import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { reserveFreePort } from './test-free-port.js';

async function bindAndClose(port: number): Promise<void> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve) => listener.close(() => resolve()));
}

describe('reserveFreePort', () => {
  it('returns a valid port that can be bound right away', async () => {
    const port = await reserveFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
    await expect(bindAndClose(port)).resolves.toBeUndefined();
  });

  it('can be called repeatedly and releases each port', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(bindAndClose(await reserveFreePort())).resolves.toBeUndefined();
    }
  });
});
