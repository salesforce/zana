import type { HostDaemonAcpLaunchSpec } from "@zana-ai/zcc-host-daemon-contract";

/**
 * Launch specs for the ACP providers bb bundles itself.
 *
 * Configured ACP agents (`customAcpAgents`) and known ACP agents both arrive
 * with a launch spec on the command; the bundled providers have no server-side
 * entry, so the registry falls back to this table when it packs the ACP
 * bridge's provider-scoped statics.
 */
export const BUILT_IN_ACP_LAUNCH_SPECS: Readonly<
  Record<string, HostDaemonAcpLaunchSpec>
> = {
  "acp-cursor": {
    displayName: "Cursor",
    // Cursor installs both `cursor-agent` and the generic `agent` alias. Use
    // the namespaced executable so another provider's `agent` binary earlier
    // on PATH cannot silently replace Cursor and collapse model discovery to
    // the synthetic fallback.
    command: "cursor-agent",
    // Global flags must precede the `acp` subcommand, matching the documented
    // `cursor-agent --api-key ... acp` form.
    args: ["acp"],
    env: {},
    // ACP-native parameterized picker: Cursor only advertises bare family ids
    // plus effort/Fast options when the client opts in. A `--list-models` CLI
    // would keep encoding effort in the id (`cursor-grok-4.6-medium`) and hide
    // new families such as Grok 4.6 behind "More models".
  },
  "acp-opencode": {
    displayName: "OpenCode",
    command: "opencode",
    args: ["acp"],
    env: {},
    // ACP-native: OpenCode advertises models and per-model `thought_level`
    // (`effort`, including the family's "default" variant) over the protocol.
    // A list CLI (`opencode models`) would print bare `provider/model` ids and
    // collapse every family to a single medium effort.
  },
};

/**
 * Model-picker facts that ride next to the launch spec in the ACP bridge's
 * opaque provider options. Cursor needs these so `model/list` starts a
 * throwaway ACP session with `clientCapabilities._meta.parameterizedModelPicker`
 * instead of spawning `cursor-agent --list-models`.
 */
export interface BuiltInAcpModelPicker {
  acpDialect?: string;
  parameterizedModelPicker?: boolean;
  primaryModels?: readonly string[];
  reasoningProbePriorityModelIds?: readonly string[];
}

export const BUILT_IN_ACP_MODEL_PICKER: Readonly<
  Record<string, BuiltInAcpModelPicker>
> = {
  "acp-cursor": {
    acpDialect: "cursor",
    parameterizedModelPicker: true,
    primaryModels: [
      "default",
      "grok-4.6",
      "gpt-5.6-sol",
      "claude-opus-5",
      "claude-fable-5",
      "composer-2.5",
    ],
    reasoningProbePriorityModelIds: ["grok-4.6", "grok-4.5"],
  },
};
