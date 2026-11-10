import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_TOOL_POLICY_EVENT_MAX_BYTES } from '@zana-ai/zcc-contracts/runtime';
import { DISPATCH_ADMISSION_PATH, NATIVE_TOOL_POLICY_PATH, PTY_LIFECYCLE_EVENT_PATH, PTY_SESSION_INSTRUCTIONS_PATH, PTY_SESSION_TOOLS_PATH, PTY_SESSION_TOOL_CALL_PATH, NATIVE_TOOL_POLICY_PROOF_HEADER, signNativeToolPolicyRequest } from './native-tool-policy-proof.js';
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

describe('POST /api/v1/pty-session-instructions (PTY plugin guidance without a runtime supervisor)', () => {
  const req = { sessionId: 'session-1', projectId: 'project-1', profile: 'claude' };
  const postInstr = async (url: string, body: string, proof?: string) => {
    const response = await fetch(new URL(PTY_SESSION_INSTRUCTIONS_PATH, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) },
      body
    });
    return { status: response.status, json: await response.json() as unknown };
  };

  it('answers a signed request with the plugin guidance for that session', async () => {
    const { server } = await boot();
    const sessionInstructions = vi.fn(async () => 'be kind');
    server.ctx.plugins = { sessionInstructions } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(req);
    await expect(postInstr(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({ status: 200, json: { instructions: 'be kind' } });
    expect(sessionInstructions).toHaveBeenCalledWith({
      surface: 'pty', sessionId: 'session-1', threadId: 'session-1', projectId: 'project-1', harness: 'claude-code'
    });
  });

  it('refuses unsigned, mis-signed, malformed and over-specified requests', async () => {
    const { server } = await boot();
    const sessionInstructions = vi.fn();
    server.ctx.plugins = { sessionInstructions } as unknown as ProductHttpContext['plugins'];
    const body = JSON.stringify(req);
    expect((await postInstr(server.url, body)).status).toBe(403);
    expect((await postInstr(server.url, body, signNativeToolPolicyRequest('x'.repeat(64), body))).status).toBe(403);
    expect((await postInstr(server.url, 'nope', signNativeToolPolicyRequest(secret, 'nope'))).status).toBe(400);
    const extra = JSON.stringify({ ...req, extra: 1 });
    expect((await postInstr(server.url, extra, signNativeToolPolicyRequest(secret, extra))).status).toBe(400);
    expect(sessionInstructions).not.toHaveBeenCalled();
  });

  it('answers empty without a plugin host and on a plugin failure', async () => {
    const { server } = await boot();
    const body = JSON.stringify(req);
    server.ctx.plugins = undefined;
    await expect(postInstr(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({ status: 200, json: { instructions: '' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.ctx.plugins = { sessionInstructions: vi.fn(async () => { throw new Error('boom'); }) } as unknown as ProductHttpContext['plugins'];
    await expect(postInstr(server.url, body, signNativeToolPolicyRequest(secret, body))).resolves.toEqual({ status: 200, json: { instructions: '' } });
  });

  it('rejects an oversized body', async () => {
    const { server } = await boot();
    const body = JSON.stringify({ ...req, sessionId: 'x'.repeat(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) });
    expect((await postInstr(server.url, body, signNativeToolPolicyRequest(secret, body))).status).toBe(413);
  });
});

describe('POST /api/v1/pty-session-tools and /pty-session-tool-call (PTY plugin tools without a runtime supervisor)', () => {
  const listReq = { sessionId: 'session-1', projectId: 'project-1', profile: 'claude' };
  const callReq = { ...listReq, invocationId: '3f2b8c1e-6d4a-4b0f-9a7e-1c2d3e4f5a6b', name: 'do_thing', arguments: { a: 1 } };
  const postTo = async (path: string, url: string, body: string, proof?: string) => {
    const response = await fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(proof ? { [NATIVE_TOOL_POLICY_PROOF_HEADER]: proof } : {}) },
      body
    });
    return { status: response.status, json: await response.json() as unknown };
  };
  const plugins = () => ({
    ptySessionTools: vi.fn(async () => ({ tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }] })),
    decideToolPolicy: vi.fn(async () => ({ action: 'allow' })),
    invokePtySessionTool: vi.fn(async () => ({ success: true, contentItems: [{ type: 'inputText', text: 'done' }] }))
  });

  it('lists and calls for a signed request', async () => {
    const { server } = await boot();
    const p = plugins();
    server.ctx.plugins = p as unknown as ProductHttpContext['plugins'];
    const listBody = JSON.stringify(listReq);
    await expect(postTo(PTY_SESSION_TOOLS_PATH, server.url, listBody, signNativeToolPolicyRequest(secret, listBody))).resolves.toEqual({
      status: 200, json: { tools: [{ name: 'do_thing', description: 'd', inputSchema: { type: 'object' } }] }
    });
    const callBody = JSON.stringify(callReq);
    await expect(postTo(PTY_SESSION_TOOL_CALL_PATH, server.url, callBody, signNativeToolPolicyRequest(secret, callBody))).resolves.toEqual({
      status: 200, json: { success: true, contentItems: [{ type: 'inputText', text: 'done' }] }
    });
    expect(p.decideToolPolicy).toHaveBeenCalledWith(expect.objectContaining({ surface: 'pty', toolName: 'do_thing' }));
  });

  it('refuses unsigned, mis-signed, malformed and over-specified requests without asking plugins', async () => {
    const { server } = await boot();
    const p = plugins();
    server.ctx.plugins = p as unknown as ProductHttpContext['plugins'];
    for (const [path, req] of [[PTY_SESSION_TOOLS_PATH, listReq], [PTY_SESSION_TOOL_CALL_PATH, callReq]] as const) {
      const body = JSON.stringify(req);
      expect((await postTo(path, server.url, body)).status).toBe(403);
      expect((await postTo(path, server.url, body, signNativeToolPolicyRequest('x'.repeat(64), body))).status).toBe(403);
      expect((await postTo(path, server.url, 'nope', signNativeToolPolicyRequest(secret, 'nope'))).status).toBe(400);
      const extra = JSON.stringify({ ...req, extra: 1 });
      expect((await postTo(path, server.url, extra, signNativeToolPolicyRequest(secret, extra))).status).toBe(400);
    }
    expect(p.ptySessionTools).not.toHaveBeenCalled();
    expect(p.decideToolPolicy).not.toHaveBeenCalled();
  });

  it('answers none and a denial without a plugin host', async () => {
    const { server } = await boot();
    server.ctx.plugins = undefined;
    const listBody = JSON.stringify(listReq);
    await expect(postTo(PTY_SESSION_TOOLS_PATH, server.url, listBody, signNativeToolPolicyRequest(secret, listBody))).resolves.toEqual({ status: 200, json: { tools: [] } });
    const callBody = JSON.stringify(callReq);
    const denied = await postTo(PTY_SESSION_TOOL_CALL_PATH, server.url, callBody, signNativeToolPolicyRequest(secret, callBody));
    expect(denied.status).toBe(200);
    expect(denied.json).toMatchObject({ success: false });
  });

  it('rejects an oversized body', async () => {
    const { server } = await boot();
    const body = JSON.stringify({ ...callReq, name: 'x'.repeat(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) });
    expect((await postTo(PTY_SESSION_TOOL_CALL_PATH, server.url, body, signNativeToolPolicyRequest(secret, body))).status).toBe(413);
  });
});
