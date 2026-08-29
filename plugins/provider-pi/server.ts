import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party Pi provider plugin (see
 * plans/agent-provider-plugin-surface.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider. The bridge itself is
 * daemon-bundled (`bb-pi-bridge.mjs`); this plugin does not ship a `zcc.host`
 * artifact.
 */
export default function plugin(bb: ZccPluginApi) {
  bb.agents.experimental_registerProvider({
    id: "pi",
    displayName: "Pi",
    icon: "./icons/pi.svg",
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsWorkflows: false,
      permissionModes: ["full"],
      reasoningLevels: ["none", "low", "medium", "high", "xhigh", "max"],
    },
    composerActions: [],
  });
}
