export default function plugin(zcc) {
  zcc.rpc.method("status", async () => {
    try {
      return await zcc.host.experimental_call("status");
    } catch (error) {
      return { awake: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  zcc.rpc.method("set", async (args) => {
    const enable = Boolean(args?.enable);
    return zcc.host.experimental_call(enable ? "enable" : "disable");
  });
}
