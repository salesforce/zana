import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConversationThread, getHost } from '@zana-ai/zcc-db';
import { handleHostInternalHttp } from './host-internal.js';
import type { ProductHttpContext } from './product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getHost: vi.fn(),
  upsertHost: vi.fn()
}));

vi.mock('./host-hub.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./host-hub.js')>();
  return {
    ...actual,
    hostKeyMatches: () => true
  };
});

vi.mock('./public-app-url.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./public-app-url.js')>();
  return {
    ...actual,
    isAllowedHostInternalHost: () => true
  };
});

function request(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, {
    method: 'POST',
    url: '/internal/hosts/tool-call',
    headers: {
      authorization: 'Bearer host-key-host-key-host-key-host',
      'x-zcc-host-id': 'host-1',
      ...headers
    }
  }) as IncomingMessage;
}

function captureResponse(): { response: ServerResponse; status: number; body: unknown } {
  const captured = { status: 0, body: undefined as unknown };
  const response = {
    writeHead(status: number) {
      captured.status = status;
      return response;
    },
    end(chunk?: string) {
      captured.body = chunk ? JSON.parse(chunk) : undefined;
    },
    setHeader() {},
    getHeader() {
      return undefined;
    }
  };
  return {
    response: response as unknown as ServerResponse,
    get status() {
      return captured.status;
    },
    get body() {
      return captured.body;
    }
  };
}

const thread = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'proj-1',
  hostId: 'host-1'
};

afterEach(() => {
  vi.mocked(getConversationThread).mockReset();
  vi.mocked(getHost).mockReset();
});

describe('host internal plugin tool-call', () => {
  it('invokes the plugin tool for a host-owned thread', async () => {
    vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
    vi.mocked(getConversationThread).mockReturnValue(thread as never);
    const invokeAgentTool = vi.fn(async () => ({
      success: true,
      contentItems: [{ type: 'inputText', text: '{"ok":true}' }]
    }));
    const ctx = {
      config: { getConfig: () => ({}) },
      db: {},
      plugins: { invokeAgentTool }
    } as unknown as ProductHttpContext;
    const captured = captureResponse();
    const handled = await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql',
        arguments: { query: 'SELECT Id FROM Account' }
      }),
      captured.response,
      ctx
    );
    expect(handled).toBe(true);
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: '{"ok":true}' }]
    });
    expect(invokeAgentTool).toHaveBeenCalledWith({
      name: 'sf_soql',
      input: { query: 'SELECT Id FROM Account' },
      ctx: expect.objectContaining({
        threadId: thread.id,
        projectId: 'proj-1'
      })
    });
  });

  it('rejects a browser Origin and a thread owned by another host', async () => {
    vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, hostId: 'other-host' } as never);
    const ctx = {
      config: { getConfig: () => ({}) },
      db: {},
      plugins: { invokeAgentTool: vi.fn() }
    } as unknown as ProductHttpContext;

    const browser = captureResponse();
    await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql'
      }, { origin: 'http://localhost:5173' }),
      browser.response,
      ctx
    );
    expect(browser.status).toBe(403);

    const foreign = captureResponse();
    await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql'
      }),
      foreign.response,
      ctx
    );
    expect(foreign.status).toBe(403);
  });

  it('returns an unsuccessful tool result when no plugin service is wired', async () => {
    vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
    vi.mocked(getConversationThread).mockReturnValue(thread as never);
    const captured = captureResponse();
    await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql'
      }),
      captured.response,
      {
        config: { getConfig: () => ({}) },
        db: {}
      } as unknown as ProductHttpContext
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      success: false,
      contentItems: [{ type: 'inputText', text: 'Unsupported tool: sf_soql' }]
    });
  });

  it('maps invoke failures and unknown threads to unsuccessful tool results', async () => {
    vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
    vi.mocked(getConversationThread).mockReturnValue(null);
    const missing = captureResponse();
    await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql'
      }),
      missing.response,
      { config: { getConfig: () => ({}) }, db: {} } as unknown as ProductHttpContext
    );
    expect(missing.body).toMatchObject({ success: false });

    vi.mocked(getConversationThread).mockReturnValue(thread as never);
    const invokeAgentTool = vi.fn(async () => {
      throw new Error('apex timeout');
    });
    const failed = captureResponse();
    await handleHostInternalHttp(
      request({
        sessionId: 'inst-1',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_apex'
      }),
      failed.response,
      {
        config: { getConfig: () => ({}) },
        db: {},
        plugins: { invokeAgentTool }
      } as unknown as ProductHttpContext
    );
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({
      success: false,
      contentItems: [{ type: 'inputText', text: expect.stringContaining('apex timeout') }]
    });
  });
});
