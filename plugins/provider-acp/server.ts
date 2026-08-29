import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party ACP provider plugin (see
 * plans/agent-provider-plugin-surface.md). Registers Cursor and OpenCode;
 * remaining known/custom ACP agents stay server-side transitionally (see
 * README.md). Each declaration is the only source of that provider: with the
 * core catalog seed deleted, disabling this plugin removes them.
 */
export default function plugin(bb: ZccPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "acp-cursor",
    displayName: "Cursor",
    icon: "./icons/cursor.svg",
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "tip",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
  bb.agents.experimental_registerProvider({
    id: "acp-opencode",
    displayName: "OpenCode",
    icon: "./icons/opencode.svg",
    capabilities: {
      supportsServiceTier: true,
      supportsNativeUserQuestion: false,
      fork: "tip",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
}
