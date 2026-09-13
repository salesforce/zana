import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopBrowserCommand } from '@zana-ai/zcc-host-daemon-contract';
import { createDesktopBrowserAutomationHost } from './desktop-browser-automation.js';
import type { DesktopBrowserBroker } from './desktop-browser-broker.js';

function stubBroker(execute: DesktopBrowserBroker['execute']): DesktopBrowserBroker {
  return {
    registerWindow: vi.fn(),
    releaseWindow: vi.fn(),
    listInstances: () => [{ instanceId: 'inst', generation: 'gen', label: 'window' }],
    setHostId: vi.fn(),
    resetServer: vi.fn(),
    getTarget: () => null,
    getControl: () => null,
    takeOver: vi.fn(),
    subscribe: () => () => undefined,
    subscribeInstances: () => () => undefined,
    execute,
    dispose: vi.fn()
  } as unknown as DesktopBrowserBroker;
}

describe('desktop browser automation host', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an automation tab through the broker and reveals when visible', async () => {
    const execute = vi.fn(async (command: DesktopBrowserCommand) => {
      if (command.type !== 'desktop.browser.create_tab') throw new Error(command.type);
      return {
        tab: {
          tabId: command.tabId,
          threadId: command.threadId,
          url: command.url,
          title: '',
          control: null,
          profile: command.profile,
          presentation: command.presentation
        }
      };
    });
    const host = createDesktopBrowserAutomationHost(stubBroker(execute));
    const result = await host.open({
      threadId: 'thr-1',
      url: 'https://example.com',
      visible: true
    });
    expect(result.tabId).toBe(result.targetId);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'desktop.browser.create_tab',
      threadId: 'thr-1',
      url: 'https://example.com',
      presentation: 'reveal',
      profile: { kind: 'automation', id: result.tabId }
    }));
  });

  it('hides off-screen opens', async () => {
    const execute = vi.fn(async (command: DesktopBrowserCommand) => {
      if (command.type !== 'desktop.browser.create_tab') throw new Error(command.type);
      return {
        tab: {
          tabId: command.tabId,
          threadId: command.threadId,
          url: command.url,
          title: '',
          control: null,
          profile: command.profile,
          presentation: command.presentation
        }
      };
    });
    const host = createDesktopBrowserAutomationHost(stubBroker(execute));
    await host.open({ threadId: 'thr-1', url: 'https://example.com', visible: false });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ presentation: 'hidden' }));
  });

  it('rejects a disallowed URL before talking to the broker', async () => {
    const execute = vi.fn();
    const host = createDesktopBrowserAutomationHost(stubBroker(execute));
    await expect(
      host.open({ threadId: 'thr-1', url: 'file:///etc/passwd', visible: true })
    ).rejects.toThrow(/URL is not allowed/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('lists and closes through the broker', async () => {
    const execute = vi.fn(async (command: DesktopBrowserCommand) => {
      if (command.type === 'desktop.browser.list_tabs') {
        return {
          tabs: [{
            tabId: 'browser:1',
            threadId: 'thr-1',
            url: 'https://a.test',
            title: 'A',
            control: null,
            profile: { kind: 'automation' as const, id: 'browser:1' },
            presentation: 'reveal' as const
          }]
        };
      }
      if (command.type === 'desktop.browser.close_tab') return { ok: true as const };
      throw new Error(command.type);
    });
    const host = createDesktopBrowserAutomationHost(stubBroker(execute));
    const listed = await host.list('thr-1');
    expect(listed[0]?.tabId).toBe('browser:1');
    await host.close('browser:1', 'thr-1');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      type: 'desktop.browser.close_tab',
      tabId: 'browser:1'
    }));
  });
});
