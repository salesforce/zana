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
async function setPluginSettings(pluginId, values) {
  return pluginHost().setSettings(pluginId, values);
}
function definePluginApp(setup) {
  return { __zccPluginApp: true, setup };
}
function useSettings() {
  return pluginRuntime().useSettings?.() ?? { values: void 0, isLoading: true };
}
function useZccNavigate() {
  return pluginRuntime().useZccNavigate?.() ?? missing("useZccNavigate");
}

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

// lib/agent-script-model.ts
var AGENT_SCRIPT_EXAMPLES = [
  {
    id: "support-bot",
    title: "Support bot",
    dialect: "agentforce",
    source: `# @dialect:agentforce
config:
    agent_name: "Support Bot"
    default_locale: "en_US"

variables:
    case_id: mutable string = ""
        description: "The current support case ID"
    is_verified: mutable boolean = False

system:
    instructions: |
        You are a helpful support agent.
        Always verify the customer before discussing account details.

start_agent:
    reasoning:
        instructions: ->
            | Greet the user and ask for their case ID.
            if @variables.is_verified:
                | You may discuss account details.
            | Always be concise and professional.
    after_reasoning:
        if not @variables.is_verified:
            transition to @topic.identity_verification
        else:
            transition to @topic.billing

topic identity_verification:
    description: "Verify the customer before account work"
    reasoning:
        instructions: ->
            | Ask for the email on the account, then confirm the case ID.

topic billing:
    description: "Handle billing inquiries"
    reasoning:
        instructions: ->
            | Look up the case and explain the latest invoice in plain language.
`
  },
  {
    id: "minimal",
    title: "Minimal agent",
    dialect: "agentscript",
    source: `# @dialect:agentscript
config:
    agent_name: "Minimal"

system:
    instructions: "You are a concise assistant."

start_agent:
    reasoning:
        instructions: "Greet the user and wait for a task."
`
  },
  {
    id: "fabric-router",
    title: "Fabric router",
    dialect: "agentfabric",
    source: `# @dialect:agentfabric
config:
    agent_name: "Fabric Router"

system:
    instructions: "Route the user to the right specialist."

start_agent:
    reasoning:
        instructions: ->
            | Ask what the user needs, then transition.
    after_reasoning:
        transition to @topic.handoff

topic handoff:
    description: "Hand the conversation to a specialist"
    reasoning:
        instructions: "Summarize the request and pick a specialist."
`
  }
];

// lib/types.ts
var AGENT_SCRIPT_DIALECTS = ["agentforce", "agentscript", "agentfabric"];
var DEFAULT_AGENT_SCRIPT_DIALECT = "agentforce";
function normalizeAgentScriptDialect(value) {
  return AGENT_SCRIPT_DIALECTS.includes(value) ? value : DEFAULT_AGENT_SCRIPT_DIALECT;
}

// src/app/playground-bridge.ts
var PLAYGROUND_BRIDGE_SOURCE = "zcc-salesforce-agentscript";
function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}
function isPlaygroundToHost(value) {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "ready") return true;
  if (value.type === "dirty") return typeof value.dirty === "boolean";
  if (value.type === "requestOpen") return typeof value.path === "string";
  return value.type === "persist" && typeof value.path === "string" && typeof value.content === "string";
}
function readDocumentTheme() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
var PLAYGROUND_ASSET_SRC = "/plugins/salesforce/assets/playground/dist/index.html";

// src/app/agent-script-panel-logic.ts
function filePickerValue(activePath, exampleId) {
  return activePath ? `file:${activePath}` : `example:${exampleId}`;
}
function parseFilePickerValue(value) {
  if (value.startsWith("example:")) {
    return { kind: "example", id: value.slice("example:".length) };
  }
  const path = value.startsWith("file:") ? value.slice("file:".length) : value;
  return { kind: "file", path };
}
function saveIsDisabled(saveEnabled, activePath, busy) {
  return !saveEnabled || !activePath || busy;
}
function playgroundHint(hasStatus, dxProject) {
  if (hasStatus && !dxProject) {
    return "Examples are in-memory until you set a DX project root under Plugins \u2192 Salesforce.";
  }
  return null;
}

// zcc-host-react:react/jsx-runtime
var React2 = globalThis.__ZCC_HOST_REACT__;
var Fragment2 = React2.Fragment;
function jsx(type, props, key) {
  return React2.createElement(type, key === void 0 ? props : { ...props, key });
}
var jsxs = jsx;

