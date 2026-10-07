import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireDesktopBrowserControl,
  createDesktopBrowserTab,
  desktopBrowserTabAction,
  syncDesktopBrowserTabs,
  persistDesktopBrowserTab,
  DESKTOP_BROWSER_MAX_LEASES,
  listDesktopBrowserInstances,
  openDesktopBrowserConnection,
  releaseDesktopBrowserControl,
  revokeThreadDesktopBrowserControl
} from './desktop-browsers.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getThreadPluginMetadata: vi.fn(),
  getThreadTabs: vi.fn(),
  replaceThreadTabs: vi.fn()
}));

import { getConversationThread, getThreadPluginMetadata, getThreadTabs, replaceThreadTabs } from '@zana-ai/zcc-db';

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
  vi.mocked(getThreadPluginMetadata).mockReset();
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


describe('remote browser automation', () => {
  it('rejects create/reveal without an RPC, preserves hidden acquire/connection/release, and never publishes tabs', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1', originPluginId: 'chat' } as never);
    vi.mocked(getThreadPluginMetadata).mockReturnValue({ corrupt: false, metadata: { interactionSurface: { kind: 'remote', label: 'Chat' } } });
    const rpc = vi.fn(async ({ command }: { command: { type: string } }) => {
      if (command.type === 'desktop.browser.create_tab') return { tab: tab() };
      if (command.type === 'desktop.browser.list_tabs') return { tabs: [tab()] };
      if (command.type === 'desktop.browser.open_connection') return { wsEndpoint: 'ws://127.0.0.1:54321/', expiresAt: Date.now() + 30_000 };
      return { ok: true };
    });
    const c = ctx(rpc);
    await expect(createDesktopBrowserTab(c, { ...SCOPE, url: 'about:blank', presentation: 'reveal' })).rejects.toMatchObject({ code: 'presentation_unavailable' });
    await expect(desktopBrowserTabAction(c, { ...SCOPE, tabId: 'browser:tab-1' }, 'reveal')).rejects.toMatchObject({ code: 'presentation_unavailable' });
    expect(rpc).not.toHaveBeenCalled();
    await createDesktopBrowserTab(c, { ...SCOPE, url: 'about:blank', presentation: 'hidden' });
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    expect(replaceThreadTabs).not.toHaveBeenCalled();
    const lease = await acquireDesktopBrowserControl(c, { ...SCOPE, tabIds: ['browser:tab-1'], ttlMs: 30_000, controllerLabel: 'Test', allowPersonal: false });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({
      type: 'desktop.browser.acquire_control', allowPresentation: false
    }) }));
    await expect(openDesktopBrowserConnection(c, lease)).resolves.toHaveProperty('wsEndpoint');
    await releaseDesktopBrowserControl(c, lease);
    await desktopBrowserTabAction(c, { ...SCOPE, tabId: 'browser:tab-1' }, 'close');
    expect(rpc.mock.calls.some(([x]) => x.command.type === 'desktop.browser.reveal_tab')).toBe(false);
  });
});

