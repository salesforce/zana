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

// ../../../../../../Applications/Zana.app/Contents/Resources/zcc-cli/runtime/plugin-sdk-app.js
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

// lightbox-store.ts
var target = null;
var listeners = /* @__PURE__ */ new Set();
function publish(next) {
  target = next;
  for (const listener of [...listeners]) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function openLightbox(next) {
  publish(next);
}
function closeLightbox() {
  if (target !== null) publish(null);
}
function useLightboxTarget() {
  return useSyncExternalStore(
    subscribe,
    () => target,
    () => null
  );
}

// preview-directive.ts
var PREVIEW_DIRECTIVE_ID = "browser-preview";

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// app.tsx
var MIN_POLL_INTERVAL_MS = 400;
var MAX_RETRY_INTERVAL_MS = 15e3;
var MAX_CONSECUTIVE_FAILURES = 5;
var SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var STATUS_LABEL = {
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
  unavailable: "Unavailable"
};
var cardStyle = {
  margin: "0.5rem 0",
  overflow: "hidden",
  borderRadius: "0.5rem",
  border: "1px solid rgba(128, 128, 128, 0.35)",
  background: "rgba(128, 128, 128, 0.06)"
};
var headerStyle = {
  display: "flex",
  alignItems: "stretch",
  width: "100%"
};
var toggleButtonStyle = {
  display: "flex",
  flex: "1 1 auto",
  minWidth: 0,
  alignItems: "center",
  gap: "0.375rem",
  padding: "0.375rem 0.75rem",
  background: "transparent",
  border: "none",
  color: "inherit",
  font: "inherit",
  fontSize: "0.75rem",
  cursor: "pointer",
  textAlign: "left"
};
var expandButtonStyle = {
  display: "flex",
  width: "2rem",
  flex: "0 0 auto",
  alignItems: "center",
  justifyContent: "center",
  borderLeft: "1px solid rgba(128, 128, 128, 0.35)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  fontSize: "0.75rem"
};
var truncate = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
var bodyStyle = {
  borderTop: "1px solid rgba(128, 128, 128, 0.35)",
  padding: "0.5rem"
};
var backdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1e3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
  background: "rgba(0, 0, 0, 0.6)"
};
var dialogStyle = {
  maxWidth: "min(96vw, 72rem)",
  maxHeight: "92dvh",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "1rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(128, 128, 128, 0.35)",
  background: "var(--canvas, #1b1b1b)",
  color: "inherit",
  overflow: "auto"
};
function subscribeDocumentVisibility(onChange) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
function readDocumentVisible() {
  return document.visibilityState !== "hidden";
}
function useDocumentVisible() {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true
  );
}
function useInViewport() {
  const [element, setElement] = useState(null);
  const [inViewport, setInViewport] = useState(true);
  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInViewport(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, inViewport];
}
function pageLocation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    if (parsed.protocol === "about:") return url;
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
    return parsed.protocol;
  } catch {
    return url.slice(0, 80);
  }
}
function pageTitle(frame) {
  const title = frame?.title.trim() ?? "";
  return title === "" || title === frame?.url ? "Headless browser" : title;
}
function useLivePreview(args) {
  const { threadId, sessionId, enabled, size, initialFrame } = args;
  const rpc = useRpc();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [frame, setFrame] = useState(initialFrame);
  const [status, setStatus] = useState(
    initialFrame ? "live" : "connecting"
  );
  const settled = status === "ended" || status === "unavailable";
  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;
    let timeout = null;
    let afterSequence = 0;
    let failures = 0;
    const poll = async () => {
      const startedAt = Date.now();
      let delayMs;
      try {
        const result = await rpcRef.current.call("preview", {
          threadId,
          sessionId,
          afterSequence,
          size
        });
        if (cancelled) return;
        if (result.session.state !== "ready" || result.session.backend !== "local") {
          setStatus(
            result.session.backend === "local" ? "ended" : "unavailable"
          );
          return;
        }
        failures = 0;
        if (result.frame) {
          afterSequence = result.frame.sequence;
          setFrame(result.frame);
          setStatus("live");
        }
        delayMs = Math.max(0, MIN_POLL_INTERVAL_MS - (Date.now() - startedAt));
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          setStatus("unavailable");
          return;
        }
        delayMs = Math.min(1e3 * 2 ** failures, MAX_RETRY_INTERVAL_MS);
      }
      timeout = setTimeout(() => void poll(), delayMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [enabled, sessionId, settled, size, threadId]);
  return { frame, status };
}
function PreviewImage({
  frame,
  status,
  title,
  maxHeight
}) {
  const aspect = frame ?? { width: 16, height: 9 };
  if (!frame && status !== "connecting") return null;
  const containerStyle = {
    overflow: "hidden",
    borderRadius: "0.375rem",
    border: "1px solid rgba(128, 128, 128, 0.35)",
    margin: "0 auto",
    aspectRatio: `${aspect.width} / ${aspect.height}`,
    width: maxHeight === void 0 ? "100%" : `min(100%, calc(${maxHeight} * ${aspect.width / aspect.height}))`,
    maxWidth: maxHeight === void 0 ? "28rem" : void 0
  };
  return /* @__PURE__ */ jsx("div", { style: containerStyle, children: frame ? /* @__PURE__ */ jsx(
    "img",
    {
      src: `data:${frame.mimeType};base64,${frame.data}`,
      alt: status === "live" ? `Live view of ${title}` : `Last view of ${title}`,
      draggable: false,
      style: {
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "contain",
        opacity: status === "live" ? 1 : 0.6
      }
    }
  ) : /* @__PURE__ */ jsx(
    "div",
    {
      role: "status",
      "aria-busy": "true",
      "aria-label": "Loading browser preview",
      style: {
        width: "100%",
        height: "100%",
        background: "rgba(128, 128, 128, 0.15)"
      }
    }
  ) });
}
function Notice({ children }) {
  return /* @__PURE__ */ jsx("div", { role: "alert", style: { fontSize: "0.875rem", opacity: 0.75 }, children });
}
function BrowserPreviewDirective({
  attributes,
  source,
  message
}) {
  const sessionId = attributes.session?.trim() ?? "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return /* @__PURE__ */ jsxs(Notice, { children: [
      "browser-preview requires a valid session attribute, e.g.",
      " ",
      /* @__PURE__ */ jsxs("code", { children: [
        "::browser-preview",
        '{session="\u2026"}'
      ] })
    ] });
  }
  return /* @__PURE__ */ jsx(
    BrowserPreviewCard,
    {
      threadId: message.threadId,
      sessionId,
      source
    }
  );
}
function BrowserPreviewCard({
  threadId,
  sessionId,
  source
}) {
  const visible = useDocumentVisible();
  const [observe, inViewport] = useInViewport();
  const [expanded, setExpanded] = useState(true);
  const target2 = useLightboxTarget();
  const enlarged = target2?.sessionId === sessionId;
  const bodyId = useId();
  const toggleId = useId();
  const { frame, status } = useLivePreview({
    threadId,
    sessionId,
    enabled: visible && inViewport && expanded && !enlarged,
    size: "thumbnail",
    initialFrame: null
  });
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";
  return /* @__PURE__ */ jsxs(
    "section",
    {
      ref: observe,
      "aria-label": "Browser preview",
      title: source,
      style: cardStyle,
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            role: "group",
            "aria-label": `Browser preview controls: ${title}`,
            style: headerStyle,
            children: [
              /* @__PURE__ */ jsxs(
                "button",
                {
                  type: "button",
                  id: toggleId,
                  "aria-expanded": expanded,
                  "aria-controls": bodyId,
                  "aria-label": `Browser preview: ${title}`,
                  onClick: () => setExpanded((value) => !value),
                  style: toggleButtonStyle,
                  children: [
                    /* @__PURE__ */ jsx("span", { "aria-hidden": true, style: { flex: "0 0 auto" }, children: "\u{1F310}" }),
                    /* @__PURE__ */ jsxs(
                      "span",
                      {
                        style: {
                          display: "flex",
                          minWidth: 0,
                          flex: "1 1 auto",
                          alignItems: "center",
                          gap: "0.375rem"
                        },
                        children: [
                          /* @__PURE__ */ jsx("span", { style: truncate, title, children: title }),
                          location ? /* @__PURE__ */ jsx(
                            "span",
                            {
                              style: { ...truncate, flex: "0 1 auto", opacity: 0.7 },
                              title: frame?.url,
                              children: location
                            }
                          ) : null
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsx("span", { style: { flex: "0 0 auto", opacity: 0.7 }, children: STATUS_LABEL[status] }),
                    /* @__PURE__ */ jsx("span", { "aria-hidden": true, style: { flex: "0 0 auto" }, children: expanded ? "\u25BE" : "\u25B8" })
                  ]
                }
              ),
              frame ? /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  "aria-haspopup": "dialog",
                  "aria-label": "Expand browser preview",
                  title: "Expand",
                  onClick: () => openLightbox({ threadId, sessionId, frame }),
                  style: expandButtonStyle,
                  children: "\u2922"
                }
              ) : null
            ]
          }
        ),
        expanded && (frame || status === "connecting") ? /* @__PURE__ */ jsx("div", { id: bodyId, role: "region", "aria-labelledby": toggleId, style: bodyStyle, children: /* @__PURE__ */ jsx(PreviewImage, { frame, status, title }) }) : null,
        enlarged && target2 ? /* @__PURE__ */ jsx(BrowserPreviewLightbox, { target: target2 }) : null
      ]
    }
  );
}
function BrowserPreviewLightbox({ target: target2 }) {
  const visible = useDocumentVisible();
  const { frame, status } = useLivePreview({
    threadId: target2.threadId,
    sessionId: target2.sessionId,
    enabled: visible,
    size: "full",
    initialFrame: target2.frame
  });
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: backdropStyle,
      onClick: (event) => {
        if (event.target === event.currentTarget) closeLightbox();
      },
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          role: "dialog",
          "aria-modal": "true",
          "aria-label": `Browser preview: ${title}`,
          tabIndex: -1,
          ref: (node) => node?.focus(),
          onKeyDown: (event) => {
            if (event.key === "Escape") closeLightbox();
          },
          style: dialogStyle,
          children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("div", { style: { ...truncate, fontSize: "0.875rem", fontWeight: 600 }, children: title }),
              /* @__PURE__ */ jsx("div", { style: { ...truncate, fontSize: "0.75rem", opacity: 0.7 }, children: [location, STATUS_LABEL[status]].filter(Boolean).join(" \xB7 ") })
            ] }),
            /* @__PURE__ */ jsx(
              PreviewImage,
              {
                frame,
                status,
                title,
                maxHeight: "78dvh"
              }
            )
          ]
        }
      )
    }
  );
}
var app_default = definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: BrowserPreviewDirective
  });
});
export {
  app_default as default
};
//# sourceMappingURL=app.js.map
