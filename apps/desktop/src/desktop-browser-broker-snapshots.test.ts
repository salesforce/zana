import { describe, expect, it, vi } from "vitest";
import type { Session } from "electron";
import type { DesktopBrowserChanged } from "@zana-ai/zcc-host-daemon-contract";
import type { DesktopBrowserCdpAdapter } from "./desktop-browser-cdp.js";
import { IPC } from "@zana-ai/zcc-desktop-contract";

const cdp = vi.hoisted(() => ({ adapter: null as DesktopBrowserCdpAdapter | null }));
vi.mock("./desktop-browser-cdp.js", () => ({
  createDesktopBrowserCdpBridge: vi.fn(async ({ adapter }) => {
    cdp.adapter = adapter;
    return { grant: () => ({ endpoint: 'ws://127.0.0.1/fake', expiresAt: Date.now() + 60_000 }), close: async () => {} };
  })
}));

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  session: { fromPartition: () => ({}) },
  nativeImage: { createFromBuffer: () => ({}) },
}));

import { createDesktopBrowserBroker } from "./desktop-browser-broker.js";
import type {
  DesktopBrowserNativeTab,
  DesktopBrowserViewManager,
} from "./desktop-browser-view.js";

const THREAD_ID = "thr_23456789ab";
const PLUGIN_PANEL_ID = "plugin-panel:cloud-sandbox:cloud-machines:pane-1";

function nativeTab(tabId: string, threadId: string): DesktopBrowserNativeTab {
  return {
    tabId,
    threadId,
    url: "https://example.com",
    title: "Example",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    generation: "tab-generation",
    profile: { kind: "personal" },
    presentation: "reveal",
  };
}

function createFakeWindow() {
  return {
    webContents: {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
    },
    isDestroyed: () => false,
    focus: () => undefined,
    show: () => undefined,
    restore: () => undefined,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
  };
}

describe("desktop browser broker snapshots", () => {
  it('blocks downloads only while the owning window has active automation control', async () => {
    const tab = nativeTab('thread-tab', THREAD_ID);
    const setDownloadControlGuard = vi.fn<(guard: (windowId: number, tabId: string) => boolean) => void>();
    const manager = {
      listTabs: () => [tab], subscribeAutomationTabs: () => () => undefined,
      profileSession: () => ({}) as Session, destroyAll: () => undefined, setDownloadControlGuard
    };
    const broker = createDesktopBrowserBroker({ manager: manager as unknown as DesktopBrowserViewManager, product: 'Chrome/1' });
    const window = createFakeWindow();
    broker.registerWindow(window as never);
    broker.setHostId('host_local');
    const guard = setDownloadControlGuard.mock.calls[0][0];
    const target = broker.getTarget(window.webContents.id)!;
    try {
      expect(guard(999, tab.tabId)).toBe(false);
      expect(guard(window.webContents.id, tab.tabId)).toBe(false);
      await broker.execute({ type: 'desktop.browser.acquire_control', ...target, threadId: THREAD_ID,
        tabIds: [tab.tabId], leaseId: 'download-lease', controllerLabel: 'Automation', expiresAt: Date.now() + 60_000 });
      expect(guard(window.webContents.id, tab.tabId)).toBe(true);
      expect(guard(window.webContents.id, 'different-tab')).toBe(false);
      await broker.execute({ type: 'desktop.browser.release_control', ...target, threadId: THREAD_ID,
        leaseId: 'download-lease' });
      expect(guard(window.webContents.id, tab.tabId)).toBe(false);
      broker.releaseWindow(window.webContents.id);
      expect(guard(window.webContents.id, tab.tabId)).toBe(false);
    } finally { broker.dispose(); }
  });

  it("publishes snapshots only for real threads and keeps plugin-panel tabs local", () => {
    let tabs = [
      nativeTab("thread-tab", THREAD_ID),
      nativeTab("panel-tab", PLUGIN_PANEL_ID),
    ];
    let notifyTabsChanged: () => void = () => undefined;
    const manager: Pick<
      DesktopBrowserViewManager,
      "listTabs" | "subscribeAutomationTabs" | "profileSession" | "destroyAll"
    > = {
      listTabs: ({ threadId }) =>
        tabs.filter((tab) => threadId === null || tab.threadId === threadId),
      subscribeAutomationTabs: (listener) => {
        notifyTabsChanged = listener;
        return () => undefined;
      },
      profileSession: () => ({}) as Session,
      destroyAll: () => undefined,
    };
    const broker = createDesktopBrowserBroker({
      manager: manager as DesktopBrowserViewManager,
      product: "Chrome/1",
    });
    const events: DesktopBrowserChanged[] = [];
    broker.subscribe((event) => events.push(event));
    const window = createFakeWindow();

    broker.registerWindow(window as never);
    broker.setHostId("host_local");
    tabs = [
      { ...tabs[0]!, title: "Navigated" },
      { ...tabs[1]!, title: "Navigated" },
    ];
    notifyTabsChanged();

    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map((event) => event.threadId))).toEqual(
      new Set([THREAD_ID]),
    );
    expect(
      events.flatMap((event) => event.tabs.map((tab) => tab.tabId)),
    ).not.toContain("panel-tab");
  });
});

