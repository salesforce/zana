export default function plugin(zcc) {
  zcc.settings.define({
    repo: { type: "string", label: "Repository (owner/name)" }
  });
  zcc.rpc.method("status", async () => {
    const values = await zcc.settings.define({
      repo: { type: "string", label: "Repository (owner/name)" }
    }).get();
    return { repo: values.repo ?? "" };
  });
}
