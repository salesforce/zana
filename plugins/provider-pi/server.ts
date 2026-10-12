import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";
import { PI_BRIDGE_ENV } from "./src/bridge-env.js";

function booleanSetting(
  value: string | number | boolean | undefined,
  fallback: boolean,
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * First-party Pi provider plugin (see
 * plans/agent-provider-plugin-surface.md). The
 * declaration is the only source of this provider: with the core catalog seed
 * deleted, disabling this plugin removes the provider. The bridge itself is
 * daemon-bundled (`zcc-pi-bridge.mjs`); this plugin does not ship a `zcc.host`
 * artifact.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.settings.define({
    trustSystemCertificates: {
      type: "boolean",
      label: "Trust system certificates",
      description:
        "Start Pi with NODE_USE_SYSTEM_CA=1 so it also trusts the OS certificate store (macOS keychain), which providers behind a corporate TLS root need. A NODE_USE_SYSTEM_CA value already in the environment takes precedence.",
      default: true,
    },
  });
  zcc.agents.experimental_registerProvider({
    id: "pi",
    displayName: "Pi",
    icon: "./icons/pi.svg",
    env: PI_BRIDGE_ENV,
    maintenance: { health: true, usage: false, installation: true },
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
    deriveProviderOptions(context) {
      return {
        trustSystemCertificates: booleanSetting(
          context.settings.trustSystemCertificates,
          true,
        ),
      };
    },
  });
}
