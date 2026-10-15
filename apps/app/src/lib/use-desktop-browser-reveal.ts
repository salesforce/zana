import { useEffect, useState } from "react";
import type { DesktopBrowserRevealRequest } from "@zana-ai/zcc-desktop-contract";
import { getDesktopBrowserApi } from "./desktop-browser";

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

  useEffect(() => {
    if (!isFocused) return;
    const unsubscribe = getDesktopBrowserApi()?.onReveal?.((request) => {
      if (request.threadId === threadId) setPending(request);
    });
    return () => {
      unsubscribe?.();
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
      setPending(null);
      return;
    }
    activateTab(pending.tabId);
    setPending(null);
  }, [isFocused, threadId, pending, browserTabs, activateTab, addTab]);
}
