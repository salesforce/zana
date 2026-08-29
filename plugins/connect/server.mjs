export default function plugin(zcc) {
  zcc.rpc.method("status", async () => {
    try {
      return await zcc.host.experimental_call("status");
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
