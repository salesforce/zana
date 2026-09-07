import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC, parseDesktopBrowserAutomationOpenRequest } from '@zana-ai/zcc-desktop-contract';
import { HIDDEN_AUTOMATION_VIEW_BOUNDS } from './desktop-browser-thread-scope.js';

const electronStub = vi.hoisted(() => {
  const send = vi.fn();
  const liveWindow = {
    isDestroyed: () => false,
    isFocused: () => true,
    webContents: {
      id: 7,
      isDestroyed: () => false,
      send
    }
  };
  return {
    send,
    liveWindow,
    getAllWindows: vi.fn(() => [liveWindow])
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronStub.getAllWindows
  }
}));

import {
  bindAutomationTargetThread,
  createDesktopBrowserAutomationHost,
  isPendingAutomationTab,
  unbindAutomationTargetThread
} from './desktop-browser-automation.js';
import type { DesktopBrowserViewManager } from './desktop-browser-view.js';

function stubManager(overrides: Partial<DesktopBrowserViewManager> = {}): DesktopBrowserViewManager {
  return {
    attach: vi.fn(),
    detach: vi.fn(),
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    beginWindowResize: vi.fn(),
    endWindowResize: vi.fn(),
    releaseWindow: vi.fn(),
    destroyAll: vi.fn(),
    registerAutomationTarget: vi.fn(() => true),
    unregisterAutomationTarget: vi.fn(() => true),
    listAutomationTargets: vi.fn(() => []),
    snapshotAutomationTarget: vi.fn(),
    clickAutomationTarget: vi.fn(),
    typeAutomationTarget: vi.fn(),
    evaluateAutomationTarget: vi.fn(),
    closeAutomationTarget: vi.fn(),
    ...overrides
  } as DesktopBrowserViewManager;
}

describe('desktop browser automation host', () => {
  afterEach(() => {
    electronStub.send.mockReset();
    electronStub.getAllWindows.mockReset();
    electronStub.getAllWindows.mockImplementation(() => [electronStub.liveWindow]);
  });

  it('marks pending automation tab ids from rememberTarget', () => {
    bindAutomationTargetThread('browser-auto:t', 'thr-1', 'browser:auto');
    expect(isPendingAutomationTab('browser:auto')).toBe(true);
    expect(isPendingAutomationTab('browser:personal')).toBe(false);
    unbindAutomationTargetThread('browser-auto:t');
    expect(isPendingAutomationTab('browser:auto')).toBe(false);
  });

  it('replaces a pending tab id when the same target is rebound', () => {
    bindAutomationTargetThread('browser-auto:t', 'thr-1', 'browser:a');
    bindAutomationTargetThread('browser-auto:t', 'thr-1', 'browser:b');
    expect(isPendingAutomationTab('browser:a')).toBe(false);
    expect(isPendingAutomationTab('browser:b')).toBe(true);
    unbindAutomationTargetThread('browser-auto:t');
  });

  it('hidden open attaches on main without broadcasting automationOpen', async () => {
    const manager = stubManager();
    const host = createDesktopBrowserAutomationHost(manager);
    const result = await host.open({
      threadId: 'thr-1',
      url: 'https://example.com',
      visible: false
    });
    expect(manager.attach).toHaveBeenCalledWith({
      hostWindow: electronStub.liveWindow,
      request: {
        tabId: result.tabId,
        url: 'https://example.com',
        bounds: HIDDEN_AUTOMATION_VIEW_BOUNDS,
        visible: false
      }
    });
    expect(manager.registerAutomationTarget).toHaveBeenCalledWith({
      tabId: result.tabId,
      targetId: result.targetId,
      hostWebContentsId: 7
    });
    expect(electronStub.send).not.toHaveBeenCalled();
    expect(isPendingAutomationTab(result.tabId)).toBe(true);
    unbindAutomationTargetThread(result.targetId);
  });

  it('visible open broadcasts the frozen automationOpen shape', async () => {
    const listed: Array<{ targetId: string; tabId: string; url: string; title: string | null }> = [];
    const manager = stubManager({
      listAutomationTargets: () => listed
    });
    electronStub.send.mockImplementation((_channel: string, payload: { targetId: string; tabId: string; url: string }) => {
      listed.push({ targetId: payload.targetId, tabId: payload.tabId, url: payload.url, title: null });
    });
    const host = createDesktopBrowserAutomationHost(manager);
    const result = await host.open({
      threadId: 'thr-1',
      url: 'https://example.com',
      visible: true
    });
    expect(manager.attach).not.toHaveBeenCalled();
    expect(electronStub.send).toHaveBeenCalledTimes(1);
    const [channel, payload] = electronStub.send.mock.calls[0] as [string, unknown];
    expect(channel).toBe(IPC.browser.automationOpen);
    expect(parseDesktopBrowserAutomationOpenRequest(payload).success).toBe(true);
    expect(payload).toEqual({
      threadId: 'thr-1',
      tabId: result.tabId,
      targetId: result.targetId,
      url: 'https://example.com'
    });
    expect(payload).not.toHaveProperty('visible');
    unbindAutomationTargetThread(result.targetId);
  });

  it('hidden open fails clearly when no window exists', async () => {
    electronStub.getAllWindows.mockImplementation(() => []);
    const manager = stubManager();
    const host = createDesktopBrowserAutomationHost(manager);
    await expect(
      host.open({ threadId: 'thr-1', url: 'https://example.com', visible: false })
    ).rejects.toThrow(/No connected app window can host a hidden browser tab/);
    expect(manager.attach).not.toHaveBeenCalled();
  });

  it('rejects a disallowed URL before attaching or broadcasting', async () => {
    const manager = stubManager();
    const host = createDesktopBrowserAutomationHost(manager);
    await expect(
      host.open({ threadId: 'thr-1', url: 'file:///etc/passwd', visible: true })
    ).rejects.toThrow(/URL is not allowed/);
    expect(manager.attach).not.toHaveBeenCalled();
    expect(electronStub.send).not.toHaveBeenCalled();
  });

  it('detaches when a hidden attach cannot register the target', async () => {
    const manager = stubManager({
      registerAutomationTarget: vi.fn(() => false)
    });
    const host = createDesktopBrowserAutomationHost(manager);
    await expect(
      host.open({ threadId: 'thr-1', url: 'https://example.com', visible: false })
    ).rejects.toThrow(/Failed to attach a hidden browser tab/);
    expect(manager.detach).toHaveBeenCalledOnce();
    const request = (manager.attach as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      request: { tabId: string };
    };
    expect(isPendingAutomationTab(request.request.tabId)).toBe(false);
  });
});
