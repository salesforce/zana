export default function plugin(zcc) {
  zcc.rpc.method("prompt", async (args) => {
    const threadId = typeof args?.threadId === "string" ? args.threadId : "";
    if (!threadId) throw new Error("threadId is required");
    return zcc.ui.requestInput({
      threadId,
      rendererId: "secret",
      title: "Secret",
      payload: { label: typeof args?.label === "string" ? args.label : "Secret" }
    });
  });
}
