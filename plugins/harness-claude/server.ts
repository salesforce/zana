import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides Claude Code
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "claude",
    displayName: "Claude Code",
    icon: "./icons/claude-code.svg",
    profiles: [
      { id: 'claude', label: 'Claude' },
      { id: 'claude-resume', label: 'Claude (resume)' },
      { id: 'claude-yolo', label: 'Claude (unrestricted)' }
    ],
    alwaysEnabled: true,
  });
}
