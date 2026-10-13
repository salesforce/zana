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
import { connect } from 'node:net';
import { NATIVE_TOOL_POLICY_EVENT_MAX_BYTES, NATIVE_TOOL_POLICY_INPUT_MAX_CHARS } from '@zana-ai/zcc-contracts/runtime';
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

  it('3f. fails CLOSED on an oversized body: drains it and answers an explicit deny without invoking the handler', async () => {
    // A reset socket would reach the agent as "native tool policy
    // unreachable"; draining the rest lets the real reason arrive.
    let called = false;
    const h = await boot(async () => {
      called = true;
      return { decision: 'allow', reason: 'should never run' };
    });
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', {
      tool_name: 'Write',
      tool_input: { content: 'x'.repeat(NATIVE_TOOL_POLICY_EVENT_MAX_BYTES) }
    });
    expect(status).toBe(200);
    expect(json).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'tool call is larger than the 1 MiB native tool policy request limit'
      }
    });
    expect(called).toBe(false);
  });

  it('3f2. hands a limit-sized multi-byte tool input to the handler intact: the route caps the event, not the input', async () => {
    let received = '';
    const h = await boot(async (_projectId, _sessionId, body) => {
      received = body;
      return { decision: 'allow', reason: 'allowed' };
    });
    // 3 UTF-8 bytes per character: about 768 KiB on the wire for an input
    // the runtime contract accepts.
    const event = {
      session_id: 's'.repeat(36),
      transcript_path: `/home/user/.claude/projects/${'p'.repeat(200)}/session.jsonl`,
      tool_name: 'Write',
      tool_use_id: 'toolu_limit',
      tool_input: { content: '\u20ac'.repeat(NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - '{"content":""}'.length) }
    };
    const { status, json } = await postHook(h.url, 'proj-1/sess-A', event);
    expect(status).toBe(200);
    expect(json).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } });
    expect(Buffer.byteLength(received)).toBeGreaterThan(3 * NATIVE_TOOL_POLICY_INPUT_MAX_CHARS - 64);
    expect(JSON.parse(received)).toEqual(event);
  });

  it('3g. fails CLOSED past the drain ceiling: resets a body over 16 MiB without invoking the handler', async () => {
    // The server destroys the request, which races the client's upload, so
    // assert on the handler rather than on being able to read a reply.
    let called = false;
    const h = await boot(async () => {
      called = true;
      return { decision: 'allow', reason: 'should never run' };
    });
    await fetch(`${h.url}/hook/nativetool/proj-1/sess-A`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(16 * 1024 * 1024 + 1024)
    }).catch(() => null);
    expect(called).toBe(false);
  });

  it('3h. stays bounded after an early answer: a client still uploading past the ceiling is cut off', async () => {
    // Node keeps reading a request body after the response ends, so a client
    // answered by the timeout guard could otherwise stream without limit.
    const h = await boot(async () => ({ decision: 'allow', reason: 'should never run' }), 40);
    const { port } = new URL(h.url);
    const total = 32 * 1024 * 1024;
    const outcome = await new Promise<{ response: string; allWritten: boolean }>((resolve) => {
      let response = '';
      let allWritten = false;
      const socket = connect(Number(port), '127.0.0.1', () => {
        socket.write(`POST /hook/nativetool/proj-1/sess-A HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${total}\r\n\r\n{`);
        setTimeout(() => {
          const chunk = 'x'.repeat(64 * 1024);
          let sent = 1;
          const pump = () => {
            while (sent < total && !socket.destroyed) {
              sent += chunk.length;
              if (!socket.write(chunk)) { socket.once('drain', pump); return; }
            }
            allWritten = sent >= total;
          };
          pump();
        }, 150);
      });
      socket.on('data', (data) => { response += data; });
      socket.on('error', () => undefined);
      socket.on('close', () => resolve({ response, allWritten }));
    });
    expect(outcome.response).toContain('native tool policy decision timed out');
    expect(outcome.allWritten).toBe(false);
  });

  it.each(['', '  ', '\u0085', '\u0000\u001b'])(
    '3i. replaces a deny reason no CLI can use (%j) with a fixed one',
    async (reason) => {
      const h = await boot(async () => ({ decision: 'deny', reason }));
      const { json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
      expect(json).toEqual({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'denied by native tool policy'
        }
      });
    }
  );

  it('3j. repairs a lone surrogate so the reply stays parseable by serde_json, and caps the reason', async () => {
    let reason = 'x\ud83d';
    const h = await boot(async () => ({ decision: 'deny', reason }));
    const res = await fetch(`${h.url}/hook/nativetool/proj-1/sess-A`, { method: 'POST', body: '{"tool_name":"Bash"}' });
    const text = await res.text();
    expect(text).not.toMatch(/\\ud83d/i);
    expect(JSON.parse(text).hookSpecificOutput.permissionDecisionReason).toBe('x\ufffd');
    reason = 'r'.repeat(5_000);
    const { json } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect((json as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason)
      .toBe('r'.repeat(1024));
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
