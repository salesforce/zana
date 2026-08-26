import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("inline-vis plugin", () => {
  it("registers a vis directive", () => {
    expect(collectTestPluginApp(app, "inline-vis").messageDirectives[0]?.id).toBe("vis");
  });
});
