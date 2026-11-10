import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_TOOL_POLICY_INVENTORY_PATH,
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  signNativeToolPolicyRequest
} from './native-tool-policy-proof.js';
import type { ProductHttpContext } from './product-context.js';
import { startProductServer, type ProductServer } from './product-server.js';

const secret = 'c'.repeat(64);

let server: ProductServer | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot(readiness: unknown, uiSendSecret: string | null = secret) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-native-tool-policy-inventory-api-'));
  dirs.push(dataDir);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: uiSendSecret ?? undefined });
  const toolPolicyReadiness = vi.fn(async () => readiness);
  server.ctx.plugins = { toolPolicyReadiness } as unknown as ProductHttpContext['plugins'];
  return { server, toolPolicyReadiness };
}

async function post(url: string, body: string, proof?: string) {
  const response = await fetch(new URL(NATIVE_TOOL_POLICY_INVENTORY_PATH, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) },
    body
  });
  return { status: response.status, json: await response.json() as unknown };
}

// OBL-018 pre-spawn readiness over the signed product route (electron-vite dev,
// where no runtime supervisor carries the read). Body is empty; the proof binds
// that empty body.
describe('POST /api/v1/native-tool-policy-inventory (pre-spawn readiness without a supervisor)', () => {
  it('returns the plugin readiness for an empty body main signed', async () => {
    const readiness = { ready: false, required: [{ pluginId: 'acme', toolPolicy: 'true', status: 'running', sealed: true }] };
    const { server, toolPolicyReadiness } = await boot(readiness);
    await expect(post(server.url, '', signNativeToolPolicyRequest(secret, ''))).resolves.toEqual({
      status: 200, json: readiness
    });
    expect(toolPolicyReadiness).toHaveBeenCalledTimes(1);
  });

  it('refuses an unsigned, mis-signed or replayed request without asking plugins', async () => {
    const { server, toolPolicyReadiness } = await boot({ ready: true, required: [] });
    const proof = signNativeToolPolicyRequest(secret, '');
    expect((await post(server.url, '')).status).toBe(403);
    expect((await post(server.url, '', signNativeToolPolicyRequest('x'.repeat(64), ''))).status).toBe(403);
    expect((await post(server.url, '', proof)).status).toBe(200);
    expect((await post(server.url, '', proof)).status).toBe(403);
    expect(toolPolicyReadiness).toHaveBeenCalledTimes(1);
  });

  it('refuses every request on a server without the desktop credential', async () => {
    const { server, toolPolicyReadiness } = await boot({ ready: true, required: [] }, null);
    expect((await post(server.url, '', signNativeToolPolicyRequest(secret, ''))).status).toBe(403);
    expect(toolPolicyReadiness).not.toHaveBeenCalled();
  });

  it('reports not-ready with an empty required while the plugin service is unavailable', async () => {
    const { server } = await boot({ ready: true, required: [] });
    server.ctx.plugins = undefined;
    await expect(post(server.url, '', signNativeToolPolicyRequest(secret, ''))).resolves.toEqual({
      status: 200, json: { ready: false, required: [], reason: 'plugin service is unavailable' }
    });
  });

  it('leaves other methods to the rest of the API', async () => {
    const { server } = await boot({ ready: true, required: [] });
    const response = await fetch(new URL(NATIVE_TOOL_POLICY_INVENTORY_PATH, server.url));
    expect(response.status).not.toBe(200);
  });
});
