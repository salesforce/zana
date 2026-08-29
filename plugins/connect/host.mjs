export default function host(api) {
  api.methods.register("status", async () => ({ connected: false }));
}
