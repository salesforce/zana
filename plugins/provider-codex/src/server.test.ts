import { describe, expect, it } from "vitest";
import type { PluginProviderOptionsContext } from "@zana-ai/zcc-plugin-sdk";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import codexPlugin from "../server.js";

function loadCodexPlugin() {
  const host = createFakePluginHost({ pluginId: "provider-codex" });
  codexPlugin(host.zcc);
  const declaration = host.harness.providers.find((entry) => entry.id === "codex");
  if (declaration === undefined) {
    throw new Error("expected Codex to be registered");
  }
  return { declaration, host };
}

function providerOptions(
  declaration: ReturnType<typeof loadCodexPlugin>["declaration"],
  settings: PluginProviderOptionsContext["settings"],
  promptMode?: "plan",
) {
  const deriveProviderOptions = declaration.deriveProviderOptions;
  if (deriveProviderOptions === undefined) {
    throw new Error("expected Codex provider options");
  }
  return deriveProviderOptions({
    threadId: "thread-1",
    projectId: "project-1",
    model: "gpt-5",
    permissionMode: "accept-edits",
    settings,
    ...(promptMode ? { promptMode } : {}),
  });
}

describe("the Codex provider settings", () => {
  it("keeps memory on by default and derives an explicit opt-out", () => {
    const { declaration, host } = loadCodexPlugin();
    expect(host.harness.settings.memoryEnabled).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(providerOptions(declaration, {})).toMatchObject({
      memoryEnabled: true,
      providerSubagentsEnabled: true,
    });
    expect(
      providerOptions(declaration, { memoryEnabled: false, subagentsDisabled: true }),
    ).toEqual({
      memoryEnabled: false,
      providerSubagentsEnabled: false,
    });
  });

  it("does not pack Claude plan permission mode", () => {
    const { declaration } = loadCodexPlugin();
    expect(providerOptions(declaration, {}, "plan")).not.toHaveProperty(
      "claudeCodePermissionMode",
    );
  });
});
