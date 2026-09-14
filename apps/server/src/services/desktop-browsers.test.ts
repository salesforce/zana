import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireDesktopBrowserControl,
  createDesktopBrowserTab,
  DESKTOP_BROWSER_MAX_LEASES,
  listDesktopBrowserInstances,
  openDesktopBrowserConnection,
  releaseDesktopBrowserControl,
  revokeThreadDesktopBrowserControl
} from './desktop-browsers.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getThreadTabs: vi.fn(),
  replaceThreadTabs: vi.fn()
}));

import { getConversationThread, getThreadTabs, replaceThreadTabs } from '@zana-ai/zcc-db';

const SCOPE = {
  hostId: 'local',
  instanceId: 'inst-1',
  generation: 'gen-1',
  threadId: 'thr_abcdefghij'
};

function ctx(callHostOnlineRpc: (input: { command: { type: string } }) => Promise<unknown>) {
  return {
    db: {},
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc }
  } as never;
}

function tab(over: Record<string, unknown> = {}) {
  return {
    tabId: 'browser:tab-1',
    threadId: SCOPE.threadId,
    url: 'about:blank',
    title: '',
    control: null,
    profile: { kind: 'automation', id: 'profile-1' },
    presentation: 'hidden',
    ...over
  };
}

afterEach(() => {
  vi.mocked(getConversationThread).mockReset();
  vi.mocked(getThreadTabs).mockReset();
  vi.mocked(replaceThreadTabs).mockReset();
});

describe('desktop browser leases', () => {
  it('refuses personal tabs unless allowPersonal is set, then TTL-releases', async () => {
    vi.useFakeTimers();
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'desktop.browser.list_tabs') {
        return { tabs: [tab({ profile: { kind: 'personal' } })] };
      }
      return { ok: true };
    });
    await expect(acquireDesktopBrowserControl(ctx(callHostOnlineRpc), {
      ...SCOPE,
      tabIds: ['browser:tab-1'],
      controllerLabel: 'script',
      ttlMs: 5000,
      allowPersonal: false
    })).rejects.toMatchObject({ status: 403, code: 'desktop_personal_handoff_required' });

    const product = ctx(callHostOnlineRpc);
    const lease = await acquireDesktopBrowserControl(product, {
      ...SCOPE,
      tabIds: ['browser:tab-1'],
      controllerLabel: 'script',
      ttlMs: 5000,
      allowPersonal: true
    });
    expect(lease.leaseId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: SCOPE.hostId,
      command: expect.objectContaining({
        type: 'desktop.browser.acquire_control',
        tabIds: ['browser:tab-1']
      })
    }));
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'desktop.browser.reveal_tab',
        tabId: 'browser:tab-1'
      })
    }));

    vi.advanceTimersByTime(5000);
    await vi.runAllTimersAsync();
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'desktop.browser.release_control',
        leaseId: lease.leaseId
      })
    }));
    vi.useRealTimers();
  });

  it('rejects a non-loopback CDP endpoint', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'desktop.browser.list_tabs') {
        return { tabs: [tab()] };
      }
      if (input.command.type === 'desktop.browser.open_connection') {
        return { wsEndpoint: 'ws://example.test:9222', expiresAt: Date.now() + 60_000 };
      }
      return { ok: true };
    });
    const product = ctx(callHostOnlineRpc);
    const lease = await acquireDesktopBrowserControl(product, {
      ...SCOPE,
      tabIds: ['browser:tab-1'],
      controllerLabel: 'script',
      ttlMs: 300000,
      allowPersonal: false
    });
    await expect(openDesktopBrowserConnection(product, { ...SCOPE, leaseId: lease.leaseId }))
      .rejects.toMatchObject({ status: 502, code: 'desktop_connection_scope' });
    await releaseDesktopBrowserControl(product, { ...SCOPE, leaseId: lease.leaseId });
  });

  it('revokes every lease for a stopped thread', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'desktop.browser.list_tabs') return { tabs: [tab()] };
      return { ok: true };
    });
    const product = ctx(callHostOnlineRpc);
    const lease = await acquireDesktopBrowserControl(product, {
      ...SCOPE,
      tabIds: ['browser:tab-1'],
      controllerLabel: 'script',
      ttlMs: 300000,
      allowPersonal: false
    });
    await revokeThreadDesktopBrowserControl(product, SCOPE.threadId);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'desktop.browser.release_control',
        leaseId: lease.leaseId
      })
    }));
  });

  it('mints a UUID automation profile instead of reusing the thread id', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    vi.mocked(getThreadTabs).mockReturnValue(null);
    vi.mocked(replaceThreadTabs).mockReturnValue({
      threadId: SCOPE.threadId,
      revision: 1,
      tabsJson: '[]',
      updatedAt: 1
    });
    const callHostOnlineRpc = vi.fn(async (input: {
      command: { type: string; tabId?: string; profile?: { id: string } };
    }) => ({
      tab: tab({ tabId: input.command.tabId, profile: input.command.profile })
    }));
    const result = await createDesktopBrowserTab(ctx(callHostOnlineRpc), {
      ...SCOPE,
      url: 'about:blank',
      presentation: 'hidden'
    });
    expect(result.tab.profile.kind).toBe('automation');
    expect(result.tab.profile.kind === 'automation' && result.tab.profile.id).not.toBe(SCOPE.threadId);
    expect(DESKTOP_BROWSER_MAX_LEASES).toBe(100);
  });

  it('maps a missing host session to desktop_browser_unavailable', async () => {
    await expect(listDesktopBrowserInstances({
      db: {},
      hub: { emit: vi.fn() }
    } as never, SCOPE.hostId)).rejects.toMatchObject({
      status: 503,
      code: 'desktop_browser_unavailable'
    });
  });
});
