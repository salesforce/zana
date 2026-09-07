import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";

/**
 * First-party CLI Agent (PTY) harness plugin. The declaration is the only
 * source of this family in pickers: disabling the plugin hides Codex
 * from CLI Agent surfaces. The host still authorizes cwd and spawns node-pty.
 */
export default function plugin(zcc: ZccPluginApi) {
  zcc.agents.experimental_registerPtyHarness({
    id: "codex",
    displayName: "Codex",
    icon: "./icons/codex.svg",
    profiles: [
      { id: 'codex', label: 'Codex' },
      { id: 'codex-resume', label: 'Codex (resume)' },
      { id: 'codex-yolo', label: 'Codex (unrestricted)' }
    ],
    enableConfigKey: 'harnessCodexEnabled',
  });
}
