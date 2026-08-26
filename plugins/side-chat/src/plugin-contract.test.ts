import { describe, expect, it } from "vitest";
import { collectTestPluginApp } from "@zana-ai/zcc-plugin-sdk/testing/app";
import app from "../app.js";
describe("side-chat plugin", () => {
  it("registers a thread panel and message action", () => {
    const set = collectTestPluginApp(app, "side-chat");
    expect(set.threadPanelActions[0]?.id).toBe("chat");
    expect(set.messageActions[0]?.id).toBe("side-chat");
  });
});
