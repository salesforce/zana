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
    app.slots.messageDirective({
      id: "workflow",
      component: function WorkflowDirective(props) {
        const React = hostReact();
        if (!React) return null;
        return React.createElement("div", { className: "plugin-directive" }, "Workflow ", props.attributes.name || props.attributes.id || "");
      }
    });
    app.composer.customize({
      id: "workflows",
      plusMenu: [{
        id: "insert-workflow",
        label: "Insert workflow",
        run({ composer }) {
          composer.updateText((text) => `${text}\n::workflow{name=draft}\n`);
        }
      }]
    });
  }
};
