import { spawn } from "node:child_process";
let child = null;
export default function host(api) {
  api.methods.register("enable", async () => {
    if (child) return { ok: true, awake: true };
    child = spawn("caffeinate", ["-dims"], { stdio: "ignore" });
    child.on("exit", () => { child = null; });
    return { ok: true, awake: true };
  });
  api.methods.register("disable", async () => {
    child?.kill();
    child = null;
    return { ok: true, awake: false };
  });
  api.methods.register("status", async () => ({ awake: Boolean(child) }));
}
