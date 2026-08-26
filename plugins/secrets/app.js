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
    app.slots.pendingInteraction({
      id: "secret",
      component: function SecretCard(props) {
        const React = hostReact();
        if (!React) return null;
        const { useState } = React;
        const [value, setValue] = useState("");
        const label = props.interaction.payload && typeof props.interaction.payload === "object" && "label" in props.interaction.payload
          ? String(props.interaction.payload.label)
          : "Secret";
        return React.createElement("form", {
          onSubmit: (event) => {
            event.preventDefault();
            void props.submit(value);
          }
        },
          React.createElement("label", null, label),
          React.createElement("input", { type: "password", value, onChange: (e) => setValue(e.target.value) }),
          React.createElement("button", { type: "submit" }, "Submit"),
          React.createElement("button", { type: "button", onClick: () => void props.cancel() }, "Cancel")
        );
      }
    });
  }
};
