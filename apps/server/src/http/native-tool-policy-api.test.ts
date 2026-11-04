import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_POLICY_EVENT_MAX_BYTES } from '@zana-ai/zcc-contracts/runtime';
import { DISPATCH_ADMISSION_PATH, NATIVE_TOOL_POLICY_PATH, PTY_LIFECYCLE_EVENT_PATH, NATIVE_TOOL_POLICY_PROOF_HEADER, signNativeToolPolicyRequest } from './native-tool-policy-proof.js';
import type { ProductHttpContext } from './product-context.js';
import { startProductServer, type ProductServer } from './product-server.js';

const secret = 'c'.repeat(64);
const request = {
  invocationId: 'b'.repeat(64),
  sessionId: 'session-1',
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
      invocationId: request.invocationId, threadId: 'session-1', sessionId: 'session-1', surface: 'pty', projectId: 'project-1',
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

describe('POST /api/v1/dispatch-admission (PTY input without a runtime supervisor)', () => {
  const admission = { projectId: 'project-1', sessionId: 'session-1', entry: 'reply', origin: 'user' };
  const postAdmission = async (url: string, body: string, proof?: string) => {
    const response = await fetch(new URL(DISPATCH_ADMISSION_PATH, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) },
      body
    });
    return { status: response.status, json: await response.json() as unknown };
  };

  it('admits a signed request as a pty dispatch and returns the decision', async () => {
    const { server } = await boot();
    const admitDispatch = vi.fn(async () => ({ action: 'reject', message: 'blocked' }) as const);
    server.ctx.plugins = { admitDispatch } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(admission);
    await expect(postAdmission(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({
      status: 200, json: { action: 'reject', message: 'blocked' }
    });
    expect(admitDispatch).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', sessionId: 'session-1', surface: 'pty', entry: 'reply', origin: 'user'
    }));
  });

  it('refuses unsigned, mis-signed, malformed and over-specified requests without asking plugins', async () => {
    const { server } = await boot();
    const admitDispatch = vi.fn();
    server.ctx.plugins = { admitDispatch } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(admission);
    expect((await postAdmission(server.url, body)).status).toBe(403);
    expect((await postAdmission(server.url, body, signNativeToolPolicyRequest('x'.repeat(64), body))).status).toBe(403);
    const notJson = 'nope';
    expect((await postAdmission(server.url, notJson, signNativeToolPolicyRequest(secret, notJson))).status).toBe(400);
    const extra = JSON.stringify({ ...admission, threadId: 'smuggled' });
    expect((await postAdmission(server.url, extra, signNativeToolPolicyRequest(secret, extra))).status).toBe(400);
    const badEntry = JSON.stringify({ ...admission, entry: 'fork' });
    expect((await postAdmission(server.url, badEntry, signNativeToolPolicyRequest(secret, badEntry))).status).toBe(400);
    expect(admitDispatch).not.toHaveBeenCalled();
  });

  it('proceeds when no plugin host is installed, as for a Modern send (nothing can veto)', async () => {
    const { server } = await boot();
    server.ctx.plugins = undefined;
    const body = JSON.stringify(admission);
    await expect(postAdmission(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toMatchObject({
      status: 200, json: { action: 'proceed' }
    });
  });
});

describe('POST /api/v1/pty-lifecycle-event (PTY lifecycle without a runtime supervisor)', () => {
  const event = { kind: 'created', projectId: 'project-1', sessionId: 'session-1', profile: 'claude' };
  const postEvent = async (url: string, body: string, proof?: string) => {
    const response = await fetch(new URL(PTY_LIFECYCLE_EVENT_PATH, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) },
      body
    });
    return { status: response.status, json: await response.json() as unknown };
  };

  it('delivers a signed event to plugins with pty identity', async () => {
    const { server } = await boot();
    const emitThreadEvent = vi.fn(async () => undefined);
    server.ctx.plugins = { emitThreadEvent } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(event);
    await expect(postEvent(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({ status: 200, json: { delivered: true } });
    expect(emitThreadEvent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'thread.created', surface: 'pty', sessionId: 'session-1', projectId: 'project-1'
    }));
  });

  it('refuses unsigned, mis-signed, malformed and over-specified events without asking plugins', async () => {
    const { server } = await boot();
    const emitThreadEvent = vi.fn();
    server.ctx.plugins = { emitThreadEvent } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(event);
    expect((await postEvent(server.url, body)).status).toBe(403);
    expect((await postEvent(server.url, body, signNativeToolPolicyRequest('x'.repeat(64), body))).status).toBe(403);
    expect((await postEvent(server.url, 'nope', signNativeToolPolicyRequest(secret, 'nope'))).status).toBe(400);
    const extra = JSON.stringify({ ...event, thread: 'smuggled' });
    expect((await postEvent(server.url, extra, signNativeToolPolicyRequest(secret, extra))).status).toBe(400);
    const badKind = JSON.stringify({ ...event, kind: 'archived' });
    expect((await postEvent(server.url, badKind, signNativeToolPolicyRequest(secret, badKind))).status).toBe(400);
    expect(emitThreadEvent).not.toHaveBeenCalled();
  });

  it('answers not delivered when no plugin host is installed', async () => {
    const { server } = await boot();
    server.ctx.plugins = undefined;
    const body = JSON.stringify(event);
    await expect(postEvent(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({ status: 200, json: { delivered: false } });
  });

  it('rejects an oversized body', async () => {
    const { server } = await boot();
    const body = JSON.stringify({ ...event, error: 'x'.repeat(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) });
    const response = await postEvent(server.url, body, signNativeToolPolicyRequest(secret, body));
    expect(response.status).toBe(413);
  });
});
