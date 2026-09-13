import { randomUUID } from 'node:crypto';
import type {
  DesktopBrowserCommand,
  DesktopBrowserResult
} from '@zana-ai/zcc-host-daemon-contract';
import { isAllowedBrowserUrl } from './desktop-browser-policy.js';
import {
  forgetPendingAutomationTab,
  rememberPendingAutomationTab
} from './desktop-browser-thread-scope.js';
import type { DesktopBrowserBroker } from './desktop-browser-broker.js';

export interface BrowserAutomationCommandHost {
  open(args: { threadId: string; url: string; visible: boolean }): Promise<{ targetId: string; tabId: string }>;
  list(threadId?: string): Promise<Array<{ targetId: string; tabId: string; url: string; title: string | null }>>;
  snapshot(targetId: string, threadId?: string): Promise<{
    targetId: string;
    tabId: string;
    url: string;
    title: string | null;
    dataUrl: string | null;
  }>;
  close(targetId: string, threadId?: string): Promise<void>;
}

const pendingOpens = new Map<string, { threadId: string; tabId: string; targetId: string }>();
const threadByTarget = new Map<string, string>();

function rememberTarget(targetId: string, threadId: string, tabId: string): void {
  const previous = pendingOpens.get(targetId);
  if (previous?.tabId && previous.tabId !== tabId) {
    forgetPendingAutomationTab(previous.tabId);
  }
  pendingOpens.set(targetId, { threadId, tabId, targetId });
  threadByTarget.set(targetId, threadId);
  rememberPendingAutomationTab(tabId);
}

function forgetTarget(targetId: string): void {
  const previous = pendingOpens.get(targetId);
  if (previous?.tabId) forgetPendingAutomationTab(previous.tabId);
  pendingOpens.delete(targetId);
  threadByTarget.delete(targetId);
}

export function bindAutomationTargetThread(targetId: string, threadId: string, tabId = ''): void {
  rememberTarget(targetId, threadId, tabId);
}

export function unbindAutomationTargetThread(targetId: string): void {
  forgetTarget(targetId);
}

function requireInstance(broker: DesktopBrowserBroker) {
  const [instance] = broker.listInstances();
  if (!instance) {
    throw new Error('No connected app window can host a browser tab. Is the desktop app open?');
  }
  return instance;
}

function assertOwned(targetId: string, threadId?: string): string {
  const owned = threadByTarget.get(targetId);
  if (threadId && owned && owned !== threadId) {
    throw new Error('unknown automation target');
  }
  return owned ?? threadId ?? '';
}

async function execute<T extends DesktopBrowserCommand>(
  broker: DesktopBrowserBroker,
  command: T
): Promise<Extract<DesktopBrowserResult, object>> {
  return broker.execute(command);
}

export function createDesktopBrowserAutomationHost(
  broker: DesktopBrowserBroker
): BrowserAutomationCommandHost {
  return {
    async open({ threadId, url, visible }) {
      if (url.length > 0 && !isAllowedBrowserUrl(url)) {
        throw new Error('URL is not allowed');
      }
      const instance = requireInstance(broker);
      const tabId = `browser:${randomUUID()}`;
      rememberTarget(tabId, threadId, tabId);
      try {
        await execute(broker, {
          type: 'desktop.browser.create_tab',
          instanceId: instance.instanceId,
          generation: instance.generation,
          threadId,
          tabId,
          url: url.length > 0 ? url : 'about:blank',
          profile: { kind: 'automation', id: tabId },
          presentation: visible ? 'reveal' : 'hidden'
        });
        return { targetId: tabId, tabId };
      } catch (err) {
        forgetTarget(tabId);
        throw err;
      }
    },
    async list(threadId) {
      if (!threadId) return [];
      const instance = requireInstance(broker);
      const result = await execute(broker, {
        type: 'desktop.browser.list_tabs',
        instanceId: instance.instanceId,
        generation: instance.generation,
        threadId
      });
      if (!('tabs' in result)) return [];
      return result.tabs.map((tab) => ({
        targetId: tab.tabId,
        tabId: tab.tabId,
        url: tab.url,
        title: tab.title || null
      }));
    },
    async snapshot(targetId, threadId) {
      const ownedThread = assertOwned(targetId, threadId);
      if (!ownedThread) throw new Error('unknown automation target');
      const instance = requireInstance(broker);
      const result = await execute(broker, {
        type: 'desktop.browser.capture_tab',
        instanceId: instance.instanceId,
        generation: instance.generation,
        threadId: ownedThread,
        tabId: targetId
      });
      if (!('base64' in result)) throw new Error('Native browser capture failed');
      const listed = await this.list(ownedThread);
      const tab = listed.find((row) => row.tabId === targetId);
      return {
        targetId,
        tabId: targetId,
        url: tab?.url ?? '',
        title: tab?.title ?? null,
        dataUrl: `data:image/jpeg;base64,${result.base64}`
      };
    },
    async close(targetId, threadId) {
      const ownedThread = assertOwned(targetId, threadId);
      if (!ownedThread) {
        forgetTarget(targetId);
        return;
      }
      const instance = requireInstance(broker);
      await execute(broker, {
        type: 'desktop.browser.close_tab',
        instanceId: instance.instanceId,
        generation: instance.generation,
        threadId: ownedThread,
        tabId: targetId
      });
      forgetTarget(targetId);
    }
  };
}

export { isPendingAutomationTab } from './desktop-browser-thread-scope.js';

export function peekPendingBrowserOpen(targetId: string): {
  threadId: string;
  tabId: string;
  targetId: string;
} | null {
  return pendingOpens.get(targetId) ?? null;
}