describe("desktop browser broker window cleanup", () => {
  it.each([false, true])(
    "releases a destroyed window with active lease: %s",
    async (withLease) => {
      const tab = nativeTab("thread-tab", THREAD_ID);
      const manager: Pick<
        DesktopBrowserViewManager,
        "listTabs" | "subscribeAutomationTabs" | "profileSession" | "destroyAll"
      > = {
        listTabs: () => [tab],
        subscribeAutomationTabs: () => () => undefined,
        profileSession: () => ({}) as Session,
        destroyAll: () => undefined,
      };
      const broker = createDesktopBrowserBroker({
        manager: manager as DesktopBrowserViewManager,
        product: "Chrome/1",
      });
      const window = createFakeWindow();
      const webContents = window.webContents;
      let destroyed = false;
      window.isDestroyed = () => destroyed;
      Object.defineProperty(window, "webContents", {
        get() {
          if (destroyed) throw new TypeError("Object has been destroyed");
          return webContents;
        },
      });
      broker.registerWindow(window as never);
      broker.setHostId("host_local");
      const target = broker.getTarget(webContents.id)!;
      if (withLease) {
        await broker.execute({
          type: "desktop.browser.acquire_control",
          ...target,
          threadId: THREAD_ID,
          tabIds: [tab.tabId],
          leaseId: "cleanup-lease",
          controllerLabel: "Cleanup test",
          expiresAt: Date.now() + 60_000,
        });
      }
      const registryChanged = vi.fn();
      broker.subscribeInstances(registryChanged);
      destroyed = true;
      expect(() => broker.releaseWindow(webContents.id)).not.toThrow();
      expect(broker.listInstances()).toEqual([]);
      expect(registryChanged).toHaveBeenCalledTimes(1);
      expect(() => broker.releaseWindow(webContents.id)).not.toThrow();
      broker.dispose();
    },
  );
});