// src/app/AgentScriptPanel.tsx
var PLUGIN_ID = "salesforce";
var PANEL_ROOT = { height: "100%", minHeight: 0, display: "flex", flexDirection: "column" };
function postToPlayground(frame, message) {
  try {
    frame?.contentWindow?.postMessage(message, window.location.origin);
  } catch {
  }
}
function AgentScriptPanel(props) {
  const pluginId = props.pluginId || PLUGIN_ID;
  const settings = useSettings();
  const frameRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState(props.subPath || null);
  const [exampleId, setExampleId] = useState(AGENT_SCRIPT_EXAMPLES[0]?.id ?? "support-bot");
  const [sha256, setSha256] = useState(void 0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialectOverride, setDialectOverride] = useState(null);
  const dialect = dialectOverride ?? normalizeAgentScriptDialect(settings.values?.agentScriptDialect);
  const saveEnabled = Boolean(status?.dxProject);
  const refreshFiles = useCallback(async () => {
    const listed = await callPluginRpc(pluginId, "agentFiles.list");
    if (listed?.ok && Array.isArray(listed.files)) setFiles(listed.files);
  }, [pluginId]);
  useEffect(() => {
    let cancelled = false;
    void callPluginRpc(pluginId, "status").then((next) => {
      if (!cancelled) setStatus(next ?? {});
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    void refreshFiles().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [pluginId, refreshFiles]);
  const openFile = useCallback(
    async (path, nextExampleId) => {
      setError(null);
      if (!path) {
        const example = AGENT_SCRIPT_EXAMPLES.find((row) => row.id === nextExampleId) ?? AGENT_SCRIPT_EXAMPLES[0];
        setActivePath(null);
        setExampleId(example?.id ?? "support-bot");
        setSha256(void 0);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: "setFile",
          path: null,
          content: example?.source ?? "",
          dialect: example?.dialect ?? dialect,
          readOnly: false
        });
        return;
      }
      const result = await callPluginRpc(pluginId, "agentFiles.read", { path });
      if (!result?.ok || !result.file) {
        setError(result?.error || "Could not read Agent Script file.");
        return;
      }
      setActivePath(result.file.path);
      setExampleId("");
      setSha256(result.file.sha256);
      setDirty(false);
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: "setFile",
        path: result.file.path,
        content: result.file.content,
        dialect,
        readOnly: false,
        sha256: result.file.sha256
      });
    },
    [dialect, pluginId]
  );
  const save = useCallback(() => {
    postToPlayground(frameRef.current, { source: PLAYGROUND_BRIDGE_SOURCE, type: "flushSave" });
  }, []);
  const persistFromPlayground = useCallback(
    async (path, content) => {
      if (!saveEnabled || !path) {
        setError("Set a DX project root before saving.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await callPluginRpc(pluginId, "agentFiles.write", {
          path,
          content,
          expectedSha256: sha256
        });
        if (!result?.ok || !result.file) {
          setError(result?.error || "Save failed.");
          return;
        }
        setSha256(result.file.sha256);
        setDirty(false);
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: "saved",
          sha256: result.file.sha256
        });
        await refreshFiles();
      } finally {
        setBusy(false);
      }
    },
    [pluginId, refreshFiles, saveEnabled, sha256]
  );
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (!isPlaygroundToHost(event.data)) return;
      const message = event.data;
      if (message.type === "ready") {
        postToPlayground(frameRef.current, {
          source: PLAYGROUND_BRIDGE_SOURCE,
          type: "init",
          dialect,
          theme: readDocumentTheme(),
          examples: AGENT_SCRIPT_EXAMPLES,
          files,
          saveEnabled
        });
        void openFile(props.subPath || null);
        return;
      }
      if (message.type === "dirty") {
        setDirty(message.dirty);
        return;
      }
      if (message.type === "requestOpen") {
        void openFile(message.path);
        return;
      }
      if (message.type === "persist") {
        void persistFromPlayground(message.path, message.content);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [dialect, files, openFile, persistFromPlayground, props.subPath, saveEnabled]);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      postToPlayground(frameRef.current, {
        source: PLAYGROUND_BRIDGE_SOURCE,
        type: "setTheme",
        theme: readDocumentTheme()
      });
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const hint = useMemo(() => playgroundHint(Boolean(status), status?.dxProject), [status]);
  const fileValue = filePickerValue(activePath, exampleId);
  return /* @__PURE__ */ jsxs("div", { style: PANEL_ROOT, "data-testid": "salesforce-agent-script-panel", children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border, #333)",
          flexWrap: "wrap"
        },
        children: [
          /* @__PURE__ */ jsx("strong", { children: "Agent Script" }),
          /* @__PURE__ */ jsx(
            "select",
            {
              "aria-label": "Agent Script dialect",
              value: dialect,
              onChange: (event) => {
                const next = normalizeAgentScriptDialect(event.target.value);
                setDialectOverride(next);
                void setPluginSettings(pluginId, { agentScriptDialect: next }).catch(() => void 0);
                postToPlayground(frameRef.current, {
                  source: PLAYGROUND_BRIDGE_SOURCE,
                  type: "setDialect",
                  dialect: next
                });
              },
              children: AGENT_SCRIPT_DIALECTS.map((id) => /* @__PURE__ */ jsx("option", { value: id, children: id }, id))
            }
          ),
          /* @__PURE__ */ jsxs(
            "select",
            {
              "aria-label": "Agent Script file",
              value: fileValue,
              onChange: (event) => {
                const picked = parseFilePickerValue(event.target.value);
                if (picked.kind === "example") {
                  void openFile(null, picked.id);
                  return;
                }
                void openFile(picked.path);
              },
              children: [
                AGENT_SCRIPT_EXAMPLES.map((example) => /* @__PURE__ */ jsxs("option", { value: `example:${example.id}`, children: [
                  "Example: ",
                  example.title
                ] }, example.id)),
                files.map((file) => /* @__PURE__ */ jsxs("option", { value: `file:${file.path}`, children: [
                  file.apiName,
                  " (",
                  file.path,
                  ")"
                ] }, file.path))
              ]
            }
          ),
          /* @__PURE__ */ jsx("button", { type: "button", disabled: saveIsDisabled(saveEnabled, activePath, busy), onClick: () => void save(), children: busy ? "Saving\u2026" : dirty ? "Save" : "Saved" }),
          hint ? /* @__PURE__ */ jsx("span", { style: { color: "var(--text-muted)" }, children: hint }) : null,
          error ? /* @__PURE__ */ jsx("span", { style: { color: "var(--danger, #c00)" }, children: error }) : null
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      "iframe",
      {
        ref: frameRef,
        title: "Agent Script playground",
        src: typeof process !== "undefined" && process.env.VITEST ? "about:blank" : PLAYGROUND_ASSET_SRC,
        style: { flex: 1, minHeight: 0, width: "100%", border: 0, background: "transparent" }
      }
    )
  ] });
}

