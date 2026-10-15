import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesktopBrowserCdpAdapter } from "./desktop-browser-cdp-adapter.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

const capture = vi.hoisted(() => vi.fn());
vi.mock("./desktop-browser-capture.js", () => ({
  captureDesktopBrowserCdpScreenshot: capture,
}));

beforeEach(() => capture.mockReset().mockResolvedValue({ data: "image" }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const scope = { hostWebContentsId: 1, threadId: "thread-a" };
  let current = true;
  let destroyed = false;
  let attached = false;
  let throttled = true;
  const debuggerApi = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true; }),
    detach: vi.fn(() => { attached = false; debuggerApi.emit("detach"); }),
    sendCommand: vi.fn(async (_method: string, _params: unknown, _sessionId?: string): Promise<Record<string, unknown>> => ({})),
  });
  const contents = Object.assign(new EventEmitter(), {
    debugger: debuggerApi,
    getOrCreateDevToolsTargetId: vi.fn(() => "native-main-frame"),
    getURL: () => "https://example.test/",
    getTitle: () => "Fixture",
    isDestroyed: () => destroyed,
    getBackgroundThrottling: () => throttled,
    setBackgroundThrottling: vi.fn((value: boolean) => { throttled = value; }),
  });
  const getAutomationTabs = vi.fn((requested: typeof scope) =>
    current && requested.threadId === scope.threadId && requested.hostWebContentsId === scope.hostWebContentsId
      ? [{ tabId: "a", webContents: contents as unknown as WebContents }]
      : [],
  );
  const subscribe = vi.fn(() => () => {});
  const createTab = vi.fn(async () => "a");
  const activateTab = vi.fn(async () => {});
  const closeTab = vi.fn(async () => {});
  const adapter = createDesktopBrowserCdpAdapter({
    manager: { getAutomationTabs, subscribeAutomationTabs: subscribe } as unknown as DesktopBrowserViewManager,
    createTab, activateTab, closeTab,
  });
  const page = adapter.listTabs(scope)[0]!;
  return { scope, adapter, page, contents, debuggerApi, createTab, activateTab, closeTab, subscribe,
    remove: () => { current = false; },
    destroy: () => { destroyed = true; },
    otherController: () => { attached = true; },
  };
}

