import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides OpenCode
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "opencode",
    displayName: "OpenCode",
    icon: "./icons/opencode.svg",
    profiles: [
      { id: 'opencode', label: 'OpenCode' },
      { id: 'opencode-resume', label: 'OpenCode (resume)' },
      { id: 'opencode-yolo', label: 'OpenCode (unrestricted)' }
    ],
    enableConfigKey: 'harnessOpenCodeEnabled',
  });
}