describe("desktop browser preview reuse", () => {
  it.each([
    { allowPresentation: false, presentation: 'reveal' as const, reveals: false },
    { allowPresentation: true, presentation: 'hidden' as const, reveals: false },
    { allowPresentation: true, presentation: 'reveal' as const, reveals: true },
  ])('gates CDP new/reused page presentation and activation: %j', async ({ allowPresentation, presentation, reveals }) => {
    const first = { ...nativeTab('first', THREAD_ID), presentation, profile: { kind: 'automation' as const, id: 'test' } };
    const tabs = [first];
    const manager = {
      listTabs: () => tabs,
      getAutomationTabs: () => tabs,
      createTab: (request: { tabId: string; url: string }) => {
        const next = { ...first, ...request, presentation: 'hidden' as const };
        tabs.push(next);
        return next;
      },
      subscribeAutomationTabs: () => () => {},
      profileSession: () => ({}) as Session,
      destroyAll: () => {},
    };
    const broker = createDesktopBrowserBroker({ manager: manager as unknown as DesktopBrowserViewManager, product: 'Chrome/1' });
    const window = createFakeWindow();
    broker.registerWindow(window as never);
    broker.setHostId('host_local');
    const scope = { ...broker.getTarget(window.webContents.id)!, threadId: THREAD_ID, leaseId: 'presentation-lease' };
    try {
      await broker.execute({ type: 'desktop.browser.acquire_control', ...scope, tabIds: ['first'], controllerLabel: 'test', expiresAt: Date.now() + 60_000, allowPresentation });
      await broker.execute({ type: 'desktop.browser.open_connection', ...scope, tabIds: ['first'] });
      const adapter = cdp.adapter!;
      const adapterScope = { hostWebContentsId: window.webContents.id, threadId: THREAD_ID };
      const signal = new AbortController().signal;
      const next = await adapter.createTab!(adapterScope, 'https://other.example/', signal);
      expect(await adapter.createTab!(adapterScope, 'https://other.example/', signal)).toBe(next);
      await adapter.activateTab!(adapterScope, next, signal);
      expect(tabs).toHaveLength(2);
      expect(window.webContents.send.mock.calls.filter(([channel]) => channel === IPC.browser.reveal)).toHaveLength(reveals ? 3 : 0);
    } finally { broker.dispose(); }
  });

  it("reuses equivalent URLs only inside the requested thread and profile", async () => {
    const personal = { ...nativeTab("personal", THREAD_ID), url: "http://localhost:5173/" };
    const automation = { ...nativeTab("automation", THREAD_ID), url: personal.url, profile: { kind: "automation" as const, id: "run-a" } };
    const otherThread = { ...automation, tabId: "other-thread", threadId: "thr_abcdefghij" };
    const tabs = [personal, automation, otherThread];
    const createTab = vi.fn((request) => {
      const tab = { ...nativeTab(request.tabId, request.threadId), url: request.url, profile: request.profile };
      tabs.push(tab);
      return tab;
    });
    const manager = {
      listTabs: ({ threadId }: { threadId: string | null }) => tabs.filter(tab => threadId === null || tab.threadId === threadId),
      createTab,
      subscribeAutomationTabs: () => () => undefined,
      profileSession: () => ({}) as Session,
      destroyAll: () => undefined,
    };
    const broker = createDesktopBrowserBroker({ manager: manager as unknown as DesktopBrowserViewManager, product: "Chrome/1" });
    const window = createFakeWindow();
    broker.registerWindow(window as never);
    broker.setHostId("host_local");
    const target = broker.getTarget(window.webContents.id)!;
    const create = (tabId: string, profile: DesktopBrowserNativeTab["profile"], url = "http://127.0.0.1:5173/another-route") => broker.execute({
      type: "desktop.browser.create_tab", ...target, threadId: THREAD_ID, tabId, url, profile, presentation: "hidden"
    });
    try {
      await expect(create("duplicate", automation.profile)).resolves.toMatchObject({ tab: { tabId: "automation" } });
      await expect(create("personal-duplicate", personal.profile)).resolves.toMatchObject({ tab: { tabId: "personal" } });
      expect(createTab).not.toHaveBeenCalled();
      await expect(create("new-profile", { kind: "automation", id: "run-b" })).resolves.toMatchObject({ tab: { tabId: "new-profile" } });
      await expect(create("blank", automation.profile, "about:blank")).resolves.toMatchObject({ tab: { tabId: "blank" } });
      await expect(create("other-port", automation.profile, "http://localhost:5174/")).resolves.toMatchObject({ tab: { tabId: "other-port" } });
      expect(createTab).toHaveBeenCalledTimes(3);
    } finally { broker.dispose(); }
  });
});
