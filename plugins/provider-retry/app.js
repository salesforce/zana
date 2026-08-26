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
    app.composer.customize({
      id: "retry",
      scopes: ["thread"],
      actions: [{
        id: "retry-last",
        component: function RetryAction() {
          const React = hostReact();
          if (!React) return null;
          return React.createElement("span", { className: "plugin-composer-retry" }, "Retry last turn from the thread menu.");
        }
      }]
    });
  }
};
