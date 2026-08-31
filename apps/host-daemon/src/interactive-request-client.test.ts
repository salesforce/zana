import { describe, expect, it, vi } from 'vitest';
import type { PendingInteractionCreate } from '@zana-ai/zcc-domain/thread-runtime';
import { createInteractiveRequestHttpClient } from './interactive-request-client.js';

function request(): PendingInteractionCreate {
  return {
    threadId: 'thr-1',
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    payload: {
      kind: 'approval',
      reason: 'Needs approval',
      availableDecisions: ['allow_once', 'deny'],
      subject: {
        kind: 'command',
        itemId: 'item-1',
        command: 'git status',
        cwd: '/tmp',
        actions: [],
        sessionGrant: null
      }
    }
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('interactive request HTTP client', () => {
  it('registers a created interaction', async () => {
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(200, {
      outcome: 'created',
      interactionId: 'pint_1',
      status: 'pending'
    }));
    const client = createInteractiveRequestHttpClient({
      serverUrl: 'http://127.0.0.1:9/',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.registerRequest(request())).resolves.toEqual({
      outcome: 'created',
      interactionId: 'pint_1',
      status: 'pending'
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-zcc-host-id']).toBe('host-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
  });

  it('does not retry a logical 409 reject', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(409, { error: 'conflict' }));
    const client = createInteractiveRequestHttpClient({
      serverUrl: 'http://127.0.0.1:9',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.registerRequest(request())).rejects.toThrow(/409/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 then succeeds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: 'down' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        outcome: 'existing',
        interactionId: 'pint_1',
        status: 'pending'
      }));
    const client = createInteractiveRequestHttpClient({
      serverUrl: 'http://127.0.0.1:9',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.registerRequest(request())).resolves.toMatchObject({ outcome: 'existing' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('swallows interrupt HTTP failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    });
    const client = createInteractiveRequestHttpClient({
      serverUrl: 'http://127.0.0.1:9',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.interruptRequests({
      providerId: 'claude-code',
      threadIds: ['thr-1'],
      reason: 'provider-exited'
    })).resolves.toBeUndefined();
  });
});
