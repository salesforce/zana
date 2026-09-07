import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

function booleanSetting(
  value: string | boolean | undefined,
  fallback: boolean,
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * First-party Claude Code provider plugin. The declaration is the only source
 * of this provider: with the core catalog seed deleted, disabling this plugin
 * removes it. The host artifact is the Agent SDK bridge (`zcc.host`).
 */
export default function plugin(bb: ZccPluginApi) {
  bb.settings.define({
    memoryEnabled: {
      type: "boolean",
      label: "Memory",
      description: "Let Claude Code read and write auto-memory between sessions.",
      default: true,
    },
    subagentsDisabled: {
      type: "boolean",
      label: "Disable subagents",
      description: "Prevent Claude Code from launching Task subagents.",
      default: false,
    },
    workflowsDisabled: {
      type: "boolean",
      label: "Disable workflows",
      description: "Hide Claude Code workflow tools.",
      default: false,
    },
    idleQueryReleaseEnabled: {
      type: "boolean",
      label: "Release idle Claude processes",
      description:
        "Close a quiescent Claude Code process after 30 seconds and resume it on the next turn.",
      default: false,
    },
    chromeEnabled: {
      type: "boolean",
      label: "Claude in Chrome",
      description: "Allow Claude Code to drive a Chrome browser.",
      default: false,
    },
  });
  bb.agents.experimental_registerProvider({
    id: "claude-code",
    displayName: "Claude Code",
    icon: "./icons/claude-code.svg",
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: true,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: [
        "low",
        "medium",
        "high",
        "xhigh",
        "ultracode",
        "max",
      ],
    },
    composerActions: ["plan"],
    deriveProviderOptions(context) {
      return {
        memoryEnabled: booleanSetting(context.settings.memoryEnabled, true),
        providerSubagentsEnabled: !booleanSetting(
          context.settings.subagentsDisabled,
          false,
        ),
        workflowsEnabled: !booleanSetting(
          context.settings.workflowsDisabled,
          false,
        ),
        idleQueryReleaseEnabled: booleanSetting(
          context.settings.idleQueryReleaseEnabled,
          false,
        ),
        chromeEnabled: booleanSetting(context.settings.chromeEnabled, false),
        ...(context.promptMode === "plan"
          ? { claudeCodePermissionMode: "plan" as const }
          : {}),
      };
    },
  });
}
