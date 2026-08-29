import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("secrets plugin", () => {
  it("registers a pendingInteraction renderer", () => {
    expect(collectTestPluginApp(app, "secrets").pendingInteractions[0]?.id).toBe("secret");
  });
});