describe('desktop tab recovery', () => {
  const orphan = { id: 'browser:tab-1', kind: 'browser', environmentId: null, title: 'Old', url: 'about:blank', desktopTarget: { hostId: SCOPE.hostId, instanceId: 'old-window', generation: 'old-generation' } };
  function recoveryContext(rpc: any) {
    vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1' } as never);
    vi.mocked(getThreadPluginMetadata).mockReturnValue(null as never);
    vi.mocked(getThreadTabs).mockReturnValue({ revision: 1, tabsJson: JSON.stringify([orphan]) } as never);
    vi.mocked(replaceThreadTabs).mockReturnValue({ revision: 2 } as never);
    return ctx(rpc);
  }
  it('adopts a tab when its previous window is gone', async () => {
    const rpc = vi.fn(async () => ({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation, label: 'Current' }] }));
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    await vi.waitFor(() => expect(replaceThreadTabs).toHaveBeenCalled());
    const saved = JSON.parse(vi.mocked(replaceThreadTabs).mock.calls[0][1].tabsJson);
    expect(saved[0].desktopTarget).toMatchObject({ instanceId: SCOPE.instanceId, generation: SCOPE.generation });
  });
  it('closes the duplicate instead of taking a tab from another live window', async () => {
    const rpc = vi.fn(async ({ command }: any) => command.type === 'desktop.browser.list_instances'
      ? { instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }, { instanceId: 'old-window', generation: 'other' }] }
      : { ok: true });
    syncDesktopBrowserTabs(recoveryContext(rpc), SCOPE, [tab() as never]);
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ type: 'desktop.browser.close_tab' }) })));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
  });
  it('ignores an adoption result superseded by a newer snapshot', async () => {
    let complete!: (value: unknown) => void;
    const rpc = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    syncDesktopBrowserTabs(c, SCOPE, []);
    complete({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
  });
  it('ignores a generation that is no longer active', async () => {
    const rpc = vi.fn(async () => ({ instances: [{ instanceId: SCOPE.instanceId, generation: 'new-generation' }] }));
    syncDesktopBrowserTabs(recoveryContext(rpc), SCOPE, [tab() as never]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
  });

  it('publishes asynchronous adoption through the live hub after the original transaction', async () => {
    const rpc = vi.fn(async () => ({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] }));
    const c = recoveryContext(rpc) as any;
    const liveHub = { emit: vi.fn() };
    c.asyncHub = liveHub;
    syncDesktopBrowserTabs(c, SCOPE, [tab({ title: 'Recovered', url: 'https://example.test/' }) as never]);
    await vi.waitFor(() => expect(liveHub.emit).toHaveBeenCalledWith('threads:tabs', expect.objectContaining({ revision: 2 })));
    expect(c.hub.emit).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(replaceThreadTabs).mock.calls[0][1].tabsJson)[0]).toMatchObject({ title: 'Recovered', url: 'https://example.test/' });
  });

  it.each(['thread-deleted', 'remote-surface', 'tabs-deleted'])('abandons adoption when the authoritative state changes: %s', async change => {
    let complete!: (value: unknown) => void;
    const rpc = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    if (change === 'thread-deleted') vi.mocked(getConversationThread).mockReturnValue(null as never);
    if (change === 'remote-surface') {
      vi.mocked(getConversationThread).mockReturnValue({ id: SCOPE.threadId, projectId: 'p1', originPluginId: 'chat' } as never);
      vi.mocked(getThreadPluginMetadata).mockReturnValue({ corrupt: false, metadata: { interactionSurface: { kind: 'remote', label: 'Chat' } } });
    }
    if (change === 'tabs-deleted') vi.mocked(getThreadTabs).mockReturnValue(null as never);
    complete({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
  });

  it('keeps unrelated and newly reassigned tabs intact when reconciling the latest snapshot', async () => {
    let complete!: (value: unknown) => void;
    const rpc = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    const latest = [
      { ...orphan, desktopTarget: { ...orphan.desktopTarget, instanceId: SCOPE.instanceId } },
      { ...orphan, id: 'other-tab' }
    ];
    vi.mocked(getThreadTabs).mockReturnValue({ revision: 8, tabsJson: JSON.stringify(latest) } as never);
    complete({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does not publish an adoption that loses an optimistic revision race', async () => {
    const rpc = vi.fn(async () => ({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] }));
    const c = recoveryContext(rpc) as any;
    vi.mocked(replaceThreadTabs).mockReturnValue('conflict');
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    await vi.waitFor(() => expect(replaceThreadTabs).toHaveBeenCalled());
    expect(c.hub.emit).not.toHaveBeenCalled();
  });

  it('allows a fresh adoption after desktop discovery fails', async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error('Desktop disconnected'))
      .mockResolvedValue({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] });
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).not.toHaveBeenCalled();
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    await vi.waitFor(() => expect(replaceThreadTabs).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('an explicit tab write supersedes pending adoption', async () => {
    let complete!: (value: unknown) => void;
    const rpc = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    const c = recoveryContext(rpc);
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    persistDesktopBrowserTab(c, SCOPE, tab({ title: 'User chosen' }) as never);
    expect(replaceThreadTabs).toHaveBeenCalledTimes(1);
    complete({ instances: [{ instanceId: SCOPE.instanceId, generation: SCOPE.generation }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(replaceThreadTabs).toHaveBeenCalledTimes(1);
  });

  it('preserves an orphan when the host has no authoritative discovery capability', () => {
    const c = recoveryContext(vi.fn()) as any;
    delete c.hostHub;
    syncDesktopBrowserTabs(c, SCOPE, [tab() as never]);
    expect(replaceThreadTabs).not.toHaveBeenCalled();
  });
});
