import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeToolPolicyHttpClient } from './native-tool-policy-client.js';

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
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(10_000);
    else controller.abort();
    expect((await result).action).toBe('deny');
    expect(vi.getTimerCount()).toBe(0);
  });
});
