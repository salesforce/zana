// zcc-host-react:react
var React = globalThis.__ZCC_HOST_REACT__;
var Children = React.Children;
var Component = React.Component;
var Fragment = React.Fragment;
var StrictMode = React.StrictMode;
var Suspense = React.Suspense;
var cloneElement = React.cloneElement;
var createContext = React.createContext;
var createElement = React.createElement;
var createRef = React.createRef;
var forwardRef = React.forwardRef;
var isValidElement = React.isValidElement;
var lazy = React.lazy;
var memo = React.memo;
var startTransition = React.startTransition;
var useCallback = React.useCallback;
var useContext = React.useContext;
var useDebugValue = React.useDebugValue;
var useDeferredValue = React.useDeferredValue;
var useEffect = React.useEffect;
var useId = React.useId;
var useImperativeHandle = React.useImperativeHandle;
var useInsertionEffect = React.useInsertionEffect;
var useLayoutEffect = React.useLayoutEffect;
var useMemo = React.useMemo;
var useReducer = React.useReducer;
var useRef = React.useRef;
var useState = React.useState;
var useSyncExternalStore = React.useSyncExternalStore;
var useTransition = React.useTransition;
var version = React.version;

// ../../packages/plugin-sdk/src/app.ts
function pluginHost() {
  const host = globalThis.__ZCC_PLUGIN_HOST__;
  if (!host) throw new Error("plugin host is not available");
  return host;
}
function pluginRuntime() {
  return globalThis.__ZCC_PLUGIN_RUNTIME__ ?? {};
}
function missing(name) {
  throw new Error(`${name} is not available until the host plugin runtime is installed`);
}
async function callPluginRpc(pluginId, method, args) {
  return pluginHost().callRpc(pluginId, method, args);
}
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}
function useRpc() {
  return pluginRuntime().useRpc?.() ?? missing("useRpc");
}
function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}
function renderHostComponent(name, props) {
  const React3 = hostReact();
  const Impl = pluginRuntime()[name];
  if (!React3 || !Impl) return null;
  return React3.createElement(Impl, props);
}
function ThreadChat(props) {
  return renderHostComponent("ThreadChat", props);
}
function Markdown(props) {
  return renderHostComponent("Markdown", props);
}

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// app.tsx
var PLUGIN_ID = "side-chat";
var PANEL_ACTION_ID = "side-chat";
var PANEL_TAB_TITLE = "Side chat";
function parsePanelParams(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value;
  if (typeof record.threadId !== "string" || record.threadId.length === 0 || typeof record.sourceThreadId !== "string" || record.sourceThreadId.length === 0) {
    return null;
  }
  return {
    threadId: record.threadId,
    sourceThreadId: record.sourceThreadId,
    sourceMessageText: typeof record.sourceMessageText === "string" ? record.sourceMessageText : "",
    sourceSeqEnd: typeof record.sourceSeqEnd === "number" ? record.sourceSeqEnd : null
  };
}
function pluginToast(message, kind = "info") {
  const runtime = globalThis.__ZCC_PLUGIN_RUNTIME__;
  runtime?.toast?.(message, kind);
}
function createdThreadId(result) {
  if (typeof result === "object" && result !== null && typeof result.threadId === "string") {
    return result.threadId;
  }
  throw new Error("Plugin returned an unexpected createSideChat response.");
}
var inFlightOpens = /* @__PURE__ */ new Map();
function openKey({
  sourceThreadId,
  anchorText,
  sourceSeqEnd
}) {
  return `${sourceThreadId}|${sourceSeqEnd ?? "tip"}|${anchorText}`;
}
function openSideChat(args) {
  const key = openKey(args);
  const pending = inFlightOpens.get(key);
  if (pending !== void 0) return pending;
  const run = createAndOpenSideChat(args);
  inFlightOpens.set(key, run);
  run.then(
    () => inFlightOpens.delete(key),
    () => inFlightOpens.delete(key)
  );
  return run;
}
async function createAndOpenSideChat({
  sourceThreadId,
  anchorText,
  sourceSeqEnd,
  openPanel
}) {
  let threadId;
  try {
    threadId = createdThreadId(
      await callPluginRpc(PLUGIN_ID, "createSideChat", {
        sourceThreadId,
        ...sourceSeqEnd !== null ? { sourceSeqEnd } : {},
        anchorText
      })
    );
  } catch (error) {
    pluginToast(
      `Failed to start side chat: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    throw error;
  }
  openPanel({
    title: PANEL_TAB_TITLE,
    params: {
      threadId,
      sourceThreadId,
      sourceMessageText: anchorText,
      sourceSeqEnd
    }
  });
}
function ReplyingTo({ anchorText }) {
  const trimmed = anchorText.trim();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const measureRef = useCallback((node) => {
    if (node !== null) {
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    }
  }, []);
  if (trimmed.length === 0) return null;
  const clamped = !expanded;
  return /* @__PURE__ */ jsxs("div", { className: "thread-chat-replying", children: [
    /* @__PURE__ */ jsx("span", { className: "thread-chat-replying-label", children: "Replying to" }),
    /* @__PURE__ */ jsx(
      "div",
      {
        className: `thread-chat-replying-quote${overflows ? " is-overflow" : ""}`,
        role: overflows ? "button" : void 0,
        title: overflows ? expanded ? "Collapse" : "Show full message" : void 0,
        onClick: overflows ? () => setExpanded((value) => !value) : void 0,
        children: /* @__PURE__ */ jsx(
          "div",
          {
            ref: measureRef,
            className: `thread-chat-replying-body${clamped ? " is-clamped" : ""}${clamped && overflows ? " is-faded" : ""}`,
            children: /* @__PURE__ */ jsx(Markdown, { content: trimmed })
          }
        )
      }
    )
  ] });
}
function SideChatPanel({ params }) {
  const rpc = useRpc();
  const parsed = parsePanelParams(params);
  const sideChatThreadId = parsed?.threadId ?? null;
  const sourceThreadId = parsed?.sourceThreadId ?? null;
  const sendToMain = useCallback(
    async (message) => {
      if (sourceThreadId === null || sideChatThreadId === null) return;
      try {
        await rpc.call("sendToMain", {
          sourceThreadId,
          senderThreadId: sideChatThreadId,
          text: message.text
        });
        pluginToast("Sent to main thread");
      } catch (error) {
        pluginToast(
          `Failed to send to main thread: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    },
    [rpc, sideChatThreadId, sourceThreadId]
  );
  if (parsed === null) {
    return /* @__PURE__ */ jsx("div", { className: "thread-chat-leading", role: "alert", children: "This side chat tab is missing its thread reference." });
  }
  const messageActions = [
    {
      id: "send-to-main",
      title: "Send to main thread",
      icon: "Undo2",
      roles: ["assistant"],
      run: (message) => sendToMain(message)
    }
  ];
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }, children: /* @__PURE__ */ jsx(
    ThreadChat,
    {
      threadId: parsed.threadId,
      variant: "compact",
      layout: "contained",
      permissionPolicy: "editable",
      className: "plugin-thread-chat",
      leadingContent: /* @__PURE__ */ jsx(ReplyingTo, { anchorText: parsed.sourceMessageText }),
      messageActions,
      includePluginMessageActions: false
    }
  ) });
}
var app_default = definePluginApp((app) => {
  app.slots.messageAction({
    id: "reply-in-side-chat",
    title: "Reply in side chat",
    icon: "MessageCirclePlus",
    async run(context) {
      const anchorText = context.selectedText ?? context.message.text;
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText,
        sourceSeqEnd: context.message.sourceSeqEnd,
        openPanel: (options) => context.openPanel({ actionId: PANEL_ACTION_ID, ...options })
      });
    }
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Start side chat",
    icon: "MessageCirclePlus",
    component: SideChatPanel,
    layout: "flush",
    async run(context) {
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText: "",
        sourceSeqEnd: null,
        openPanel: (options) => context.openPanel(options)
      });
    }
  });
});
export {
  app_default as default,
  parsePanelParams
};
//# sourceMappingURL=app.js.map
