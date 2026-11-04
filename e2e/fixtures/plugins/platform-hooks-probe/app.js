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

// ../../../../../../../../../../../private/var/folders/3n/g41ptzpd60n1x3thcm1czjpw0000gn/T/zcc-electron-test-ToDjLI/packages/cli/dist/runtime/plugin-sdk-app.js
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
function useRealtime(channel, handler) {
  pluginRuntime().useRealtime?.(channel, handler);
}
function useZccContext() {
  return pluginRuntime().useZccContext?.() ?? { projectId: null, threadId: null };
}

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// app.tsx
var PLUGIN_ID = "platform-hooks-probe";
var DISPATCH_EVENTS_MAX = 20;
var fieldStyle = {
  background: "var(--bg-input, var(--bg-base, #202020))",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "6px 8px",
  minHeight: 30
};
var tableStyle = { width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 };
function Section(props) {
  return /* @__PURE__ */ jsxs("section", { style: { border: "1px solid var(--border, #333)", borderRadius: 8, padding: 16, marginBottom: 16, background: "var(--bg-panel, transparent)" }, children: [
    /* @__PURE__ */ jsx("h3", { style: { marginTop: 0, fontSize: 14 }, children: props.title }),
    props.children
  ] });
}
function ErrorText(props) {
  if (!props.error) return null;
  return /* @__PURE__ */ jsx("p", { style: { color: "var(--text-danger, #c33)" }, children: props.error });
}
function useActionNotice() {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice];
}
function ActionToast({ notice }) {
  if (!notice) return null;
  return /* @__PURE__ */ jsx("div", { role: notice.error ? "alert" : "status", style: { position: "fixed", right: 24, bottom: 24, zIndex: 100, padding: "10px 14px", borderRadius: 6, background: "var(--bg-panel, #222)", border: `1px solid var(${notice.error ? "--text-danger" : "--border"}, #555)`, color: "var(--text)", boxShadow: "0 8px 24px #0006" }, children: notice.message });
}
function HostRpcSection() {
  const rpc = useRpc();
  const { projectId } = useZccContext();
  const [context, setContext] = useState(null);
  const [probe, setProbe] = useState(null);
  const [error, setError] = useState(null);
  const runInspect = () => {
    setError(null);
    if (!projectId) {
      setError("No project is scoped to this panel");
      return;
    }
    void rpc.call("hostInspectContext", { projectId }).then(
      (value) => setContext(value),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  const runSlowProbe = () => {
    setError(null);
    const probeId = `probe-${Date.now()}`;
    setProbe({ probeId, status: "running" });
    void rpc.call("hostSlowProbe", { delayMs: 3e3, probeId }).then(
      (value) => {
        const result = value;
        setProbe((current) => current?.probeId === probeId ? { probeId, status: result.cancelled ? "cancelled" : "completed", elapsedMs: result.elapsedMs } : current);
      },
      (cause) => {
        setProbe((current) => current?.probeId === probeId ? { probeId, status: "failed" } : current);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };
  const cancelSlowProbe = () => {
    if (!probe || probe.status !== "running") return;
    const probeId = probe.probeId;
    setError(null);
    setProbe({ probeId, status: "cancelling" });
    void rpc.call("hostCancelSlowProbe", { probeId }).then(
      (value) => {
        if (!value.cancelled) {
          setProbe((current) => current?.probeId === probeId && current.status === "cancelling" ? { probeId, status: "failed" } : current);
          setError("Slow probe was not running when cancellation was requested");
        }
      },
      (cause) => {
        setProbe((current) => current?.probeId === probeId ? { probeId, status: "failed" } : current);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };
  return /* @__PURE__ */ jsxs(Section, { title: "Project Host RPC", children: [
    /* @__PURE__ */ jsxs("p", { children: [
      "projectId: ",
      projectId ?? "none"
    ] }),
    context ? /* @__PURE__ */ jsx("pre", { children: JSON.stringify(context, null, 2) }) : null,
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: runInspect, children: "Run host probe" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: runSlowProbe, children: "Start slow probe" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: cancelSlowProbe, disabled: !probe || probe.status !== "running", children: "Cancel slow probe" })
    ] }),
    probe ? /* @__PURE__ */ jsxs("p", { children: [
      "slow probe ",
      probe.probeId,
      ": ",
      probe.status,
      probe.elapsedMs != null ? ` (${probe.elapsedMs}ms)` : ""
    ] }) : null,
    /* @__PURE__ */ jsx(ErrorText, { error })
  ] });
}
function InteractionsSection() {
  const rpc = useRpc();
  const { threadId, projectId } = useZccContext();
  const [correlationId, setCorrelationId] = useState("demo-correlation");
  const [interaction, setInteraction] = useState(null);
  const [pendingResult, setPendingResult] = useState(null);
  const [error, setError] = useState(null);
  const run = (method, args) => {
    setError(null);
    void rpc.call(method, args).then(
      (value) => setInteraction(value),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  const requestPending = () => {
    setError(null);
    if (!threadId) {
      setError("No thread is scoped to this panel");
      return;
    }
    void rpc.call("requestPendingInteraction", { threadId }).then(
      (value) => setPendingResult(JSON.stringify(value)),
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return /* @__PURE__ */ jsxs(Section, { title: "Interactions", children: [
    /* @__PURE__ */ jsx("input", { style: fieldStyle, value: correlationId, onChange: (event) => setCorrelationId(event.target.value), "aria-label": "Correlation id" }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, marginTop: 8 }, children: [
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => projectId && run("interactionUpsert", { projectId, correlationId }), children: "Create/Upsert" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", disabled: !interaction, onClick: () => interaction && run("interactionAcknowledge", { interactionId: interaction.id, generation: interaction.generation }), children: "Acknowledge" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", disabled: !interaction, onClick: () => interaction && run("interactionCancel", { interactionId: interaction.id, generation: interaction.generation }), children: "Cancel" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: requestPending, children: "Request pending interaction" })
    ] }),
    interaction ? /* @__PURE__ */ jsx("pre", { children: JSON.stringify(interaction, null, 2) }) : null,
    pendingResult ? /* @__PURE__ */ jsxs("p", { children: [
      "pending interaction result: ",
      pendingResult
    ] }) : null,
    /* @__PURE__ */ jsx(ErrorText, { error })
  ] });
}
function DispatchPolicySection() {
  const rpc = useRpc();
  const [kind, setKind] = useState("proceed");
  const [overrideable, setOverrideable] = useState(true);
  const [reason, setReason] = useState("demo wait reason");
  const [events, setEvents] = useState([]);
  const [toast, setToast] = useActionNotice();
  const [applied, setApplied] = useState(null);
  const refreshEvents = (notify = false) => {
    void rpc.call("dispatchEventsList").then(
      (value) => {
        setEvents((current) => {
          const byId = new Map(value.map((event) => [event.dispatchId, event]));
          for (const event of current) byId.set(event.dispatchId, event);
          return [...byId.values()].slice(-DISPATCH_EVENTS_MAX);
        });
        if (notify) setToast({ message: "Dispatches refreshed", error: false });
      },
      (cause) => setToast({ message: `Could not load dispatches: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  useEffect(() => {
    refreshEvents();
    const poll = setInterval(refreshEvents, 5e3);
    void rpc.call("getDispatchSelection").then(
      (value) => {
        const selection = value;
        setKind(selection.kind);
        setOverrideable(selection.overrideable ?? true);
        setReason(selection.reason ?? selection.message ?? "demo wait reason");
        setApplied(selection.kind);
      },
      (cause) => setToast({ message: `Could not load dispatch policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
    return () => clearInterval(poll);
  }, [rpc]);
  useRealtime("hooks-probe-dispatch-event", (payload) => {
    setEvents((current) => [...current.filter((event) => event.dispatchId !== payload.dispatchId), payload].slice(-DISPATCH_EVENTS_MAX));
  });
  const apply = () => {
    const selection = kind === "proceed" ? { kind: "proceed" } : kind === "wait" ? { kind: "wait", overrideable, reason } : { kind: "reject", message: reason };
    void rpc.call("setDispatchSelection", selection).then(
      () => {
        setApplied(kind);
        setToast({ message: `Dispatch policy applied: ${kind}`, error: false });
      },
      (cause) => setToast({ message: `Could not apply dispatch policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  return /* @__PURE__ */ jsxs(Section, { title: "Dispatch Policy", children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ jsxs("select", { "aria-label": "Dispatch decision", style: fieldStyle, value: kind, onChange: (event) => setKind(event.target.value), children: [
        /* @__PURE__ */ jsx("option", { value: "proceed", children: "Proceed" }),
        /* @__PURE__ */ jsx("option", { value: "wait", children: "Wait" }),
        /* @__PURE__ */ jsx("option", { value: "reject", children: "Reject" })
      ] }),
      kind === "wait" ? /* @__PURE__ */ jsxs("label", { children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", checked: overrideable, onChange: (event) => setOverrideable(event.target.checked) }),
        " overrideable"
      ] }) : null,
      kind !== "proceed" ? /* @__PURE__ */ jsx("input", { style: fieldStyle, value: reason, onChange: (event) => setReason(event.target.value), "aria-label": "Reason" }) : null,
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: apply, children: "Apply" })
    ] }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Server policy: ",
      applied ?? "loading"
    ] }),
    /* @__PURE__ */ jsx("h4", { style: { marginBottom: 4 }, children: "Observed thread dispatches" }),
    /* @__PURE__ */ jsx("p", { style: { marginTop: 0 }, children: "Decisions for follow-up messages in existing Modern threads. Apply sets policy; it does not add a row. New Chat's first message creates a thread and does not trigger this hook. After that thread settles, send a second message in the same thread to see a row. Recent rows refresh automatically." }),
    /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => refreshEvents(true), children: "Refresh dispatches" }),
    /* @__PURE__ */ jsxs("table", { style: tableStyle, children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "dispatchId" }),
        /* @__PURE__ */ jsx("th", { children: "generation" }),
        /* @__PURE__ */ jsx("th", { children: "decision" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: events.map((event, index) => /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("td", { children: event.dispatchId }),
        /* @__PURE__ */ jsx("td", { children: event.generation }),
        /* @__PURE__ */ jsx("td", { children: JSON.stringify(event.decision) })
      ] }, `${event.dispatchId}-${index}`)) })
    ] }),
    events.length === 0 ? /* @__PURE__ */ jsx("p", { children: "No dispatches observed yet. Send a follow-up in an existing Modern thread in this project." }) : null,
    /* @__PURE__ */ jsx(ActionToast, { notice: toast })
  ] });
}
function ToolPolicySection() {
  const rpc = useRpc();
  const { projectId } = useZccContext();
  const [marker, setMarker] = useState(null);
  const [selection, setSelection] = useState("allow");
  const [policyEvents, setPolicyEvents] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useActionNotice();
  const refetch = (notify = false) => {
    if (!projectId) {
      if (notify) setToast({ message: "No project is scoped to this panel", error: true });
      return;
    }
    void rpc.call("markerGet", { projectId }).then(
      (value) => {
        setMarker(value);
        setError(null);
        if (notify) setToast({ message: "Tool marker refreshed", error: false });
      },
      (cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        if (notify) setToast({ message: `Could not refresh tool marker: ${message}`, error: true });
      }
    );
  };
  const refetchPolicySelection = () => {
    void rpc.call("getToolPolicySelection").then((value) => setSelection(value));
  };
  const refetchPolicyEvents = (notify = false) => {
    void rpc.call("toolPolicyEventsList").then(
      (value) => {
        setPolicyEvents(value);
        if (notify) setToast({ message: "Tool policy events refreshed", error: false });
      },
      (cause) => setToast({ message: `Could not refresh tool policy events: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  useEffect(refetch, [rpc, projectId]);
  useEffect(refetchPolicySelection, [rpc]);
  useEffect(refetchPolicyEvents, [rpc]);
  useRealtime("hooks-probe-tool-marker-changed", () => refetch());
  useRealtime("hooks-probe-tool-policy-event", () => refetchPolicyEvents());
  const clear = () => {
    if (!projectId) return;
    void rpc.call("markerClear", { projectId }).then(
      () => {
        refetch();
        setToast({ message: "Tool marker cleared", error: false });
      },
      (cause) => setToast({ message: `Could not clear tool marker: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  const last = marker?.history[marker.history.length - 1];
  const applySelection = (next) => {
    void rpc.call("setToolPolicySelection", { selection: next }).then(
      () => {
        setSelection(next);
        setToast({ message: `Tool policy set to ${next}`, error: false });
      },
      (cause) => setToast({ message: `Could not set tool policy: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
    );
  };
  const clearPolicyEvents = () => void rpc.call("toolPolicyEventsClear").then(
    () => {
      refetchPolicyEvents();
      setToast({ message: "Tool policy events cleared", error: false });
    },
    (cause) => setToast({ message: `Could not clear tool policy events: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
  );
  return /* @__PURE__ */ jsxs(Section, { title: "Tool Policy", children: [
    /* @__PURE__ */ jsxs("p", { children: [
      "Agent tool ",
      /* @__PURE__ */ jsx("code", { children: "platform_hooks_probe_marker" }),
      " writes a CAS marker and MCP tool ",
      /* @__PURE__ */ jsx("code", { children: "platform-hooks-probe" }),
      " appends invocation records to a project journal. Both appear in the bounded history below. Invoke either from a thread, then refresh."
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => refetch(true), children: "Refresh marker" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: clear, disabled: !projectId, children: "Clear marker" })
    ] }),
    marker ? /* @__PURE__ */ jsxs("p", { children: [
      "count: ",
      marker.count,
      ", last source: ",
      last?.source ?? "none",
      ", last invocationId: ",
      last?.invocationId ?? "none"
    ] }) : /* @__PURE__ */ jsx("p", { children: "No marker yet" }),
    /* @__PURE__ */ jsx(ErrorText, { error }),
    /* @__PURE__ */ jsx(ActionToast, { notice: toast }),
    /* @__PURE__ */ jsx("h4", { children: "Native Tool Policy (OBL-004)" }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Decision applied to every native-provider tool call (Claude/Codex PreToolUse) routed through this plugin's",
      " ",
      /* @__PURE__ */ jsx("code", { children: "onToolPolicy" }),
      " hook."
    ] }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [
      /* @__PURE__ */ jsxs("select", { "aria-label": "Tool policy", style: fieldStyle, value: selection, onChange: (event) => applySelection(event.target.value), children: [
        /* @__PURE__ */ jsx("option", { value: "allow", children: "Allow" }),
        /* @__PURE__ */ jsx("option", { value: "deny", children: "Deny" })
      ] }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => refetchPolicyEvents(true), children: "Refresh events" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: clearPolicyEvents, children: "Clear events" })
    ] }),
    /* @__PURE__ */ jsxs("table", { style: tableStyle, children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "invocationId" }),
        /* @__PURE__ */ jsx("th", { children: "providerId" }),
        /* @__PURE__ */ jsx("th", { children: "toolName" }),
        /* @__PURE__ */ jsx("th", { children: "state" }),
        /* @__PURE__ */ jsx("th", { children: "at" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: policyEvents.map((event, index) => /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("td", { children: event.invocationId }),
        /* @__PURE__ */ jsx("td", { children: event.providerId }),
        /* @__PURE__ */ jsx("td", { children: event.toolName }),
        /* @__PURE__ */ jsx("td", { children: event.state }),
        /* @__PURE__ */ jsx("td", { children: new Date(event.at).toLocaleTimeString() })
      ] }, `${event.invocationId}-${index}`)) })
    ] })
  ] });
}
function CapabilitiesSection() {
  const rpc = useRpc();
  const { threadId } = useZccContext();
  const [capabilities, setCapabilities] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [error, setError] = useState(null);
  const refresh = () => {
    setError(null);
    if (!threadId) {
      setError("No thread is scoped to this panel");
      return;
    }
    void rpc.call("capabilitiesForThread", { threadId }).then(
      (value) => {
        setCapabilities(value);
        setRefreshedAt(Date.now());
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return /* @__PURE__ */ jsxs(Section, { title: "Capabilities", children: [
    /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: refresh, children: "Refresh" }),
    refreshedAt ? /* @__PURE__ */ jsxs("p", { children: [
      "refreshed at ",
      new Date(refreshedAt).toLocaleTimeString()
    ] }) : null,
    capabilities ? /* @__PURE__ */ jsx("pre", { children: JSON.stringify(capabilities, null, 2) }) : null,
    /* @__PURE__ */ jsx(ErrorText, { error })
  ] });
}
function LifecycleSection() {
  const rpc = useRpc();
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useActionNotice();
  const refetch = () => {
    void rpc.call("lifecycleList").then((value) => setRows(Array.isArray(value) ? value : []));
  };
  useEffect(refetch, [rpc]);
  useRealtime("hooks-probe-lifecycle-changed", refetch);
  const clear = () => void rpc.call("lifecycleClear").then(
    () => {
      refetch();
      setToast({ message: "Lifecycle projection cleared", error: false });
    },
    (cause) => setToast({ message: `Could not clear lifecycle projection: ${cause instanceof Error ? cause.message : String(cause)}`, error: true })
  );
  return /* @__PURE__ */ jsxs(Section, { title: "Lifecycle", children: [
    /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: clear, children: "Clear local projection" }),
    /* @__PURE__ */ jsxs("table", { style: tableStyle, children: [
      /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("th", { children: "eventId" }),
        /* @__PURE__ */ jsx("th", { children: "schema" }),
        /* @__PURE__ */ jsx("th", { children: "time" }),
        /* @__PURE__ */ jsx("th", { children: "thread" }),
        /* @__PURE__ */ jsx("th", { children: "origin" }),
        /* @__PURE__ */ jsx("th", { children: "visibility" })
      ] }) }),
      /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => /* @__PURE__ */ jsxs("tr", { children: [
        /* @__PURE__ */ jsx("td", { children: String(row.eventId) }),
        /* @__PURE__ */ jsx("td", { children: String(row.schemaVersion) }),
        /* @__PURE__ */ jsx("td", { children: new Date(Number(row.occurredAt)).toLocaleTimeString() }),
        /* @__PURE__ */ jsx("td", { children: String(row.threadId) }),
        /* @__PURE__ */ jsx("td", { children: String(row.origin) }),
        /* @__PURE__ */ jsx("td", { children: String(row.visibility) })
      ] }, String(row.eventId))) })
    ] }),
    /* @__PURE__ */ jsx(ActionToast, { notice: toast })
  ] });
}
function ContributionsSection() {
  return /* @__PURE__ */ jsxs(Section, { title: "Contributions", children: [
    /* @__PURE__ */ jsxs("p", { children: [
      "Expected fixture persona: ",
      /* @__PURE__ */ jsx("code", { children: "Probe Reviewer" })
    ] }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Expected fixture team: ",
      /* @__PURE__ */ jsx("code", { children: "Probe Pair" })
    ] }),
    /* @__PURE__ */ jsx("p", { children: "Verify registration status in the Agents launcher's persona/team picker." })
  ] });
}
function AvailabilitySection() {
  const { projectId } = useZccContext();
  const [enabled, setEnabled] = useState(null);
  const rpc = useRpc();
  const refetch = () => {
    if (!projectId) return;
    void rpc.call("getEnabled", { projectId }).then((value) => setEnabled(value.enabled));
  };
  useEffect(refetch, [rpc, projectId]);
  useRealtime("hooks-probe-availability-changed", refetch);
  return /* @__PURE__ */ jsxs(Section, { title: "Availability", children: [
    /* @__PURE__ */ jsxs("p", { children: [
      "project: ",
      projectId ?? "none"
    ] }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Hooks Probe is ",
      enabled ? "enabled" : "disabled",
      " for this project. Toggle via the project overflow menu action."
    ] })
  ] });
}
function HooksProbePanel() {
  const rpc = useRpc();
  const { projectId } = useZccContext();
  const [resetStatus, setResetStatus] = useState(null);
  const reset = () => {
    setResetStatus("Resetting\u2026");
    void rpc.call("resetProbeState", { projectId }).then(
      () => window.location.reload(),
      (cause) => setResetStatus(cause instanceof Error ? cause.message : String(cause))
    );
  };
  return /* @__PURE__ */ jsxs("div", { className: "hooks-probe", style: { padding: 24, height: "100%", boxSizing: "border-box", overflow: "auto" }, children: [
    /* @__PURE__ */ jsx("style", { children: `
        .hooks-probe > :not(style) { max-width: 1000px; }
        .hooks-probe section p { color: var(--text-muted, var(--text)); line-height: 1.5; }
        .hooks-probe section > div { flex-wrap: wrap; }
        .hooks-probe pre { overflow-x: auto; padding: 12px; border-radius: 4px; background: var(--bg-base, #181818); }
        .hooks-probe table { margin-top: 12px; }
        .hooks-probe th, .hooks-probe td { padding: 8px; border-bottom: 1px solid var(--border, #333); vertical-align: top; overflow-wrap: anywhere; }
        .hooks-probe th { color: var(--text-muted, var(--text)); font-weight: 600; }
        .hooks-probe button:focus-visible, .hooks-probe select:focus-visible, .hooks-probe input:focus-visible { outline: 2px solid var(--accent, #58a6ff); outline-offset: 2px; }
      ` }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }, children: [
      /* @__PURE__ */ jsx("h2", { style: { margin: 0 }, children: "Platform Hooks Probe" }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: reset, children: "Reset probe state" }),
        resetStatus && /* @__PURE__ */ jsx("span", { role: "status", style: { marginLeft: 8 }, children: resetStatus })
      ] })
    ] }),
    /* @__PURE__ */ jsx(HostRpcSection, {}),
    /* @__PURE__ */ jsx(InteractionsSection, {}),
    /* @__PURE__ */ jsx(DispatchPolicySection, {}),
    /* @__PURE__ */ jsx(ToolPolicySection, {}),
    /* @__PURE__ */ jsx(CapabilitiesSection, {}),
    /* @__PURE__ */ jsx(LifecycleSection, {}),
    /* @__PURE__ */ jsx(ContributionsSection, {}),
    /* @__PURE__ */ jsx(AvailabilitySection, {})
  ] });
}
function HooksProbePendingInteraction(props) {
  const payload = props.interaction.payload && typeof props.interaction.payload === "object" ? props.interaction.payload : {};
  return /* @__PURE__ */ jsxs("div", { style: { display: "grid", gap: 8 }, children: [
    /* @__PURE__ */ jsx("p", { children: props.interaction.title }),
    /* @__PURE__ */ jsx("pre", { children: JSON.stringify(payload, null, 2) }),
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8 }, children: [
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => void props.submit({ confirmed: true }), children: "Submit" }),
      /* @__PURE__ */ jsx("button", { className: "btn", type: "button", onClick: () => void props.cancel(), children: "Cancel" })
    ] })
  ] });
}
var app_default = definePluginApp((app) => {
  app.slots.projectTab({
    id: "hooks-probe",
    label: "Hooks Probe",
    component: HooksProbePanel
  });
  app.slots.pendingInteraction({
    id: "platform-hooks-probe-pending",
    component: HooksProbePendingInteraction
  });
  app.slots.experimental_projectMenuAction({
    id: "toggle-hooks-probe",
    title: "Hooks Probe",
    async titleForProject(projectId) {
      const current = await callPluginRpc(PLUGIN_ID, "getEnabled", { projectId });
      return `${current.enabled ? "Disable" : "Enable"} Hooks Probe`;
    },
    placement: "project",
    async run(ctx) {
      if (!ctx.projectId) return;
      const projectId = ctx.projectId;
      const current = await callPluginRpc(PLUGIN_ID, "getEnabled", { projectId });
      const next = await callPluginRpc(PLUGIN_ID, "setEnabled", { projectId, enabled: !current.enabled });
      if (next.enabled) ctx.toProject(projectId);
    }
  });
});
export {
  app_default as default
};
//# sourceMappingURL=app.js.map
