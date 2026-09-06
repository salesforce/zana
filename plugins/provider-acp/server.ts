import type { PluginProviderHandle, ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";
import {
  ACP_CUSTOM_AGENTS_SETTING,
  CUSTOM_ACP_AGENTS_SETTING,
  syncCustomAcpAgents,
} from "./src/configured-agents.js";

const extraAcpCapabilities = {
  supportsServiceTier: false,
  supportsNativeUserQuestion: false,
  fork: "tip" as const,
  supportsManualCompaction: false,
  supportsThreadArchive: false,
  supportsThreadRename: false,
  supportsWorkflows: false,
  permissionModes: ["accept-edits", "full"],
};

/**
 * First-party ACP provider plugin. Registers Cursor, OpenCode, OMP, Grok Build,
 * Hermes Agent, and optional custom ACP agents from plugin settings.
 */
export default function plugin(bb: ZccPluginApi) {
  const settings = bb.settings.define(ACP_CUSTOM_AGENTS_SETTING);
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
    visibility: "installed",
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
  bb.agents.experimental_registerProvider({
    id: "acp-omp",
    displayName: "OMP",
    icon: "./icons/omp.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });
  bb.agents.experimental_registerProvider({
    id: "acp-grok",
    displayName: "Grok Build",
    icon: "./icons/grok.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });
  bb.agents.experimental_registerProvider({
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    icon: "./icons/hermes.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });

  let customHandles: PluginProviderHandle[] = [];
  const applyCustom = (raw: string | boolean | undefined) => {
    customHandles = syncCustomAcpAgents(bb, raw, customHandles);
  };
  void settings.get().then((values) => applyCustom(values[CUSTOM_ACP_AGENTS_SETTING]));
  settings.onChange((values) => applyCustom(values[CUSTOM_ACP_AGENTS_SETTING]));
}
