// ../../packages/plugin-sdk/src/app.ts
function pluginRuntime() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__ ?? {};
}
function missing(name) {
  throw new Error(`${name} is not available until the host plugin runtime is installed`);
}
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}
function useRpc() {
  return pluginRuntime().useRpc?.() ?? missing("useRpc");
}
function useRealtime(channel, handler) {
  pluginRuntime().useRealtime?.(channel, handler);
}
function useComposerView() {
  return pluginRuntime().useComposerView?.() ?? missing("useComposerView");
}

// app.tsx
var REALTIME_CHANNEL = "provider-retry";
function payloadThreadId(payload) {
  if (typeof payload !== "object" || payload === null) return null;
  const threadId = payload.threadId;
  return typeof threadId === "string" ? threadId : null;
}
function retryLabel(retryAtMs) {
  return new Intl.DateTimeFormat(void 0, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(retryAtMs));
}
function ProviderRetryBanner() {
  const composerView = useComposerView();
  if (composerView.scope.kind !== "thread") return null;
  return hostReactCreate(ProviderRetryBannerForThread, {
    key: composerView.scope.threadId,
    threadId: composerView.scope.threadId
  });
}
function hostReactCreate(component, props) {
  const React = globalThis.__ZCC_HOST_REACT__;
  if (!React) return null;
  return React.createElement(component, props);
}
function ProviderRetryBannerForThread({ threadId }) {
  const React = globalThis.__ZCC_HOST_REACT__;
  if (!React) return null;
  const { useCallback, useEffect, useState } = React;
  const rpc = useRpc();
  const [cancelling, setCancelling] = useState(false);
  const [view, setView] = useState(null);
  const load = useCallback(async () => {
    const result = await rpc.call("providerRetryStatus", { threadId });
    setView(result && typeof result === "object" ? result.view : null);
  }, [rpc, threadId]);
  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      const result = await rpc.call("providerRetryCancel", { threadId });
      if (result && result.cancelled) {
        setView(null);
      } else {
        await load();
      }
    } catch {
      await load().catch(() => void 0);
    } finally {
      setCancelling(false);
    }
  }, [load, rpc, threadId]);
  useEffect(() => {
    void load().catch(() => void 0);
  }, [load]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (payloadThreadId(payload) === threadId) {
      void load().catch(() => void 0);
    }
  });
  if (view === null || typeof view !== "object") return null;
  const retryAtMs = view.retryAtMs;
  const providerId = typeof view.providerId === "string" ? view.providerId : "Provider";
  const retry = typeof retryAtMs !== "number" ? "Retrying automatically." : `Retrying ${retryLabel(retryAtMs)}.`;
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
        fontSize: 12
      }
    },
    React.createElement(
      "p",
      { style: { margin: 0, lineHeight: 1.4 } },
      `${providerId} usage limit reached. ${retry}`
    ),
    React.createElement(
      "button",
      {
        type: "button",
        disabled: cancelling,
        onClick: () => void cancel()
      },
      "Cancel"
    )
  );
}
var app_default = definePluginApp((app) => {
  app.composer.customize({
    id: "provider-retry-status",
    scopes: ["thread"],
    banners: [
      {
        id: "subscription-recovery",
        chrome: "bare",
        component: ProviderRetryBanner
      }
    ],
    actions: [
      {
        id: "retry-last",
        component: function RetryAction() {
          const React = globalThis.__ZCC_HOST_REACT__;
          if (!React) return null;
          return React.createElement(
            "span",
            { className: "plugin-composer-retry" },
            "Retry last turn from the thread menu."
          );
        }
      }
    ]
  });
});
export {
  app_default as default
};
