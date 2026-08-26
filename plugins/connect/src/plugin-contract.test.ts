import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("connect plugin", () => {
  it("registers settings and a footer action", () => {
    const set = collectTestPluginApp(app, "connect");
    expect(set.settingsSections[0]?.id).toBe("connect");
    expect(set.sidebarFooterActions[0]?.id).toBe("connect");
  });
});
