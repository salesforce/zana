import { describe, expect, it } from "vitest";
import type { PluginProviderOptionsContext } from "@zana-ai/zcc-plugin-sdk";
import { createFakePluginHost } from "@zana-ai/zcc-plugin-sdk/testing";
import claudeCodePlugin from "../server.js";

function loadClaudeCodePlugin() {
  const host = createFakePluginHost({ pluginId: "provider-claude-code" });
  claudeCodePlugin(host.zcc);
  const declaration = host.harness.providers.find(
    (entry) => entry.id === "claude-code",
  );
  if (declaration === undefined) {
    throw new Error("expected Claude Code to be registered");
  }
  return { declaration, host };
}

function providerOptions(
  declaration: ReturnType<typeof loadClaudeCodePlugin>["declaration"],
  settings: PluginProviderOptionsContext["settings"],
) {
  const deriveProviderOptions = declaration.deriveProviderOptions;
  if (deriveProviderOptions === undefined) {
    throw new Error("expected Claude Code provider options");
  }
  return deriveProviderOptions({
    threadId: "thread-1",
    projectId: "project-1",
    model: "claude-sonnet-5",
    permissionMode: "accept-edits",
    settings,
  });
}

describe("the Claude Code provider settings", () => {
  it("keeps idle query release off by default and derives an explicit opt-in", () => {
    const { declaration, host } = loadClaudeCodePlugin();

    expect(host.harness.settings.idleQueryReleaseEnabled).toEqual({
      type: "boolean",
      label: "Release idle Claude processes",
      description:
        "Close a quiescent Claude Code process after 30 seconds and resume it on the next turn.",
      default: false,
    });
    expect(providerOptions(declaration, {}).idleQueryReleaseEnabled).toBe(
      false,
    );
    expect(
      providerOptions(declaration, { idleQueryReleaseEnabled: true })
        .idleQueryReleaseEnabled,
    ).toBe(true);
  });

  it("packs Claude plan permission mode only when promptMode is plan", () => {
    const { declaration } = loadClaudeCodePlugin();
    expect(providerOptions(declaration, {})).not.toHaveProperty(
      "claudeCodePermissionMode",
    );
    const derive = declaration.deriveProviderOptions;
    if (derive === undefined) throw new Error("expected Claude Code provider options");
    expect(
      derive({
        threadId: "thread-1",
        projectId: "project-1",
        permissionMode: "accept-edits",
        promptMode: "plan",
        settings: {},
      }),
    ).toMatchObject({ claudeCodePermissionMode: "plan" });
  });
});
