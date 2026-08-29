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
    app.slots.threadPanelAction({
      id: "chat",
      title: "Side chat",
      layout: "flush",
      component: function SideChat(props) {
        const React = hostReact();
        const runtime = globalThis.__ZCC_PLUGIN_RUNTIME__;
        if (!React || !runtime?.ThreadChat) return Panel("Side chat", "Open this panel from a thread.");
        return React.createElement(runtime.ThreadChat, { threadId: props.threadId, variant: "compact" });
      }
    });
    app.slots.messageAction({
      id: "side-chat",
      title: "Open side chat",
      run(ctx) {
        ctx.openPanel({ actionId: "chat", title: "Side chat" });
      }
    });
  }
};
