import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe('startProductServer pairing forwarder', () => {
  it('exposes an allowlist-only pairing port and releases it on close', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-server-'));
    server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
    const pairingPort = server.ctx.origins.pairingPort;
    expect(pairingPort).toBeGreaterThan(0);
    expect(pairingPort).not.toBe(server.port);

    const denied = await fetch(`http://127.0.0.1:${pairingPort}/api/v1/projects`);
    expect(denied.status).toBe(403);

    const ctx = server.ctx;
    await server.close();
    server = undefined;
    expect(ctx.origins.pairingPort).toBeUndefined();
    await expect(fetch(`http://127.0.0.1:${pairingPort}/install.sh`)).rejects.toThrow();
  });
});
