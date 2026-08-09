/**
 * End-to-end integration tests for the SYNCHRONOUS Overseer PreToolUse route.
 *
 * Unlike overseer.test.ts (which unit-tests the cascade in isolation), these
 * boot the *real* http listener via startMcpServer() and POST raw PreToolUse
 * event JSON to `/hook/overseer/:projectId/:sessionId` — exactly what the
 * `curl` baked into the hook command does. We assert the full round-trip:
 *
 *   1. It works     — a decision serializes to the precise JSON shape Claude
 *                     Code parses from a PreToolUse hook's stdout.
 *   2. It's safe    — projectId/sessionId come from the URL, never the body.
 *   3. It fails open — a null decision, a missing handler, a non-POST method,
 *                      and a handler that throws all yield an EMPTY 200 body
 *                      (the hook treats that as "no opinion" → normal prompt).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { startMcpServer, type McpServerHandle } from '../mcp-server.js';
import { createMemoryInboxStore } from '../inbox-store.js';
import { createMemorySuggestionsStore } from '../suggestions-store.js';

type OverseerHandler = NonNullable<Parameters<typeof startMcpServer>[0]['onOverseerHook']>;

describe('Overseer PreToolUse route (end-to-end)', () => {
  let handle: McpServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  async function boot(
    onOverseerHook?: OverseerHandler,
    overseerDecisionTimeoutMs?: number | (() => number)
  ) {
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => null },
      onOverseerHook,
      overseerDecisionTimeoutMs,
      log: () => {} // keep test output quiet
    });
    return handle;
  }

  /** POST a PreToolUse body to the overseer route; return status + parsed body. */
  async function postHook(
    baseUrl: string,
    path: string,
    body: unknown,
    method = 'POST'
  ): Promise<{ status: number; text: string }> {
    const res = await fetch(`${baseUrl}/hook/overseer/${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined
    });
    return { status: res.status, text: await res.text() };
  }

  it('1. works: serializes an allow decision in the exact PreToolUse shape', async () => {
    const h = await boot(async () => ({ decision: 'allow', reason: 'Read is read-only' }));

    const { status, text } = await postHook(h.url, 'proj-1/sess-A', {
      tool_name: 'Read',
      tool_input: { file_path: '/repo/src/x.ts' }
    });

    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Read is read-only'
      }
    });
  });

  it('1b. works: an ask decision round-trips just as faithfully', async () => {
    const h = await boot(async () => ({ decision: 'ask', reason: 'no rule matched' }));
    const { status, text } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Edit' });
    expect(status).toBe(200);
    expect(JSON.parse(text).hookSpecificOutput.permissionDecision).toBe('ask');
  });

  it('2. safe: identity comes from the URL, never the posted body', async () => {
    const seen: Array<{ projectId: string; sessionId: string }> = [];
    const h = await boot(async (projectId, sessionId) => {
      seen.push({ projectId, sessionId });
      return { decision: 'ask', reason: 'noted' };
    });

    await postHook(h.url, 'proj-1/sess-A', {
      tool_name: 'Bash',
      // Try to smuggle a different identity through the body.
      projectId: 'proj-EVIL',
      session_id: 'sess-EVIL',
      cwd: '/etc'
    });

    expect(seen).toEqual([{ projectId: 'proj-1', sessionId: 'sess-A' }]);
  });

  it('3. fails open: a null decision yields an empty 200 body', async () => {
    const h = await boot(async () => null);
    const { status, text } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    expect(status).toBe(200);
    expect(text).toBe('');
  });

  it('3b. fails open: no handler at all yields an empty 200 body', async () => {
    const h = await boot(undefined);
    const { status, text } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Read' });
    expect(status).toBe(200);
    expect(text).toBe('');
  });

  it('3c. fails open: a handler that throws does not crash the server', async () => {
    const h = await boot(async () => {
      throw new Error('boom');
    });
    const { status, text } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Read' });
    expect(status).toBe(200);
    expect(text).toBe('');

    // The listener survived — a second request still gets a clean fail-open.
    const again = await postHook(h.url, 'proj-1/sess-B', { tool_name: 'Read' });
    expect(again.status).toBe(200);
    expect(again.text).toBe('');
  });

  it('3d. rejects a non-POST method with 405 (no decision leaked)', async () => {
    const h = await boot(async () => ({ decision: 'allow', reason: 'x' }));
    const { status } = await postHook(h.url, 'proj-1/sess-A', undefined, 'GET');
    expect(status).toBe(405);
  });

  it('3e. fails open: a slow decision is bounded by the guard timeout (not the await)', async () => {
    // Regression: the guard's clearTimeout used to run BEFORE awaiting the
    // handler, leaving a slow LLM tier unbounded. The handler here resolves an
    // `allow` only after 200ms; with a 40ms guard the route must fail open with
    // an empty body first, proving the timer actually bounds the await.
    let resolved = false;
    const h = await boot(async () => {
      await new Promise((r) => setTimeout(r, 200));
      resolved = true;
      return { decision: 'allow', reason: 'too late to matter' };
    }, 40);

    const start = Date.now();
    const { status, text } = await postHook(h.url, 'proj-1/sess-A', { tool_name: 'Bash' });
    const elapsed = Date.now() - start;

    expect(status).toBe(200);
    expect(text).toBe(''); // failed open — the late decision is discarded
    expect(elapsed).toBeLessThan(180); // answered on the 40ms guard, not the 200ms handler
    // Let the slow handler settle so its late resolution can't leak into the
    // next test, and confirm it did finish (i.e. the timeout, not a hang, won).
    await new Promise((r) => setTimeout(r, 220));
    expect(resolved).toBe(true);
  });

  it('3f. reads a thunk timeout at request time (deep tier widens the guard live)', async () => {
    // The guard may be a thunk so the deep "think harder" tier can widen the
    // ceiling without a restart. Flip it between requests and prove each request
    // honours the CURRENT value: 40ms fails open before a 120ms handler; 400ms
    // lets the same handler through.
    let budget = 40;
    let resolved = false;
    const h = await boot(async () => {
      await new Promise((r) => setTimeout(r, 120));
      resolved = true;
      return { decision: 'allow', reason: 'deep-ish' };
    }, () => budget);

    const tight = await postHook(h.url, 'p/s', { tool_name: 'Bash' });
    expect(tight.text).toBe(''); // 40ms guard beat the 120ms handler
    await new Promise((r) => setTimeout(r, 140));
    expect(resolved).toBe(true); // handler settled (timeout won, not a hang)

    budget = 400; // deep tier turned on
    const roomy = await postHook(h.url, 'p/s', { tool_name: 'Bash' });
    expect(JSON.parse(roomy.text).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('4. url-decodes identity segments before handing them to the handler', async () => {
    const seen: Array<{ projectId: string; sessionId: string }> = [];
    const h = await boot(async (projectId, sessionId) => {
      seen.push({ projectId, sessionId });
      return { decision: 'ask', reason: 'noted' };
    });
    await postHook(h.url, 'proj%2F1/sess%20A', { tool_name: 'Read' });
    expect(seen).toEqual([{ projectId: 'proj/1', sessionId: 'sess A' }]);
  });
});
