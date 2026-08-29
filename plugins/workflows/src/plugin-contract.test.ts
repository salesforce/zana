import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("workflows plugin", () => {
  it("registers a directive and composer plus-menu", () => {
    const set = collectTestPluginApp(app, "workflows");
    expect(set.messageDirectives[0]?.id).toBe("workflow");
    expect(set.composerCustomizations[0]?.plusMenu?.[0]?.id).toBe("insert-workflow");
  });
});
