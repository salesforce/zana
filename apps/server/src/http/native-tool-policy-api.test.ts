import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_POLICY_EVENT_MAX_BYTES } from '@zana-ai/zcc-contracts/runtime';
import { NATIVE_TOOL_POLICY_PATH, NATIVE_TOOL_POLICY_PROOF_HEADER, signNativeToolPolicyRequest } from './native-tool-policy-proof.js';
import type { ProductHttpContext } from './product-context.js';
import { startProductServer, type ProductServer } from './product-server.js';

const secret = 'c'.repeat(64);
const request = {
  invocationId: 'b'.repeat(64),
  threadId: 'session-1',
  projectId: 'project-1',
  profile: 'claude-resume',
  toolName: 'Bash',
  input: { command: 'deploy', token: 'secret-value' }
};

let server: ProductServer | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await server?.close();
  server = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function boot(uiSendSecret: string | null = secret) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-native-tool-policy-api-'));
  dirs.push(dataDir);
  server = await startProductServer({ dataDir, origins: { serverPort: 0, devAppPort: 5173 }, uiSendSecret: uiSendSecret ?? undefined });
  const decideToolPolicy = vi.fn(async () => ({ action: 'deny', reason: '   ' }) as const);
  server.ctx.plugins = { decideToolPolicy } as unknown as ProductHttpContext['plugins'];
  return { server, decideToolPolicy };
}

async function post(url: string, body: string, proof?: string, headers: Record<string, string> = {}) {
  const response = await fetch(new URL(NATIVE_TOOL_POLICY_PATH, url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}), ...headers },
    body
  });
  return { status: response.status, json: await response.json() as unknown };
}

describe('POST /api/v1/native-tool-policy (main-owned PTYs without a runtime supervisor)', () => {
  it('decides a request main signed with the plugin policy, redacted and with a usable reason', async () => {
    const { server, decideToolPolicy } = await boot();
    const body = JSON.stringify(request);
    await expect(post(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({
      status: 200, json: { action: 'deny', reason: 'denied by plugin tool policy' }
    });
    expect(decideToolPolicy).toHaveBeenCalledWith({
      invocationId: request.invocationId, threadId: 'session-1', projectId: 'project-1',
      providerId: 'claude-code', toolName: 'Bash', input: { command: 'deploy', token: '[REDACTED]' }
    });
  });

  it('refuses an unsigned, mis-signed or replayed request without asking plugins', async () => {
    const { server, decideToolPolicy } = await boot();
    const body = JSON.stringify(request);
    const proof = signNativeToolPolicyRequest(secret, body);
    expect((await post(server.url, body)).status).toBe(403);
    expect((await post(server.url, JSON.stringify({ ...request, toolName: 'Write' }), proof)).status).toBe(403);
    expect((await post(server.url, body, signNativeToolPolicyRequest('x'.repeat(64), body))).status).toBe(403);
    expect((await post(server.url, body, proof)).status).toBe(200);
    expect((await post(server.url, body, proof)).status).toBe(403);
    expect(decideToolPolicy).toHaveBeenCalledTimes(1);
  });

  it('refuses every request on a server without the desktop credential', async () => {
    const { server, decideToolPolicy } = await boot(null);
    const body = JSON.stringify(request);
    expect((await post(server.url, body, signNativeToolPolicyRequest(secret, body))).status).toBe(403);
    expect(decideToolPolicy).not.toHaveBeenCalled();
  });

  it.each<[string, string]>([
    ['is not JSON', '{"invocationId":'],
    ['breaks the runtime contract', JSON.stringify({ ...request, invocationId: 'not-a-digest' })],
    ['claims a provider id', JSON.stringify({ ...request, providerId: 'codex' })]
  ])('rejects a signed body that %s', async (_label, body) => {
    const { server, decideToolPolicy } = await boot();
    expect((await post(server.url, body, signNativeToolPolicyRequest(secret, body))).status).toBe(400);
    expect(decideToolPolicy).not.toHaveBeenCalled();
  });

  it('rejects a body over the event limit before verifying it', async () => {
    const { server } = await boot();
    const body = JSON.stringify({ ...request, input: { content: 'x'.repeat(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) } });
    expect((await post(server.url, body, signNativeToolPolicyRequest(secret, body))).status).toBe(413);
  });

  it('denies while the plugin service is unavailable', async () => {
    const { server } = await boot();
    server.ctx.plugins = undefined;
    const body = JSON.stringify(request);
    await expect(post(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({
      status: 200, json: { action: 'deny', reason: 'plugin service is unavailable' }
    });
  });

  it('leaves other methods to the rest of the API', async () => {
    const { server } = await boot();
    const response = await fetch(new URL(NATIVE_TOOL_POLICY_PATH, server.url));
    expect(response.status).not.toBe(200);
  });
});
