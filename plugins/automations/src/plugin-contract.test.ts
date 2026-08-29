import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import { derivePluginId } from "@zana-ai/zcc-domain";
import app from "../app.js";
describe("automations plugin", () => {
  it("registers a nav panel", () => {
    expect(derivePluginId("@zcc-ext/automations")).toBe("automations");
    expect(collectTestPluginApp(app, "automations").navPanels[0]?.id).toBe("main");
  });
});