// app.tsx
function hostReact() {
  return globalThis.__ZCC_HOST_REACT__;
}
function pluginHost2() {
  return globalThis.__ZCC_PLUGIN_HOST__;
}
function pad(children) {
  const React3 = hostReact();
  if (!React3) return null;
  return React3.createElement("div", { style: { padding: 16, height: "100%", boxSizing: "border-box" } }, children);
}
function SalesforceSettings() {
  const React3 = hostReact();
  if (!React3) return null;
  return pad(
    React3.createElement(
      "p",
      { style: { color: "var(--text-muted)", marginTop: 0 } },
      "Set Default org alias, DX project root, and Agent Script dialect on this plugin\u2019s detail page. The Agent Script panel edits .agent files; org preview/publish still uses sf_agent."
    )
  );
}
function SalesforceProjectTab(props) {
  const React3 = hostReact();
  const navigate = useZccNavigate();
  if (!React3) return null;
  const [status, setStatus] = React3.useState(null);
  const [busy, setBusy] = React3.useState(false);
  const [error, setError] = React3.useState(null);
  React3.useEffect(() => {
    let cancelled = false;
    pluginHost2()?.callRpc(props.pluginId, "status").then((next) => {
      if (!cancelled) setStatus(next);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
    };
  }, [props.pluginId]);
  const last = status?.lastDoctor;
  const orgLabel = last?.org ? `${last.org.alias} (${last.org.kind})` : status?.defaultOrg || "No org configured";
  return pad(
    React3.createElement(
      React3.Fragment,
      null,
      React3.createElement("h2", { style: { marginTop: 0 } }, "Salesforce"),
      React3.createElement("p", null, orgLabel),
      last?.cliOk === false ? React3.createElement("p", { style: { color: "var(--danger)" } }, last.cliError || "Salesforce CLI missing") : null,
      last && typeof last.agentBundleCount === "number" ? React3.createElement(
        "p",
        { style: { color: "var(--text-muted)" } },
        `${last.agentBundleCount} .agent bundle${last.agentBundleCount === 1 ? "" : "s"}`
      ) : null,
      status && !status.dxProject ? React3.createElement(
        "p",
        { style: { color: "var(--text-muted)" } },
        "No sfdx-project.json at the configured DX project root."
      ) : null,
      error ? React3.createElement("p", { style: { color: "var(--danger)" } }, error) : null,
      React3.createElement(
        "div",
        { style: { display: "flex", gap: 8 } },
        React3.createElement(
          "button",
          {
            type: "button",
            disabled: busy,
            onClick: () => {
              setBusy(true);
              setError(null);
              pluginHost2()?.callRpc(props.pluginId, "doctor").then((report) => {
                setStatus((current) => ({ ...current ?? {}, lastDoctor: report }));
              }).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false));
            }
          },
          busy ? "Running doctor\u2026" : "Run doctor"
        ),
        React3.createElement(
          "button",
          {
            type: "button",
            onClick: () => navigate.toPluginPanel("agent-script")
          },
          "Open Agent Script"
        )
      )
    )
  );
}
function SalesforceGuardrailForm(props) {
  const React3 = hostReact();
  if (!React3) return null;
  const payload = props.interaction.payload && typeof props.interaction.payload === "object" ? props.interaction.payload : {};
  return React3.createElement(
    "div",
    { style: { display: "grid", gap: 8 } },
    React3.createElement("p", { style: { margin: 0 } }, payload.summary || "Confirm this Salesforce action."),
    payload.orgAlias ? React3.createElement(
      "p",
      { style: { margin: 0, color: "var(--text-muted)" } },
      `${payload.orgAlias} \xB7 ${payload.orgKind || "unknown"}${payload.orgId ? ` \xB7 ${payload.orgId}` : ""}`
    ) : null,
    payload.preview ? React3.createElement(
      "pre",
      { style: { whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", margin: 0 } },
      String(payload.preview)
    ) : null,
    React3.createElement(
      "div",
      { style: { display: "flex", gap: 8 } },
      React3.createElement("button", { type: "button", onClick: () => props.submit({ approved: true }) }, "Allow this action"),
      React3.createElement("button", { type: "button", onClick: () => props.cancel() }, "Deny")
    )
  );
}
function SalesforceComposerBanner(props) {
  const React3 = hostReact();
  if (!React3) return null;
  const [status, setStatus] = React3.useState(null);
  React3.useEffect(() => {
    let cancelled = false;
    pluginHost2()?.callRpc(props.pluginId || "salesforce", "status").then((next) => {
      if (!cancelled) setStatus(next);
    }).catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [props.pluginId]);
  if (!status) return null;
  const last = status.lastDoctor;
  const kind = last?.org?.kind;
  if (!status.defaultOrg && status.dxProject) {
    return React3.createElement(
      "p",
      { style: { margin: 0 } },
      "Salesforce: set a default org alias under Plugins \u2192 Salesforce, then run zcc sf doctor."
    );
  }
  if (kind === "production") {
    return React3.createElement(
      "p",
      { style: { margin: 0 } },
      `Salesforce: target org ${status.defaultOrg} is production. Org reads, anonymous Apex, and Agent publish/activate require confirmation.`
    );
  }
  if (kind === "unknown") {
    return React3.createElement(
      "p",
      { style: { margin: 0 } },
      `Salesforce: target org ${status.defaultOrg} kind is unknown. Access and Agent publish/activate require confirmation.`
    );
  }
  if ((last?.agentBundleCount ?? 0) > 0) {
    return React3.createElement(
      "p",
      { style: { margin: 0 } },
      "Salesforce: Agent publish/activate requires confirmation."
    );
  }
  return null;
}
function AgentFileOpener(props) {
  const React3 = hostReact();
  const navigate = useZccNavigate();
  if (!React3) return null;
  const Original = props.experimental_Original;
  return React3.createElement(
    "div",
    { className: "salesforce-agent-opener", style: { display: "grid", gap: 8, padding: 8 } },
    React3.createElement("p", { style: { margin: 0, color: "var(--text-muted)" } }, props.path),
    React3.createElement(
      "button",
      {
        type: "button",
        onClick: () => navigate.toPluginPanel("agent-script", { subPath: props.path })
      },
      "Open in Agent Script"
    ),
    React3.createElement(Original)
  );
}
var app_default = definePluginApp((app) => {
  app.slots.navPanel({
    id: "agent-script",
    title: "Agent Script",
    icon: "FileCode",
    component: AgentScriptPanel
  });
  app.slots.fileOpener({
    id: "agent",
    title: "Agent Script",
    extensions: ["agent", "afscript"],
    component: AgentFileOpener
  });
  app.slots.settingsSection({
    id: "salesforce",
    title: "Salesforce",
    description: "DX org alias, API version, local project root, and Agent Script dialect.",
    component: SalesforceSettings
  });
  app.slots.projectTab({
    id: "salesforce",
    label: "Salesforce",
    icon: "Cloud",
    order: 80,
    global: false,
    component: SalesforceProjectTab
  });
  app.slots.pendingInteraction({
    id: "salesforce-guardrail",
    component: SalesforceGuardrailForm
  });
  app.composer.customize({
    id: "salesforce-banner",
    scopes: ["thread", "new-thread"],
    banners: [{ id: "org-status", chrome: "card", component: SalesforceComposerBanner }]
  });
  app.slots.commandPaletteAction({
    id: "open-agent-script",
    title: "Open Agent Script",
    run: (ctx) => {
      ctx.toPluginPanel("agent-script");
    }
  });
});
export {
  app_default as default
};
