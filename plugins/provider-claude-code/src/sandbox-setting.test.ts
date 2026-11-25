import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import claudeCodePlugin from "../server.js";

describe("Claude Code sandbox setting", () => {
  it.each(["source", "shipped"])("defaults on and honors only boolean settings in the %s plugin", async entry => {
    const host = createFakePluginHost({ pluginId: "provider-claude-code" });
    const plugin: typeof claudeCodePlugin = entry === "source" ? claudeCodePlugin
      : (await import(new URL("../server.mjs", import.meta.url).href)).default;
    plugin(host.zcc);
    expect(host.harness.settings.sandboxEnabled).toMatchObject({
      type: "boolean", label: "Claude Code sandbox", default: true,
    });
    const derive = host.harness.providers.find(provider => provider.id === "claude-code")?.deriveProviderOptions;
    if (!derive) throw new Error("Expected Claude Code provider settings");
    for (const [value, expected] of [[undefined, true], [true, true], [false, false], ["false", true]] as const) {
      const options = derive({ threadId: "thread-1", projectId: "project-1", permissionMode: "accept-edits",
        settings: value === undefined ? {} : { sandboxEnabled: value },
      });
      if (!options) throw new Error("Expected derived Claude Code options");
      expect(options.sandboxEnabled).toBe(expected);
    }
    expect(derive({ threadId: "thread-1", projectId: "project-1", permissionMode: "accept-edits",
      promptMode: "plan", settings: { sandboxEnabled: false },
    })).toMatchObject({ sandboxEnabled: false, claudeCodePermissionMode: "plan" });
  });
});
