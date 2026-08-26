import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import plugin from "../server.mjs";
import app from "../app.js";
describe("memory plugin", () => {
  it("registers settings and configure", async () => {
    const { zcc, harness } = createFakePluginHost({ pluginId: "memory" });
    await plugin(zcc);
    expect(harness.agentConfigurers?.length ?? 1).toBeGreaterThan(0);
    expect(collectTestPluginApp(app, "memory").settingsSections[0]?.id).toBe("memory");
  });
});
