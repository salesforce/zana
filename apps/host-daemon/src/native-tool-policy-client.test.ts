import { RELAY_BACKSTOP_MS, TOOL_SETTLED_POST_MS } from '@zana-ai/zcc-domain/native-tool-policy-budget';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeToolPolicyHttpClient, createNativeToolSettledHttpClient } from './native-tool-policy-client.js';

const input = { threadId: 'thread', providerThreadId: 'provider-thread', providerId: 'provider',
  projectId: 'ignored-project', environmentId: 'ignored-environment', callId: 'call', toolName: 'Write', input: { path: 'file' } };
const options = { serverUrl: 'http://127.0.0.1:8780/t/zcrs_abcdefghijklmnop', hostId: 'host', hostKey: 'secret', sessionId: 'instance' };
afterEach(() => vi.useRealTimers());
describe('native tool policy HTTP client', () => {
  it('uses authenticated host transport, retaining relay prefix and omitting project hints', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ action: 'allow' })));
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn });
    await expect(client(input, new AbortController().signal)).resolves.toEqual({ action: 'allow' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(options.serverUrl + '/internal/hosts/native-tool-policy');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: {
      authorization: 'Bearer secret', 'x-zcc-host-id': 'host', 'content-type': 'application/json'
    } });
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'instance', threadId: input.threadId,
      providerId: input.providerId, providerThreadId: input.providerThreadId, callId: 'call', toolName: 'Write', input: input.input });
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });
  it.each([undefined, {}, { action: 'allow', extra: true }, { action: 'deny', reason: '' }, null])('denies malformed reply %j', async reply => {
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn: vi.fn(async () => new Response(JSON.stringify(reply))) });
    expect((await client(input, new AbortController().signal)).action).toBe('deny');
  });
  it.each([new Response('failure', { status: 401 }), new Response(null), new Response('{'), new Response('x'.repeat(16_385))])('denies HTTP errors, absent, malformed and oversized bodies', async response => {
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn: vi.fn(async () => response) });
    expect((await client(input, new AbortController().signal)).action).toBe('deny');
  });
  it.each([
    ['a refused route', () => new Response('{"error":"path is not allowed"}', { status: 403 }), 'server refused (HTTP 403)'],
    ['an empty reply', () => new Response(null), 'empty reply'],
    ['a malformed reply', () => new Response('{'), 'invalid reply'],
    ['an invalid decision', () => new Response('{"action":"maybe"}'), 'invalid reply'],
    ['an oversized reply', () => new Response('x'.repeat(16_385)), 'reply too large'],
  ])('names %s in the denial without echoing the body', async (_case, reply, detail) => {
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn: vi.fn(async () => reply()) });
    const decision = await client(input, new AbortController().signal);
    expect(decision).toEqual({ action: 'deny', reason: `native policy unavailable or invalid: ${detail}` });
    expect(JSON.stringify(decision)).not.toContain('path is not allowed');
  });
  it('names a transport failure as no reply', async () => {
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });
    expect(await client(input, new AbortController().signal)).toEqual({ action: 'deny', reason: 'native policy unavailable or invalid: no reply' });
  });
  it('preserves plugin denial and fails closed on fetch rejection', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ action: 'deny', reason: 'blocked' })))
      .mockRejectedValueOnce(new Error('network'));
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn });
    expect(await client(input, new AbortController().signal)).toEqual({ action: 'deny', reason: 'blocked' });
    expect((await client(input, new AbortController().signal)).action).toBe('deny');
  });
  it.each(['timeout', 'abort', 'already-aborted'])('cancels pending transport on %s', async mode => {
    vi.useFakeTimers(); const controller = new AbortController();
    if (mode === 'already-aborted') controller.abort();
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!;
      if (signal.aborted) reject(new Error('aborted'));
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = createNativeToolPolicyHttpClient({ ...options, fetchFn });
    const result = client(input, controller.signal);
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(RELAY_BACKSTOP_MS);
    else controller.abort();
    expect(await result).toEqual({ action: 'deny',
      reason: `native policy unavailable or invalid: ${mode === 'timeout' ? 'timed out' : 'cancelled'}` });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createNativeToolSettledHttpClient', () => {
  const event = {
    threadId: 't', providerThreadId: 'pt', callId: 'c', toolName: 'Bash', state: 'succeeded', durationMs: 1,
    providerId: 'claude-code', projectId: 'p', environmentId: 'e', output: 'secret-output'
  } as never;

  it('posts authenticated and never awaits or throws', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 204 });
    });
    const send = createNativeToolSettledHttpClient({ serverUrl: 'http://127.0.0.1:9', hostId: 'h', hostKey: 'k', sessionId: 's', fetchFn: fetchFn as never });
    expect(send(event)).toBeUndefined();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.url).toBe('http://127.0.0.1:9/internal/hosts/tool-settled');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ sessionId: 's', callId: 'c', providerId: 'claude-code' });
    // The server schema is strict and derives these from the thread record.
    expect(body).not.toHaveProperty('projectId');
    expect(body).not.toHaveProperty('environmentId');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('aborts a hung post at the settled budget and swallows failures', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchFn = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      createNativeToolSettledHttpClient({ serverUrl: 'http://127.0.0.1:9', hostId: 'h', hostKey: 'k', sessionId: 's', fetchFn: fetchFn as never })(event);
      await vi.advanceTimersByTimeAsync(0);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(TOOL_SETTLED_POST_MS + 1);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
