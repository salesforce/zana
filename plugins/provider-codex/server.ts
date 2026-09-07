import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

function booleanSetting(
  value: string | boolean | undefined,
  fallback: boolean,
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * First-party Codex provider plugin. The declaration is the only source of
 * this provider: with the core catalog seed deleted, disabling this plugin
 * removes it. The host artifact is the `codex app-server` bridge (`zcc.host`).
 */
export default function plugin(bb: ZccPluginApi) {
  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Memory",
      description: "Let Codex read and write memories between sessions.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable subagents",
      description: "Prevent Codex from launching collab / sub-agent workers.",
      default: false,
    },
  });
  bb.agents.experimental_registerProvider({
    id: "codex",
    displayName: "Codex",
    icon: "./icons/codex.svg",
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsWorkflows: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    composerActions: ["plan", "goal"],
    deriveProviderOptions(context) {
      return {
        memoryEnabled: booleanSetting(context.settings.memoryEnabled, true),
        providerSubagentsEnabled: !booleanSetting(
          context.settings.subagentsDisabled,
          false,
        ),
      };
    },
  });
}
