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
      id: "memory",
      title: "Memory",
      description: "Notes injected into every thread via agents.configure.",
      component: function MemorySettings() {
        return Panel("Memory", "Edit the Remember setting on this plugin\u2019s detail page.");
      }
    });
  }
};
