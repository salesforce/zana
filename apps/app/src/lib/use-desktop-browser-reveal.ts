import { useEffect, useRef, useState } from "react";
import type { DesktopBrowserRevealRequest } from "@zana-ai/zcc-desktop-contract";
import {
  returnDesktopBrowserReveal,
  subscribeDesktopBrowserReveals,
  takeDesktopBrowserReveal,
} from "./desktop-browser-reveal-queue";

export function useDesktopBrowserReveal({
  threadId,
  isFocused,
  browserTabs,
  activateTab,
  addTab,
}: {
  threadId: string;
  isFocused: boolean;
  browserTabs: readonly { id: string }[];
  activateTab: (tabId: string) => void;
  addTab?: (tab: { id: string; kind: "browser"; title: string; url: string }) => void;
}) {
  const [pending, setPending] = useState<DesktopBrowserRevealRequest | null>(
    null,
  );
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Reveals for an unfocused thread wait in the queue and are taken as soon
  // as this thread's view is focused, so they never take over another view.
  useEffect(() => {
    if (!isFocused) return;
    const take = () => {
      const request = takeDesktopBrowserReveal(threadId);
      if (request) setPending(request);
    };
    const unsubscribe = subscribeDesktopBrowserReveals(take);
    take();
    return () => {
      unsubscribe();
      const unfinished = pendingRef.current;
      if (unfinished?.threadId === threadId) returnDesktopBrowserReveal(unfinished);
      setPending(null);
    };
  }, [isFocused, threadId]);

  useEffect(() => {
    if (!isFocused || pending === null || pending.threadId !== threadId) return;
    if (!browserTabs.some((tab) => tab.id === pending.tabId)) {
      if (!addTab) return;
      addTab({
        id: pending.tabId,
        kind: "browser",
        title: "Browser",
        url: "",
      });
      // addTab already opens/selects the tab. Consume the request before another
      // render or native close can replay it and recreate the tab.
      pendingRef.current = null;
      setPending(null);
      return;
    }
    activateTab(pending.tabId);
    pendingRef.current = null;
    setPending(null);
  }, [isFocused, threadId, pending, browserTabs, activateTab, addTab]);
}
