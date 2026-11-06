import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { startProductServer } from './product-server.js';

it('transports paired base64 assets intact and rejects RPC bodies above 3 MiB before dispatch', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'plugin-rpc-body-'));
  const server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 } });
  try {
    const first = Buffer.alloc(1024 * 1024, 17).toString('base64');
    const second = Buffer.alloc(1024 * 1024, 239).toString('base64');
    const callRpc = vi.fn(async (_id: string, _method: string, args: unknown) => {
      expect(args).toEqual({ first, second });
      return { bytes: [Buffer.from(first, 'base64').length, Buffer.from(second, 'base64').length] };
    });
    server.ctx.plugins = { snapshot: () => [], callRpc } as never;
    const call = (args: unknown) => fetch(`${server.url}api/v1/plugin-apps/custom-plugin/rpc`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'import', args })
    });
    const response = await call({ first, second });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ value: { bytes: [1024 * 1024, 1024 * 1024] } });
    const rejected = await call('x'.repeat(3 * 1024 * 1024));
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(callRpc).toHaveBeenCalledTimes(1);
  } finally { await server.close(); rmSync(dataDir, { recursive: true, force: true }); }
});