describe("native browser CDP adapter", () => {
  it("uses Electron's native target ID and caches only the current WebContents", () => {
    const f = fixture();
    expect(f.page.targetId).toBe("native-main-frame");
    expect(f.adapter.listTabs(f.scope)).toEqual([f.page]);
    expect(f.contents.getOrCreateDevToolsTargetId).toHaveBeenCalledTimes(1);
    expect(f.page.url).toBe("https://example.test/");
    expect(f.page.title).toBe("Fixture");
    f.remove();
    expect(f.adapter.listTabs(f.scope)).toEqual([]);
    expect(() => f.page.url).toThrow("no longer available");
    expect(() => f.page.attach()).toThrow("no longer available");
  });

  it("owns attachment once and restores throttling and listeners on release", async () => {
    const f = fixture();
    f.page.attach();
    f.page.attach();
    expect(f.debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(f.contents.getBackgroundThrottling()).toBe(false);
    await f.page.send("Runtime.enable", {});
    expect(f.debuggerApi.sendCommand).toHaveBeenCalledWith("Emulation.setFocusEmulationEnabled", { enabled: true });
    f.page.detach();
    f.page.detach();
    expect(f.contents.getBackgroundThrottling()).toBe(true);
    expect(f.debuggerApi.detach).toHaveBeenCalledTimes(1);
    expect(f.contents.listenerCount("did-start-navigation")).toBe(0);
    expect(f.debuggerApi.listenerCount("detach")).toBe(0);
    await expect(f.page.send("Runtime.enable", {})).rejects.toThrow("not attached");
  });

  it("does not steal another debugger or access destroyed contents", () => {
    const f = fixture();
    f.otherController();
    expect(() => f.page.attach()).toThrow("already has a controller");
    f.destroy();
    expect(() => f.page.title).toThrow("no longer available");
  });

  it("forwards native sessions and uses the capture helper for screenshots", async () => {
    const f = fixture();
    f.page.attach();
    expect(await f.page.send("Runtime.evaluate", { expression: "1" }, "child")).toEqual({});
    expect(f.debuggerApi.sendCommand).toHaveBeenCalledWith("Runtime.evaluate", { expression: "1" }, "child");
    expect(await f.page.send("Page.captureScreenshot", { format: "png" }, "child")).toEqual({ data: "image" });
    expect(capture).toHaveBeenCalledWith(f.contents, { format: "png" }, "child");
  });

  it("warms input once per navigation and retries failed captures", async () => {
    const f = fixture();
    f.page.attach();
    capture.mockRejectedValueOnce(Error("capture failed"));
    await expect(f.page.send("Input.dispatchMouseEvent", {})).rejects.toThrow("capture failed");
    await f.page.send("Input.dispatchMouseEvent", {});
    await f.page.send("Input.dispatchTouchEvent", {});
    expect(capture).toHaveBeenCalledTimes(2);
    f.contents.emit("did-start-navigation");
    await f.page.send("Input.dispatchTouchEvent", {});
    expect(capture).toHaveBeenCalledTimes(3);
    f.page.detach();
  });

  it("cancels input warmed for a previous navigation", async () => {
    const f = fixture();
    f.page.attach();
    await f.page.send("Runtime.enable", {});
    const ready = deferred<{ data: string }>();
    capture.mockReturnValueOnce(ready.promise);
    const input = f.page.send("Input.dispatchMouseEvent", {});
    f.contents.emit("did-start-navigation");
    ready.resolve({ data: "image" });
    await expect(input).rejects.toThrow("changed before input");
    expect(f.debuggerApi.sendCommand).not.toHaveBeenCalledWith("Input.dispatchMouseEvent", {}, undefined);
    f.page.detach();
  });

  it("forwards valid events only while attached and current, and disposes subscriptions", () => {
    const f = fixture();
    const listener = vi.fn();
    const detached = vi.fn();
    const off = f.page.onMessage(listener);
    const offDetach = f.page.onDetach(detached);
    f.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", {}, "");
    expect(listener).not.toHaveBeenCalled();
    f.page.attach();
    f.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", { context: { id: 1 } }, "");
    f.debuggerApi.emit("message", {}, "Runtime.executionContextCreated", { invalid: undefined }, "");
    expect(listener).toHaveBeenCalledExactlyOnceWith("Runtime.executionContextCreated", { context: { id: 1 } }, "");
    f.remove();
    f.debuggerApi.emit("message", {}, "Page.loadEventFired", {}, "child");
    expect(listener).toHaveBeenCalledTimes(1);
    f.debuggerApi.detach();
    expect(detached).toHaveBeenCalledTimes(1);
    expect(f.contents.getBackgroundThrottling()).toBe(true);
    off(); offDetach();
    expect(f.debuggerApi.listenerCount("message")).toBe(0);
    expect(f.debuggerApi.listenerCount("detach")).toBe(0);
  });

  it("rejects aborted commands and commands whose attachment changed while awaiting native completion", async () => {
    const f = fixture();
    f.page.attach();
    await f.page.send("Runtime.enable", {});
    const signal = AbortSignal.abort(Error("cancelled"));
    await expect(f.page.send("Runtime.evaluate", {}, undefined, signal)).rejects.toThrow("cancelled");
    const ready = deferred<Record<string, unknown>>();
    f.debuggerApi.sendCommand.mockReturnValueOnce(ready.promise);
    const pending = f.page.send("Runtime.evaluate", {});
    f.page.detach(); f.page.attach();
    ready.resolve({});
    await expect(pending).rejects.toThrow("attachment changed");
    f.page.detach();
  });

  it("requires attachment readiness and fails interrupted or rejected focus setup", async () => {
    const f = fixture();
    const ready = deferred<Record<string, unknown>>();
    f.debuggerApi.sendCommand.mockReturnValueOnce(ready.promise);
    f.page.attach();
    const pending = f.page.send("Runtime.enable", {});
    f.page.detach(); f.page.attach();
    ready.resolve({});
    await expect(pending).rejects.toThrow("attachment changed");
    f.page.detach();
    f.debuggerApi.sendCommand.mockRejectedValueOnce(Error("focus failed"));
    f.page.attach();
    await expect(f.page.send("Runtime.enable", {})).rejects.toThrow("focus failed");
    f.destroy(); f.page.detach();
  });

  it("checks scope and cancellation on every tab operation and delegates subscriptions", async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    expect(await f.adapter.createTab(f.scope, "about:blank", signal)).toBe("a");
    await f.adapter.activateTab(f.scope, "a", signal);
    await f.adapter.closeTab(f.scope, "a", signal);
    for (const operation of [f.adapter.activateTab, f.adapter.closeTab]) {
      await expect(operation(f.scope, "foreign", signal)).rejects.toThrow("outside the requested scope");
      await expect(operation(f.scope, "a", AbortSignal.abort())).rejects.toThrow();
    }
    f.createTab.mockResolvedValueOnce("foreign");
    await expect(f.adapter.createTab(f.scope, "about:blank", signal)).rejects.toThrow("outside the requested scope");
    await expect(f.adapter.createTab(f.scope, "about:blank", AbortSignal.abort())).rejects.toThrow();
    const listener = vi.fn();
    f.adapter.subscribe(listener);
    expect(f.subscribe).toHaveBeenCalledWith(listener);
  });
});
