import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { getConversationThread, getHost } from '@zana-ai/zcc-db';
import { handleHostInternalHttp } from './host-internal.js';
import type { ProductHttpContext } from './product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getHost: vi.fn(), getThreadPluginMetadata: vi.fn(), upsertHost: vi.fn() }));
vi.mock('./host-hub.js', async importOriginal => ({ ...await importOriginal<typeof import('./host-hub.js')>(), hostKeyMatches: () => true }));
vi.mock('./public-app-url.js', async importOriginal => ({ ...await importOriginal<typeof import('./public-app-url.js')>(), isAllowedHostInternalHost: () => true }));

afterEach(() => vi.clearAllMocks());

it('denies a host tool call on plugin policy and never invokes the tool', async () => {
  vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
  vi.mocked(getConversationThread).mockReturnValue({
    id: '11111111-1111-4111-8111-111111111111', projectId: 'project-1', hostId: 'host-1', providerId: 'codex'
  } as never);
  const invokeAgentTool = vi.fn();
  const decideToolPolicy = vi.fn(async () => ({ action: 'deny' as const, reason: 'plugin blocked write' }));
  const input = { sessionId: 'instance', threadId: '11111111-1111-4111-8111-111111111111', providerThreadId: 'provider', turnId: 'turn', callId: 'call', tool: 'Write', arguments: { path: '/secret' } };
  const request = Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), {
    method: 'POST', url: '/internal/hosts/tool-call', headers: { authorization: 'Bearer host-key-host-key-host-key-host', 'x-zcc-host-id': 'host-1' }
  }) as IncomingMessage;
  let status = 0;
  let body: unknown;
  const response = Object.assign(new EventEmitter(), {
    writeHead(code: number) { status = code; return response; },
    setHeader() {}, getHeader() { return undefined; },
    end(value: string) { body = JSON.parse(value); }
  }) as unknown as ServerResponse;
  expect(await handleHostInternalHttp(request, response, {
    config: { getConfig: () => ({}) }, db: {}, plugins: { decideToolPolicy, invokeAgentTool }
  } as unknown as ProductHttpContext)).toBe(true);
  expect(status).toBe(200);
  expect(body).toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'Tool "Write" denied: plugin blocked write' }] });
  expect(decideToolPolicy).toHaveBeenCalledWith(expect.objectContaining({
    invocationId: expect.any(String), threadId: input.threadId, projectId: 'project-1', providerId: 'codex', toolName: 'Write', input: { path: '/secret' }
  }));
  expect(invokeAgentTool).not.toHaveBeenCalled();
});
