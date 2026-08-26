import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("provider-retry plugin", () => {
  it("registers a composer action", () => {
    const set = collectTestPluginApp(app, "provider-retry");
    expect(set.composerCustomizations[0]?.actions?.[0]?.id).toBe("retry-last");
  });
});
