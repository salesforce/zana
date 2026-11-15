import { expect, it } from "vitest";
import { createFakePluginHost } from "../../packages/plugin-sdk/src/testing/index.js";
import plugin from "./server.js";
it("coalesces refreshes, bounds parallel host calls, caches readings and retains stale readings on failure", async () => {
  const host = createFakePluginHost({
    pluginId: "provider-usage",
    listProviders: async () => [
      { id: "supported", displayName: "Provider", available: true },
      { id: "unsupported", displayName: "Unsupported", available: true },
      { id: "disabled", displayName: "Disabled", available: false },
    ],
  });
  host.harness.sdk.stub("hosts.list", async () =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `host-${i}`,
      name: `Host ${i}`,
    })),
  );
  host.harness.sdk.stub("providers.list", async () => [
    { id: "supported", displayName: "Provider", available: true },
    { id: "unsupported", available: true },
    { id: "disabled", available: false },
  ]);
  let active = 0,
    max = 0,
    calls = 0,
    fail = false;
  host.harness.sdk.stub("providers.usage", async (args: unknown) => {
    calls++;
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (fail) throw Error("offline");
    return (
      args as {
        providerId: string;
      }
    ).providerId === "supported"
      ? {
          supported: true,
          usage: {
            status: "ok",
            windows: [{ label: "Session", usedPercent: 25, resetsAt: null }],
          },
        }
      : { supported: false };
  });
  await plugin(host.bb);
  expect(await host.harness.behavior.callRpc("snapshot")).toEqual([]);
  const [first, second] = await Promise.all([
    host.harness.behavior.callRpc("refresh"),
    host.harness.behavior.callRpc("refresh"),
  ]);
  expect(first).toEqual(second);
  expect(first).toHaveLength(5);
  expect(calls).toBe(15);
  expect(max).toBeLessThanOrEqual(3);
  expect(host.harness.kv.get("readings")).toEqual(first);
  fail = true;
  const stale = (await host.harness.behavior.callRpc("refresh")) as Array<{
    updatedAt: number;
    error: string;
  }>;
  expect(stale).toHaveLength(15);
  expect(stale.filter((r) => r.updatedAt > 0)).toHaveLength(5);
  expect(stale.every((r) => r.error)).toBe(true);
  await host.harness.lifecycle.dispose();
});
