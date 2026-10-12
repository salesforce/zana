import { KNOWN_ACP_AGENTS } from './src/known-agents.js';
import type { PluginProviderDeclaration } from '@zana-ai/zcc-plugin-sdk';
function nativeDiscovery(id: string): Pick<PluginProviderDeclaration, 'experimental_nativeSkillRoots' | 'experimental_resolvesNativeRoots'> {
  const agent = KNOWN_ACP_AGENTS.find(row => row.id === id);
  return { ...(agent?.launch.nativeSkillRoots ? { experimental_nativeSkillRoots: agent.launch.nativeSkillRoots } : {}), ...(agent?.nativeRootsResolver ? { experimental_resolvesNativeRoots: true } : {}) };
}
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
 * Mastra Code, Hermes Agent, and optional custom ACP agents from plugin settings.
 */
export default function plugin(zcc: ZccPluginApi) {
  const settings = zcc.settings.define(ACP_CUSTOM_AGENTS_SETTING);
  zcc.agents.experimental_registerProvider({
    id: "acp-cursor",
    ...nativeDiscovery("acp-cursor"),
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
  zcc.agents.experimental_registerProvider({
    id: "acp-opencode",
    ...nativeDiscovery("acp-opencode"),
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
  zcc.agents.experimental_registerProvider({
    id: "acp-omp",
    ...nativeDiscovery("acp-omp"),
    displayName: "OMP",
    icon: "./icons/omp.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-grok",
    ...nativeDiscovery("acp-grok"),
    displayName: "Grok Build",
    icon: "./icons/grok.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-mastracode",
    ...nativeDiscovery("acp-mastracode"),
    displayName: "Mastra Code",
    icon: "./icons/mastracode.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });
  zcc.agents.experimental_registerProvider({
    id: "acp-hermes-agent",
    ...nativeDiscovery("acp-hermes-agent"),
    displayName: "Hermes Agent",
    icon: "./icons/hermes.svg",
    visibility: "installed",
    capabilities: extraAcpCapabilities,
    composerActions: [],
  });

  let customHandles: PluginProviderHandle[] = [];
  const applyCustom = (raw: string | number | boolean | undefined) => {
    customHandles = syncCustomAcpAgents(zcc, raw, customHandles);
  };
  void settings.get().then((values) => applyCustom(values[CUSTOM_ACP_AGENTS_SETTING]));
  settings.onChange((values) => applyCustom(values[CUSTOM_ACP_AGENTS_SETTING]));
}
