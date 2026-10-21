import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SQUAD_RUNTIME_OPERATION_PATH } from '@zana-ai/zcc-contracts/runtime';
import { NATIVE_TOOL_POLICY_PROOF_HEADER, signNativeToolPolicyRequest } from './native-tool-policy-proof.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | undefined;
let dataDir: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe('startProductServer squad runtime route', () => {
  // Development main reaches the Modern squad runtime through this listener, not static-host.
  it('serves the signed main squad-runtime operation instead of a bodiless 404', async () => {
    const secret = 's'.repeat(64);
    dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-server-'));
    server = await startProductServer({ dataDir, uiSendSecret: secret, origins: { serverPort: 0, devAppPort: 5173 } });
    const url = `http://127.0.0.1:${server.port}${SQUAD_RUNTIME_OPERATION_PATH}`;
    const post = (body: string, proof?: string) => fetch(url, { method: 'POST', body,
      headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) } });

    const unsigned = await post('{}');
    expect(unsigned.status).toBe(403);
    expect(await unsigned.json()).toEqual({ error: 'squad runtime request is not signed by main' });

    const body = JSON.stringify({ operation: 'squad-runtime-preflight', request: {} });
    const malformed = await post(body, signNativeToolPolicyRequest(secret, body));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'invalid squad runtime operation' });
  });
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
