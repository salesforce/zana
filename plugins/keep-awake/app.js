function hostReact() { return globalThis.__ZCC_HOST_REACT__; }
function Panel(title, body) {
  const React = hostReact();
  if (!React) return null;
  return React.createElement("div", { style: { padding: 24, height: "100%", boxSizing: "border-box" } },
    React.createElement("h2", { style: { marginTop: 0 } }, title),
    body ? React.createElement("p", { style: { color: "var(--text-muted)" } }, body) : null
  );
}
export default {
  __zccPluginApp: true,
  setup(app) {
    app.slots.settingsSection({
      id: "keep-awake",
      title: "Keep awake",
      component: function KeepAwakeSettings(props) {
        const React = hostReact();
        if (!React) return null;
        const { useEffect, useState } = React;
        const [awake, setAwake] = useState(false);
        useEffect(() => {
          globalThis.__ZCC_PLUGIN_HOST__?.callRpc(props.pluginId, "status", {}).then((r) => setAwake(Boolean(r?.awake)));
        }, [props.pluginId]);
        return React.createElement("div", { style: { padding: 8 } },
          React.createElement("p", null, awake ? "Machine will stay awake." : "Sleep is allowed."),
          React.createElement("button", {
            type: "button",
            onClick: () => {
              globalThis.__ZCC_PLUGIN_HOST__?.callRpc(props.pluginId, "set", { enable: !awake }).then((r) => setAwake(Boolean(r?.awake)));
            }
          }, awake ? "Allow sleep" : "Keep awake")
        );
      }
    });
  }
};
