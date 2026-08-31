import { describe, expect, it, vi } from 'vitest';
import { createPluginToolCallHttpClient } from './plugin-tool-call-client.js';
import type { ToolCallRequest } from '@zana-ai/zcc-domain/thread-runtime';

function request(): ToolCallRequest {
  return {
    requestId: '1',
    threadId: 'thr-1',
    providerThreadId: 'prov-1',
    turnId: 'turn-1',
    callId: 'call-1',
    tool: 'sf_soql',
    arguments: { query: 'SELECT Id FROM Account' }
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('plugin tool-call HTTP client', () => {
  it('posts the tool call with host credentials', async () => {
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => jsonResponse(200, {
      success: true,
      contentItems: [{ type: 'inputText', text: '{"ok":true}' }]
    }));
    const client = createPluginToolCallHttpClient({
      serverUrl: 'http://127.0.0.1:9/',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.invoke(request())).resolves.toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: '{"ok":true}' }]
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9/internal/hosts/tool-call');
    expect((init.headers as Record<string, string>)['x-zcc-host-id']).toBe('host-1');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-1');
    expect(JSON.parse(String(init.body))).toMatchObject({
      sessionId: 'inst-1',
      threadId: 'thr-1',
      tool: 'sf_soql'
    });
  });

  it('throws on a 4xx response', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: 'unauthorized' }));
    const client = createPluginToolCallHttpClient({
      serverUrl: 'http://127.0.0.1:9',
      hostId: 'host-1',
      hostKey: 'key-1',
      sessionId: 'inst-1',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(client.invoke(request())).rejects.toThrow(/401/);
  });
});
