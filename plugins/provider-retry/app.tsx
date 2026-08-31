import type { ComponentType } from "react";
import {
  definePluginApp,
  useComposerView,
  useRealtime,
  useRpc,
} from "@zana-ai/zcc-plugin-sdk/app";

const REALTIME_CHANNEL = "provider-retry";

function hostReact() {
  return (globalThis as { __ZCC_HOST_REACT__?: typeof import("react") })
    .__ZCC_HOST_REACT__;
}

function payloadThreadId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const threadId = (payload as { threadId?: unknown }).threadId;
  return typeof threadId === "string" ? threadId : null;
}

function retryLabel(retryAtMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(retryAtMs));
}

function ProviderRetryBanner() {
  const composerView = useComposerView();
  if (composerView.scope.kind !== "thread") return null;
  return hostReactCreate(ProviderRetryBannerForThread, {
    key: composerView.scope.threadId,
    threadId: composerView.scope.threadId,
  });
}

function hostReactCreate<P extends Record<string, unknown>>(
  component: ComponentType<P>,
  props: P & { key?: string },
) {
  const React = hostReact();
  if (!React) return null;
  return React.createElement(component, props);
}

function ProviderRetryBannerForThread({ threadId }: { threadId: string }) {
  const React = hostReact();
  if (!React) return null;
  const { useCallback, useEffect, useState } = React;
  const rpc = useRpc();
  const [cancelling, setCancelling] = useState(false);
  const [view, setView] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    const result = await rpc.call("providerRetryStatus", { threadId });
    const nextView =
      result && typeof result === "object"
        ? (result as { view?: unknown }).view
        : null;
    setView(
      nextView && typeof nextView === "object"
        ? (nextView as Record<string, unknown>)
        : null,
    );
  }, [rpc, threadId]);

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      const result = await rpc.call("providerRetryCancel", { threadId });
      if (
        result &&
        typeof result === "object" &&
        (result as { cancelled?: unknown }).cancelled
      ) {
        setView(null);
      } else {
        await load();
      }
    } catch {
      await load().catch(() => undefined);
    } finally {
      setCancelling(false);
    }
  }, [load, rpc, threadId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (payloadThreadId(payload) === threadId) {
      void load().catch(() => undefined);
    }
  });

  if (view === null || typeof view !== "object") return null;
  const retryAtMs = view.retryAtMs;
  const providerId = typeof view.providerId === "string" ? view.providerId : "Provider";
  const retry =
    typeof retryAtMs !== "number"
      ? "Retrying automatically."
      : `Retrying ${retryLabel(retryAtMs)}.`;

  return React.createElement(
    "section",
    {
      "aria-label": "Provider usage recovery",
      style: {
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 8,
        alignItems: "center",
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, var(--warning, #c9a227) 25%, transparent)",
        background: "color-mix(in srgb, var(--warning, #c9a227) 8%, transparent)",
        fontSize: 12,
      },
    },
    React.createElement(
      "p",
      { style: { margin: 0, lineHeight: 1.4 } },
      `${providerId} usage limit reached. ${retry}`,
    ),
    React.createElement(
      "button",
      {
        type: "button",
        disabled: cancelling,
        onClick: () => void cancel(),
      },
      "Cancel",
    ),
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "provider-retry-status",
    scopes: ["thread"],
    banners: [
      {
        id: "subscription-recovery",
        chrome: "bare",
        component: ProviderRetryBanner,
      },
    ],
    actions: [
      {
        id: "retry-last",
        component: function RetryAction() {
          const React = hostReact();
          if (!React) return null;
          return React.createElement(
            "span",
            { className: "plugin-composer-retry" },
            "Retry last turn from the thread menu.",
          );
        },
      },
    ],
  });
});
