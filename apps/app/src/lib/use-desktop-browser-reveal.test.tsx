// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBrowserRevealRequest } from "@zana-ai/zcc-desktop-contract";
import { useDesktopBrowserReveal } from "./use-desktop-browser-reveal";
import { resetDesktopBrowserRevealQueueForTest, startDesktopBrowserRevealQueue } from "./desktop-browser-reveal-queue";

const listeners = vi.hoisted(
  () => new Set<(request: DesktopBrowserRevealRequest) => void>(),
);

vi.mock("./desktop-browser", () => ({
  getDesktopBrowserApi: () => ({
    onReveal: (listener: (request: DesktopBrowserRevealRequest) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  }),
}));

// main.tsx starts the queue at app init, before any thread view mounts.
beforeEach(() => startDesktopBrowserRevealQueue());

afterEach(() => {
  cleanup();
  listeners.clear();
  resetDesktopBrowserRevealQueueForTest();
});

function reveal(threadId = "thread-a") {
  act(() => {
    for (const listener of listeners)
      listener({
        threadId,
        tabId: "browser-a",
        desktopTarget: {
          hostId: "host",
          instanceId: "desktop",
          generation: "1",
        },
      });
  });
}

describe("desktop browser reveal focus", () => {
  it("adds a missing tab once without replaying it on render or after close", () => {
    const addTab = vi.fn(), activateTab = vi.fn();
    const { rerender } = renderHook(({ browserTabs }) => useDesktopBrowserReveal({
      threadId: "thread-a", isFocused: true, browserTabs, addTab, activateTab,
    }), { initialProps: { browserTabs: [] as { id: string }[] } });
    reveal();
    rerender({ browserTabs: [] });
    rerender({ browserTabs: [{ id: "browser-a" }] });
    rerender({ browserTabs: [] });
    expect(addTab).toHaveBeenCalledExactlyOnceWith({ id: "browser-a", kind: "browser", title: "Browser", url: "" });
    expect(activateTab).not.toHaveBeenCalled();
  });
  it("selects the focused thread's tab once it arrives", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ browserTabs }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused: true,
          browserTabs,
          activateTab,
        }),
      { initialProps: { browserTabs: [] as { id: string }[] } },
    );
    reveal();
    expect(activateTab).not.toHaveBeenCalled();
    rerender({ browserTabs: [{ id: "browser-a" }] });
    expect(activateTab).toHaveBeenCalledExactlyOnceWith("browser-a");
  });

  it("ignores other threads and keeps a background reveal until its thread is focused", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ isFocused }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused,
          browserTabs: [{ id: "browser-a" }],
          activateTab,
        }),
      { initialProps: { isFocused: false } },
    );
    reveal();
    reveal("thread-b");
    expect(activateTab).not.toHaveBeenCalled();
    rerender({ isFocused: true });
    expect(activateTab).toHaveBeenCalledExactlyOnceWith("browser-a");
    rerender({ isFocused: false });
    rerender({ isFocused: true });
    expect(activateTab).toHaveBeenCalledOnce();
  });

  it("adds a tab revealed before the thread view mounted", () => {
    const addTab = vi.fn(), activateTab = vi.fn();
    renderHook(() => useDesktopBrowserReveal({
      threadId: "thread-a", isFocused: false, browserTabs: [], addTab, activateTab,
    }));
    reveal();
    renderHook(() => useDesktopBrowserReveal({
      threadId: "thread-a", isFocused: true, browserTabs: [], addTab, activateTab,
    }));
    expect(addTab).toHaveBeenCalledExactlyOnceWith({ id: "browser-a", kind: "browser", title: "Browser", url: "" });
  });

  it("keeps an unfinished reveal for the next focus when focus leaves before the tab arrives", () => {
    const activateTab = vi.fn();
    const { rerender } = renderHook(
      ({ isFocused, browserTabs }) =>
        useDesktopBrowserReveal({
          threadId: "thread-a",
          isFocused,
          browserTabs,
          activateTab,
        }),
      {
        initialProps: { isFocused: true, browserTabs: [] as { id: string }[] },
      },
    );
    reveal();
    rerender({ isFocused: false, browserTabs: [] });
    expect(activateTab).not.toHaveBeenCalled();
    rerender({ isFocused: true, browserTabs: [{ id: "browser-a" }] });
    expect(activateTab).toHaveBeenCalledExactlyOnceWith("browser-a");
  });
});
