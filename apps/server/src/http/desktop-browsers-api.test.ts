import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDesktopBrowsersApi } from './desktop-browsers-api.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getThreadTabs: vi.fn(),
  replaceThreadTabs: vi.fn()
}));

import { getConversationThread, getThreadTabs, replaceThreadTabs } from '@zana-ai/zcc-db';

function request(path: string, body: unknown = {}): IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, {
    method: 'POST',
    url: path,
    headers: { 'content-type': 'application/json' }
  }) as IncomingMessage;
}

function captureResponse(): { response: ServerResponse; status: number; body: unknown } {
  const captured = { status: 0, body: undefined as unknown };
  const response = Object.assign(new EventEmitter(), {
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
  });
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

const SCOPE = {
  hostId: 'local',
  instanceId: 'inst-1',
  generation: 'gen-1',
  threadId: 'thr_abcdefghij'
};

function productCtx(
  callHostOnlineRpc: (input: { command: { type: string } }) => Promise<unknown> = vi.fn()
) {
  return {
    db: {},
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc }
  } as never;
}

afterEach(() => {
  vi.mocked(getConversationThread).mockReset();
  vi.mocked(getThreadTabs).mockReset();
  vi.mocked(replaceThreadTabs).mockReset();
});

describe('handleDesktopBrowsersApi', () => {
  it('returns false for unrelated paths', async () => {
    const captured = captureResponse();
    await expect(
      handleDesktopBrowsersApi(request('/api/v1/hosts'), captured.response, {} as never, '/api/v1/hosts', 'POST')
    ).resolves.toBe(false);
  });

  it('lists instances through host-rpc', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      instances: [{ instanceId: 'inst-1', generation: 'gen-1', label: 'ZCC window 1' }]
    }));
    const captured = captureResponse();
    expect(
      await handleDesktopBrowsersApi(
        request('/api/v1/desktop-browsers/instances', { hostId: 'local' }),
        captured.response,
        productCtx(callHostOnlineRpc),
        '/api/v1/desktop-browsers/instances',
        'POST'
      )
    ).toBe(true);
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      instances: [{ instanceId: 'inst-1', generation: 'gen-1', label: 'ZCC window 1', hostId: 'local' }]
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'local',
      command: { type: 'desktop.browser.list_instances' }
    }));
  });

  it('rejects tab commands when the thread is not registered', async () => {
    vi.mocked(getConversationThread).mockReturnValue(null);
    const captured = captureResponse();
    await handleDesktopBrowsersApi(
      request('/api/v1/desktop-browsers/tabs', SCOPE),
      captured.response,
      productCtx(),
      '/api/v1/desktop-browsers/tabs',
      'POST'
    );
    expect(captured.status).toBe(404);
    expect(captured.body).toEqual({
      error: 'unknown-thread',
      message: 'thread is not registered'
    });
  });

  it('creates a tab with a fresh automation profile UUID', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    vi.mocked(getThreadTabs).mockReturnValue(null);
    vi.mocked(replaceThreadTabs).mockReturnValue({
      threadId: SCOPE.threadId,
      revision: 1,
      tabsJson: '[]',
      updatedAt: 1
    });
    const callHostOnlineRpc = vi.fn(async (input: {
      command: { type: string; tabId: string; profile: { kind: string; id: string } };
    }) => ({
      tab: {
        tabId: input.command.tabId,
        threadId: SCOPE.threadId,
        url: 'about:blank',
        title: '',
        control: null,
        profile: input.command.profile,
        presentation: 'hidden'
      }
    }));
    const captured = captureResponse();
    await handleDesktopBrowsersApi(
      request('/api/v1/desktop-browsers/create', SCOPE),
      captured.response,
      productCtx(callHostOnlineRpc),
      '/api/v1/desktop-browsers/create',
      'POST'
    );
    expect(captured.status).toBe(200);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'desktop.browser.create_tab',
        threadId: SCOPE.threadId,
        profile: { kind: 'automation', id: expect.stringMatching(/^[0-9a-f-]{36}$/i) }
      })
    }));
    const profileId = (callHostOnlineRpc.mock.calls[0]?.[0] as {
      command: { profile: { id: string } };
    }).command.profile.id;
    expect(profileId).not.toBe(SCOPE.threadId);
  });

  it('lists import sources and imports cookies over HTTP', async () => {
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'desktop.browser.list_import_sources') {
        return { sources: [{ id: 'chrome', name: 'Chrome', profiles: [{ directory: 'Default', name: 'Default' }] }] };
      }
      return { ok: true, imported: 3, skipped: 0, skippedDomains: [] };
    });
    const listed = captureResponse();
    await handleDesktopBrowsersApi(
      request('/api/v1/desktop-browsers/import-sources', {
        hostId: 'local',
        instanceId: 'inst-1',
        generation: 'gen-1'
      }),
      listed.response,
      productCtx(callHostOnlineRpc),
      '/api/v1/desktop-browsers/import-sources',
      'POST'
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      sources: [{ id: 'chrome', name: 'Chrome', profiles: [{ directory: 'Default', name: 'Default' }] }]
    });

    const imported = captureResponse();
    await handleDesktopBrowsersApi(
      request('/api/v1/desktop-browsers/import-cookies', {
        hostId: 'local',
        instanceId: 'inst-1',
        generation: 'gen-1',
        sourceId: 'chrome',
        sourceProfileDirectory: 'Default'
      }),
      imported.response,
      productCtx(callHostOnlineRpc),
      '/api/v1/desktop-browsers/import-cookies',
      'POST'
    );
    expect(imported.status).toBe(200);
    expect(imported.body).toEqual({ ok: true, imported: 3, skipped: 0, skippedDomains: [] });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'desktop.browser.import_cookies',
        profile: { kind: 'personal' }
      })
    }));
  });

  it('returns 503 when the desktop host-rpc hop is unavailable', async () => {
    const captured = captureResponse();
    await handleDesktopBrowsersApi(
      request('/api/v1/desktop-browsers/instances', { hostId: 'local' }),
      captured.response,
      { db: {}, hub: { emit: vi.fn() } } as never,
      '/api/v1/desktop-browsers/instances',
      'POST'
    );
    expect(captured.status).toBe(503);
  });
});
