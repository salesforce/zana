/**
 * End-to-end integration tests for the SYNCHRONOUS Native Tool Policy
 * PreToolUse route (OBL-004 — plugin-governed native-provider tool gating).
 *
 * Unlike the Overseer route (which fails OPEN on silence), this route is
 * FAIL-CLOSED: a timeout, oversized body, missing handler, handler throw, or
 * request error must all DENY the tool call, never allow it to pass as if no
 * opinion had been given. These boot the *real* http listener via
 * startMcpServer() and POST raw PreToolUse event JSON to
 * `/hook/nativetool/:projectId/:sessionId` — exactly what the native-provider
 * hook command does.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { createMemoryInboxStore } from '@zana-ai/zcc-server';
import { createMemorySuggestionsStore } from '@zana-ai/zcc-server';

type NativeToolPolicyHandler = NonNullable<Parameters<typeof startMcpServer>[0]['onNativeToolPolicyHook']>;

describe('Native Tool Policy PreToolUse route (end-to-end, fail-closed)', () => {
  let handle: McpServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  async function boot(
    onNativeToolPolicyHook?: NativeToolPolicyHandler,
    nativeToolPolicyDecisionTimeoutMs?: number | (() => number)
  ) {
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => null },
      onNativeToolPolicyHook,
      nativeToolPolicyDecisionTimeoutMs,
      log: () => {}
    });
    return handle;
  }

  async function postHook(
    baseUrl: string,
    path: string,
    body: unknown,
    method = 'POST'
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${baseUrl}/hook/nativetool/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  it('1. works: an allow decision serializes in the exact PreToolUse shape', async () => {
    const h = await boot(async () => ({ decision: 'allow', reason: 'read-only tool' }));
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Read' });
    expect(status).toBe(200);
    expect(json).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'read-only tool'
      }
    });
  });

  it('2. a deny decision serializes with its reason', async () => {
    const h = await boot(async () => ({ decision: 'deny', reason: 'blocked by plugin policy' }));
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect(status).toBe(200);
    expect(json).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked by plugin policy'
      }
    });
  });

  it('3. fails CLOSED: a null decision denies, it does not allow by default', async () => {
    const h = await boot(async () => null);
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect(status).toBe(200);
    expect((json as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('3b. fails CLOSED: no handler at all denies', async () => {
    const h = await boot(undefined);
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect(status).toBe(200);
    expect((json as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('3c. fails CLOSED: a handler that throws denies and does not crash the server', async () => {
    const h = await boot(async () => {
      throw new Error('boom');
    });
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect(status).toBe(200);
    expect((json as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('deny');

    // The listener survived — a second request still gets a clean fail-closed answer.
    const again = await postHook(h.url, 'proj-1/sess-B', { tool_name: 'Bash' });
    expect(again.status).toBe(200);
    expect((again.json as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('3d. rejects a non-POST method with 405', async () => {
    const h = await boot(async () => ({ decision: 'allow', reason: 'x' }));
    const res = await fetch(`${h.url}/hook/nativetool/proj-1/sess-A`, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('3e. fails CLOSED on timeout: a slow decision is bounded by the guard, not the await', async () => {
    let resolved = false;
    const h = await boot(async () => {
      await new Promise((r) => setTimeout(r, 200));
      resolved = true;
      return { decision: 'allow', reason: 'too late to matter' };
    }, 40);

    const start = Date.now();
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect((json as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(elapsed).toBeLessThan(180); // answered on the 40ms guard, not the 200ms handler
    await new Promise((r) => setTimeout(r, 220));
    expect(resolved).toBe(true);
  });

  it('3f. fails CLOSED on an oversized body: destroys the request without invoking the handler', async () => {
    // The server calls req.destroy() on overflow, which races the client's
    // write — the client sees either a truncated/empty response or a reset
    // socket, never the handler's answer. Assert on the handler, not on
    // being able to parse a reply.
    let called = false;
    const h = await boot(async () => {
      called = true;
      return { decision: 'allow', reason: 'should never run' };
    });
    await fetch(`${h.url}/hook/nativetool/proj-1/sess-A`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(300 * 1024)
    }).catch(() => null);
    expect(called).toBe(false);
  });

  it('4. safe: identity comes from the URL, never the posted body', async () => {
    const seen: Array<{ projectId: string; sessionId: string }> = [];
    const h = await boot(async (projectId, sessionId) => {
      seen.push({ projectId, sessionId });
      return { decision: 'allow', reason: 'noted' };
    });
    await postHook(h.url, 'proj-1/sess-A', {
      tool_name: 'Bash',
      projectId: 'proj-EVIL',
      session_id: 'sess-EVIL'
    });
    expect(seen).toEqual([{ projectId: 'proj-1', sessionId: 'sess-A' }]);
  });

  it('uses a configured timeout function and never invokes a late handler after deadline', async () => {
    let release!: (decision: { decision: 'allow'; reason: string }) => void;
    const pending = new Promise<{ decision: 'allow'; reason: string }>(resolve => { release = resolve; });
    let called = false;
    const h = await boot(async () => { called = true; return pending; }, () => 40);
    const { json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Write' });
    expect(called).toBe(true);
    expect((json as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason).toBe('native tool policy decision timed out');
    release({ decision: 'allow', reason: 'late allow' });
  });

  it('decodes URL identity and rejects malformed URL-encoded segments', async () => {
    const seen: string[] = [];
    const h = await boot(async (projectId, sessionId) => {
      seen.push(`${projectId}:${sessionId}`);
      return { decision: 'deny', reason: 'not allowed' };
    });
    await postHook(h.url, 'project%20one/session%20two', {});
    expect(seen).toEqual(['project one:session two']);
    const response = await fetch(`${h.url}/hook/nativetool/%ZZ/session`, { method: 'POST', body: '{}' });
    expect(response.status).not.toBe(200);
    expect(seen).toHaveLength(1);
  });
});
