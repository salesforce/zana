import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopBrowserRevealRequest,
  DesktopBrowserTabRef,
} from "@zana-ai/zcc-desktop-contract";
import {
  resetDesktopBrowserRevealQueueForTest,
  returnDesktopBrowserReveal,
  startDesktopBrowserRevealQueue,
  subscribeDesktopBrowserReveals,
  takeDesktopBrowserReveal,
} from "./desktop-browser-reveal-queue";

const bridge = vi.hoisted(() => ({
  api: null as null | {
    onReveal?: (listener: (request: DesktopBrowserRevealRequest) => void) => () => void;
    onClosed?: (listener: (tab: DesktopBrowserTabRef) => void) => () => void;
  },
  reveal: new Set<(request: DesktopBrowserRevealRequest) => void>(),
  closed: new Set<(tab: DesktopBrowserTabRef) => void>(),
}));

vi.mock("./desktop-browser", () => ({ getDesktopBrowserApi: () => bridge.api }));

function installBridge(withClosed = true) {
  bridge.api = {
    onReveal: (listener) => {
      bridge.reveal.add(listener);
      return () => bridge.reveal.delete(listener);
    },
    ...(withClosed
      ? {
          onClosed: (listener: (tab: DesktopBrowserTabRef) => void) => {
            bridge.closed.add(listener);
            return () => bridge.closed.delete(listener);
          },
        }
      : {}),
  };
}

const request = (threadId: string, tabId = `tab-${threadId}`): DesktopBrowserRevealRequest =>
  ({ threadId, tabId, desktopTarget: null });
const emit = (r: DesktopBrowserRevealRequest) => { for (const l of bridge.reveal) l(r); };
const close = (tabId: string) => { for (const l of bridge.closed) l({ tabId }); };

afterEach(() => {
  resetDesktopBrowserRevealQueueForTest();
  bridge.api = null;
  bridge.reveal.clear();
  bridge.closed.clear();
});

describe("desktop browser reveal queue", () => {
  it("does nothing without a desktop bridge", () => {
    startDesktopBrowserRevealQueue();
    installBridge();
    expect(bridge.reveal.size).toBe(0);
    startDesktopBrowserRevealQueue();
    expect(bridge.reveal.size).toBe(1);
  });

  it("subscribes once and keeps only the latest reveal per thread", () => {
    installBridge();
    const listener = vi.fn();
    const unsubscribe = subscribeDesktopBrowserReveals(listener);
    startDesktopBrowserRevealQueue();
    expect(bridge.reveal.size).toBe(1);
    emit(request("a", "first"));
    emit(request("a", "second"));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(takeDesktopBrowserReveal("a")?.tabId).toBe("second");
    expect(takeDesktopBrowserReveal("a")).toBeNull();
    unsubscribe();
    emit(request("a"));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("drops reveals whose native tab closed", () => {
    installBridge();
    startDesktopBrowserRevealQueue();
    emit(request("a", "shared"));
    emit(request("b"));
    close("shared");
    expect(takeDesktopBrowserReveal("a")).toBeNull();
    expect(takeDesktopBrowserReveal("b")?.tabId).toBe("tab-b");
  });

  it("works when the bridge cannot report closed tabs", () => {
    installBridge(false);
    startDesktopBrowserRevealQueue();
    emit(request("a"));
    expect(takeDesktopBrowserReveal("a")?.tabId).toBe("tab-a");
  });

  it("bounds the number of threads waiting", () => {
    installBridge();
    startDesktopBrowserRevealQueue();
    for (let index = 0; index < 33; index++) emit(request(`t${index}`));
    expect(takeDesktopBrowserReveal("t0")).toBeNull();
    expect(takeDesktopBrowserReveal("t1")?.tabId).toBe("tab-t1");
    expect(takeDesktopBrowserReveal("t32")?.tabId).toBe("tab-t32");
  });

  it("returns an unfinished reveal unless a newer one arrived", () => {
    installBridge();
    startDesktopBrowserRevealQueue();
    returnDesktopBrowserReveal(request("a", "old"));
    expect(takeDesktopBrowserReveal("a")?.tabId).toBe("old");
    emit(request("a", "new"));
    returnDesktopBrowserReveal(request("a", "old"));
    expect(takeDesktopBrowserReveal("a")?.tabId).toBe("new");
  });
});
